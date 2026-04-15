create table if not exists public.round_rewards (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stars integer not null check (stars between 0 and 3),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  reward_amount integer not null check (reward_amount >= 0),
  claimed boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (round_id, user_id)
);

create index if not exists round_rewards_user_idx
on public.round_rewards (user_id, created_at desc);

create index if not exists round_rewards_round_idx
on public.round_rewards (round_id);

create or replace function public.complete_round_and_award_resources(
  round_id uuid,
  guess_input text,
  score_input integer,
  difficulty_input text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  normalized_guess text := btrim(coalesce(guess_input, ''));
  normalized_difficulty text := lower(btrim(coalesce(difficulty_input, '')));
  stars integer;
  difficulty_multiplier integer;
  coins_awarded integer;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to complete a round.';
  end if;

  if round_id is null then
    raise exception 'A round id is required.';
  end if;

  if normalized_guess = '' then
    raise exception 'A guess is required.';
  end if;

  select *
  into round_row
  from public.rounds
  where id = round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if round_row.recipient_id <> current_user_id then
    raise exception 'Only the recipient can complete this round.';
  end if;

  if round_row.status = 'complete' then
    return round_row;
  end if;

  if round_row.status <> 'attempted' then
    raise exception 'Round cannot be completed before an attempt is saved.';
  end if;

  if round_row.attempt_audio_path is null or round_row.attempt_reversed_path is null then
    raise exception 'Round attempt not found.';
  end if;

  if score_input is null or score_input < 0 or score_input > 10 then
    raise exception 'Score must be between 0 and 10.';
  end if;

  if round_row.difficulty is not null and btrim(round_row.difficulty) <> '' then
    normalized_difficulty := round_row.difficulty;
  end if;

  if normalized_difficulty is null or normalized_difficulty = '' then
    raise exception 'A difficulty value is required to prepare the reward.';
  end if;

  if normalized_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'Invalid difficulty value.';
  end if;

  stars := public.score_to_stars(score_input);

  difficulty_multiplier := case normalized_difficulty
    when 'easy' then 1
    when 'medium' then 2
    when 'hard' then 3
  end;

  coins_awarded := stars * difficulty_multiplier;

  update public.rounds
  set
    guess = normalized_guess,
    score = score_input,
    status = 'complete',
    difficulty = normalized_difficulty
  where id = round_row.id
  returning * into round_row;

  insert into public.round_rewards (
    round_id,
    user_id,
    stars,
    difficulty,
    reward_amount
  )
  values
    (
      round_row.id,
      round_row.sender_id,
      stars,
      normalized_difficulty,
      coins_awarded
    ),
    (
      round_row.id,
      round_row.recipient_id,
      stars,
      normalized_difficulty,
      coins_awarded
    )
  on conflict (round_id, user_id) do nothing;

  return round_row;
end;
$$;

create or replace function public.claim_round_reward(claim_round_id uuid)
returns table (
  id uuid,
  round_id uuid,
  user_id uuid,
  stars integer,
  difficulty text,
  reward_amount integer,
  claimed boolean,
  created_at timestamptz,
  claimed_now boolean,
  current_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  reward_row public.round_rewards%rowtype;
  inserted_transaction_id uuid;
  reward_claimed_now boolean := false;
  current_balance_value integer := 0;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to claim a round reward.';
  end if;

  if claim_round_id is null then
    raise exception 'A round id is required.';
  end if;

  select rr.*
  into reward_row
  from public.round_rewards as rr
  where rr.round_id = claim_round_id
    and rr.user_id = current_user_id
  for update;

  if reward_row.id is null then
    return;
  end if;

  if not reward_row.claimed then
    update public.round_rewards as rr
    set claimed = true
    where rr.id = reward_row.id
    returning rr.* into reward_row;

    insert into public.transactions (
      user_id,
      resource_type,
      amount,
      reason,
      metadata
    )
    values (
      current_user_id,
      'bb_coin',
      reward_row.reward_amount,
      'round_reward',
      jsonb_build_object(
        'round_id', reward_row.round_id,
        'stars', reward_row.stars,
        'difficulty', reward_row.difficulty
      )
    )
    on conflict do nothing
    returning id into inserted_transaction_id;

    if inserted_transaction_id is not null then
      perform public.increment_resource(current_user_id, 'bb_coin', reward_row.reward_amount);
    end if;

    reward_claimed_now := inserted_transaction_id is not null;
  end if;

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  return query
  select
    reward_row.id,
    reward_row.round_id,
    reward_row.user_id,
    reward_row.stars,
    reward_row.difficulty,
    reward_row.reward_amount,
    reward_row.claimed,
    reward_row.created_at,
    reward_claimed_now,
    current_balance_value;
end;
$$;

create or replace function public.archive_completed_round(round_id uuid)
returns table (
  friendship_id uuid,
  user_one_id uuid,
  user_one_email text,
  user_two_id uuid,
  user_two_email text,
  completed_round_count integer,
  total_star_score integer,
  average_star_score double precision,
  next_sender_id uuid,
  last_completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  archived_round public.rounds%rowtype;
  friendship_row public.friendships%rowtype;
  next_star_total integer;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to archive a round.';
  end if;

  select *
  into archived_round
  from public.rounds
  where id = round_id
  for update;

  if archived_round.id is null then
    raise exception 'Round not found.';
  end if;

  if archived_round.sender_id <> current_user_id then
    raise exception 'Only the original sender can archive this round.';
  end if;

  if archived_round.status <> 'complete' then
    raise exception 'Only completed rounds can be archived.';
  end if;

  if exists (
    select 1
    from public.round_rewards
    where round_id = archived_round.id
      and claimed = false
  ) then
    raise exception 'Both players must open the results screen before the thread can continue.';
  end if;

  select *
  into friendship_row
  from public.friendships
  where
    (user_one_id = archived_round.sender_id and user_two_id = archived_round.recipient_id)
    or (user_one_id = archived_round.recipient_id and user_two_id = archived_round.sender_id)
  for update;

  if friendship_row.id is null then
    raise exception 'Friendship not found for this round.';
  end if;

  next_star_total := friendship_row.total_star_score + public.score_to_stars(archived_round.score);

  update public.friendships
  set
    completed_round_count = friendship_row.completed_round_count + 1,
    total_star_score = next_star_total,
    next_sender_id = archived_round.recipient_id,
    last_completed_at = timezone('utc'::text, now())
  where id = friendship_row.id
  returning * into friendship_row;

  delete from public.rounds
  where id = archived_round.id;

  friendship_id := friendship_row.id;
  user_one_id := friendship_row.user_one_id;
  user_one_email := friendship_row.user_one_email;
  user_two_id := friendship_row.user_two_id;
  user_two_email := friendship_row.user_two_email;
  completed_round_count := friendship_row.completed_round_count;
  total_star_score := friendship_row.total_star_score;
  average_star_score := case
    when friendship_row.completed_round_count = 0 then null
    else friendship_row.total_star_score::numeric / friendship_row.completed_round_count
  end;
  next_sender_id := friendship_row.next_sender_id;
  last_completed_at := friendship_row.last_completed_at;
  return next;
end;
$$;

grant select on public.round_rewards to authenticated;
grant all on public.round_rewards to service_role;

grant execute on function public.claim_round_reward(uuid) to authenticated;
grant execute on function public.complete_round_and_award_resources(uuid, text, integer, text) to authenticated;
grant execute on function public.archive_completed_round(uuid) to authenticated;

alter table public.round_rewards enable row level security;

drop policy if exists "Users can read their round rewards" on public.round_rewards;
create policy "Users can read their round rewards"
on public.round_rewards
for select
to authenticated
using (user_id = auth.uid());
