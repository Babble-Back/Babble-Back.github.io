create extension if not exists pgcrypto;

create table if not exists public.user_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  resource_type text not null,
  amount integer not null default 0,
  updated_at timestamp not null default now(),
  unique (user_id, resource_type)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  resource_type text not null,
  amount integer not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp not null default now()
);

alter table public.rounds
  add column if not exists difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  add column if not exists rewarded_at timestamptz;

create index if not exists idx_resources_user
on public.user_resources (user_id);

create index if not exists idx_transactions_user
on public.transactions (user_id);

create unique index if not exists transactions_round_reward_unique_idx
on public.transactions (
  user_id,
  resource_type,
  reason,
  (metadata->>'round_id')
)
where reason = 'round_reward'
  and metadata ? 'round_id';

create or replace function public.increment_resource(uid uuid, rtype text, amt integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be logged in to update resources.';
  end if;

  if uid is null then
    raise exception 'A user id is required.';
  end if;

  if current_user_id <> uid then
    raise exception 'You can only update your own resources.';
  end if;

  if rtype is null or btrim(rtype) = '' then
    raise exception 'A resource type is required.';
  end if;

  insert into public.user_resources (user_id, resource_type, amount)
  values (uid, rtype, amt)
  on conflict (user_id, resource_type)
  do update set
    amount = public.user_resources.amount + excluded.amount,
    updated_at = now();
end;
$$;

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
  inserted_transaction_id uuid;
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
    raise exception 'A difficulty value is required to award coins.';
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
    difficulty = normalized_difficulty,
    rewarded_at = case
      when round_row.rewarded_at is null then timezone('utc'::text, now())
      else round_row.rewarded_at
    end
  where id = round_row.id
  returning * into round_row;

  if round_row.rewarded_at is not null then
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
      coins_awarded,
      'round_reward',
      jsonb_build_object(
        'round_id', round_row.id,
        'stars', stars,
        'difficulty', normalized_difficulty,
        'score', score_input
      )
    )
    on conflict do nothing
    returning id into inserted_transaction_id;

    if inserted_transaction_id is not null then
      perform public.increment_resource(current_user_id, 'bb_coin', coins_awarded);
    end if;
  end if;

  return round_row;
end;
$$;

alter table public.user_resources enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Users can read their resources" on public.user_resources;
create policy "Users can read their resources"
on public.user_resources
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can read their transactions" on public.transactions;
create policy "Users can read their transactions"
on public.transactions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert their transactions" on public.transactions;

grant select on public.user_resources to authenticated;
grant select on public.transactions to authenticated;

grant all on public.user_resources to service_role;
grant all on public.transactions to service_role;

grant execute on function public.complete_round_and_award_resources(uuid, text, integer, text) to authenticated;
