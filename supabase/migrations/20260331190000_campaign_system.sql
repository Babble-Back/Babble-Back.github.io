create extension if not exists pgcrypto;

alter table public.word_packs
  add column if not exists unlock_tier text check (unlock_tier in ('easy', 'medium', 'hard'));

create index if not exists idx_word_packs_unlock_tier
on public.word_packs (unlock_tier);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text,
  theme text,
  start_date timestamptz,
  end_date timestamptz,
  is_active boolean not null default false,
  config jsonb not null default '{}'::jsonb
);

create table if not exists public.campaign_challenges (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  challenge_index integer not null check (challenge_index > 0),
  phrase text not null check (char_length(btrim(phrase)) > 0),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  mode text not null check (mode in ('normal', 'reverse_only')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (campaign_id, challenge_index)
);

create index if not exists idx_campaign_challenges_campaign_index
on public.campaign_challenges (campaign_id, challenge_index);

create table if not exists public.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  key text not null check (char_length(btrim(key)) > 0),
  value text not null check (char_length(btrim(value)) > 0),
  unique (campaign_id, key)
);

create table if not exists public.user_campaign_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  current_index integer not null default 1 check (current_index >= 1),
  completed_count integer not null default 0 check (completed_count >= 0),
  primary key (user_id, campaign_id)
);

create index if not exists idx_user_campaign_progress_leaderboard
on public.user_campaign_progress (campaign_id, completed_count desc, current_index desc);

create table if not exists public.user_campaign_attempts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid not null references public.campaign_challenges (id) on delete cascade,
  attempts_today integer not null default 0 check (attempts_today >= 0),
  last_attempt_date date,
  primary key (user_id, challenge_id)
);

create index if not exists idx_user_campaign_attempts_user_updated
on public.user_campaign_attempts (user_id, last_attempt_date desc);

create table if not exists public.user_word_pack_unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid not null references public.word_packs (id) on delete cascade,
  source_campaign_id uuid references public.campaigns (id) on delete set null,
  unlocked_at timestamptz not null default timezone('utc'::text, now()),
  primary key (user_id, pack_id)
);

create index if not exists idx_user_word_pack_unlocks_user
on public.user_word_pack_unlocks (user_id, unlocked_at desc);

create or replace function public.get_active_campaign_state(request_user_id uuid default auth.uid())
returns table (
  campaign jsonb,
  challenges jsonb,
  assets jsonb,
  progress jsonb,
  attempts jsonb,
  unlocked_pack_ids uuid[]
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  campaign_row public.campaigns%rowtype;
  campaign_json jsonb;
  challenges_json jsonb;
  assets_json jsonb;
  progress_json jsonb;
  attempts_json jsonb;
  unlocked_pack_ids_value uuid[];
  current_balance integer := 0;
  resolved_user_id uuid := request_user_id;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to load campaign state.';
  end if;

  if resolved_user_id is not null and resolved_user_id <> current_user_id then
    raise exception 'You can only load your own campaign state.';
  end if;

  if resolved_user_id is null then
    resolved_user_id := current_user_id;
  end if;

  select *
  into campaign_row
  from public.campaigns
  where is_active
    and (start_date is null or start_date <= timezone('utc'::text, now()))
    and (end_date is null or end_date >= timezone('utc'::text, now()))
  order by start_date desc nulls last, id desc
  limit 1;

  if campaign_row.id is null then
    campaign_json := null;
    challenges_json := '[]'::jsonb;
    assets_json := '[]'::jsonb;
    progress_json := null;
    attempts_json := '[]'::jsonb;
    unlocked_pack_ids_value := array[]::uuid[];
    return query select campaign_json, challenges_json, assets_json, progress_json, attempts_json, unlocked_pack_ids_value;
    return;
  end if;

  campaign_json := to_jsonb(campaign_row);

  select coalesce(
    jsonb_agg(to_jsonb(challenge_row) order by challenge_row.challenge_index),
    '[]'::jsonb
  )
  into challenges_json
  from (
    select id, campaign_id, challenge_index, phrase, difficulty, mode, created_at
    from public.campaign_challenges
    where campaign_id = campaign_row.id
    order by challenge_index asc
  ) as challenge_row;

  select coalesce(
    jsonb_agg(to_jsonb(asset_row) order by asset_row.key),
    '[]'::jsonb
  )
  into assets_json
  from (
    select key, value
    from public.campaign_assets
    where campaign_id = campaign_row.id
    order by key asc
  ) as asset_row;

  select amount
  into current_balance
  from public.user_resources
  where user_id = resolved_user_id
    and resource_type = 'bb_coin';

  current_balance := coalesce(current_balance, 0);

  select to_jsonb(progress_row)
  into progress_json
  from (
    select user_id, campaign_id, current_index, completed_count
    from public.user_campaign_progress
    where user_id = resolved_user_id
      and campaign_id = campaign_row.id
  ) as progress_row;

  select coalesce(
    jsonb_agg(to_jsonb(attempt_row) order by attempt_row.challenge_index),
    '[]'::jsonb
  )
  into attempts_json
  from (
    select
      ua.user_id,
      ua.challenge_id,
      cc.challenge_index,
      ua.attempts_today,
      ua.last_attempt_date,
      (ua.last_attempt_date is distinct from current_date) as free_attempt_available,
      10 as retry_cost,
      current_balance as current_balance,
      false as charged
    from public.user_campaign_attempts as ua
    join public.campaign_challenges as cc
      on cc.id = ua.challenge_id
    where ua.user_id = resolved_user_id
      and cc.campaign_id = campaign_row.id
    order by cc.challenge_index asc
  ) as attempt_row;

  select coalesce(array_agg(distinct unlock_row.pack_id order by unlock_row.pack_id), array[]::uuid[])
  into unlocked_pack_ids_value
  from public.user_word_pack_unlocks as unlock_row
  where unlock_row.user_id = resolved_user_id;

  return query select campaign_json, challenges_json, assets_json, progress_json, attempts_json, unlocked_pack_ids_value;
end;
$$;

create or replace function public.consume_campaign_attempt(consume_challenge_id uuid)
returns table (
  user_id uuid,
  challenge_id uuid,
  attempts_today integer,
  last_attempt_date date,
  free_attempt_available boolean,
  retry_cost integer,
  current_balance integer,
  charged boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  campaign_row public.campaigns%rowtype;
  challenge_row public.campaign_challenges%rowtype;
  progress_row public.user_campaign_progress%rowtype;
  attempt_row public.user_campaign_attempts%rowtype;
  current_balance_value integer := 0;
  next_attempts_today integer := 0;
  charged_now boolean := false;
  inserted_transaction_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to attempt a campaign challenge.';
  end if;

  if consume_challenge_id is null then
    raise exception 'A challenge id is required.';
  end if;

  select cc.*
  into challenge_row
  from public.campaign_challenges as cc
  join public.campaigns as c
    on c.id = cc.campaign_id
  where cc.id = consume_challenge_id
    and c.is_active
    and (c.start_date is null or c.start_date <= timezone('utc'::text, now()))
    and (c.end_date is null or c.end_date >= timezone('utc'::text, now()))
  for update;

  if challenge_row.id is null then
    raise exception 'Challenge not found.';
  end if;

  select *
  into campaign_row
  from public.campaigns
  where id = challenge_row.campaign_id
  for update;

  insert into public.user_campaign_progress (
    user_id,
    campaign_id,
    current_index,
    completed_count
  )
  values (
    current_user_id,
    campaign_row.id,
    1,
    0
  )
  on conflict (user_id, campaign_id) do nothing;

  select *
  into progress_row
  from public.user_campaign_progress
  where user_id = current_user_id
    and campaign_id = campaign_row.id
  for update;

  if progress_row.current_index <> challenge_row.challenge_index then
    raise exception 'Only the current campaign challenge can be attempted.';
  end if;

  insert into public.user_campaign_attempts (
    user_id,
    challenge_id,
    attempts_today,
    last_attempt_date
  )
  values (
    current_user_id,
    challenge_row.id,
    0,
    null
  )
  on conflict (user_id, challenge_id) do nothing;

  select *
  into attempt_row
  from public.user_campaign_attempts
  where user_id = current_user_id
    and challenge_id = challenge_row.id
  for update;

  if attempt_row.last_attempt_date = current_date then
    next_attempts_today := coalesce(attempt_row.attempts_today, 0) + 1;

    select amount
    into current_balance_value
    from public.user_resources
    where user_id = current_user_id
      and resource_type = 'bb_coin'
    for update;

    current_balance_value := coalesce(current_balance_value, 0);

    if current_balance_value < 10 then
      raise exception 'You need 10 BB Coins for another campaign retry.';
    end if;

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
      -10,
      'campaign_retry',
      jsonb_build_object(
        'campaign_id', challenge_row.campaign_id,
        'challenge_id', challenge_row.id,
        'attempts_today', next_attempts_today
      )
    )
    returning id into inserted_transaction_id;

    if inserted_transaction_id is null then
      raise exception 'Unable to charge the campaign retry cost.';
    end if;

    perform public.increment_resource(current_user_id, 'bb_coin', -10);
    charged_now := true;
  else
    next_attempts_today := 1;
  end if;

  update public.user_campaign_attempts
  set
    attempts_today = next_attempts_today,
    last_attempt_date = current_date
  where user_id = current_user_id
    and challenge_id = challenge_row.id;

  select amount
  into current_balance_value
  from public.user_resources
  where user_id = current_user_id
    and resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  user_id := current_user_id;
  challenge_id := challenge_row.id;
  attempts_today := next_attempts_today;
  last_attempt_date := current_date;
  free_attempt_available := false;
  retry_cost := 10;
  current_balance := current_balance_value;
  charged := charged_now;
  return next;
end;
$$;

create or replace function public.complete_campaign_challenge(
  complete_challenge_id uuid,
  stars_input integer,
  transcript_input text,
  score_input numeric
)
returns table (
  campaign_id uuid,
  challenge_id uuid,
  user_id uuid,
  current_index integer,
  completed_count integer,
  unlocked_pack_ids uuid[],
  newly_unlocked_pack_ids uuid[],
  campaign_complete boolean,
  advanced boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  campaign_row public.campaigns%rowtype;
  challenge_row public.campaign_challenges%rowtype;
  progress_row public.user_campaign_progress%rowtype;
  challenge_count integer := 0;
  next_current_index integer := 0;
  next_completed_count integer := 0;
  unlocked_pack_ids_value uuid[] := array[]::uuid[];
  newly_unlocked_pack_ids_value uuid[] := array[]::uuid[];
begin
  if current_user_id is null then
    raise exception 'You must be logged in to complete a campaign challenge.';
  end if;

  if complete_challenge_id is null then
    raise exception 'A challenge id is required.';
  end if;

  if stars_input is null or stars_input < 0 or stars_input > 3 then
    raise exception 'Stars must be between 0 and 3.';
  end if;

  if score_input is null or score_input < 0 or score_input > 1 then
    raise exception 'Score must be between 0 and 1.';
  end if;

  select cc.*
  into challenge_row
  from public.campaign_challenges as cc
  join public.campaigns as c
    on c.id = cc.campaign_id
  where cc.id = complete_challenge_id
    and c.is_active
    and (c.start_date is null or c.start_date <= timezone('utc'::text, now()))
    and (c.end_date is null or c.end_date >= timezone('utc'::text, now()))
  for update;

  if challenge_row.id is null then
    raise exception 'Challenge not found.';
  end if;

  select *
  into campaign_row
  from public.campaigns
  where id = challenge_row.campaign_id
  for update;

  select count(*)
  into challenge_count
  from public.campaign_challenges
  where campaign_id = campaign_row.id;

  insert into public.user_campaign_progress (
    user_id,
    campaign_id,
    current_index,
    completed_count
  )
  values (
    current_user_id,
    campaign_row.id,
    1,
    0
  )
  on conflict (user_id, campaign_id) do nothing;

  select *
  into progress_row
  from public.user_campaign_progress
  where user_id = current_user_id
    and campaign_id = campaign_row.id
  for update;

  campaign_id := campaign_row.id;
  challenge_id := challenge_row.id;
  user_id := current_user_id;

  select coalesce(array_agg(distinct unlock_row.pack_id order by unlock_row.pack_id), array[]::uuid[])
  into unlocked_pack_ids_value
  from public.user_word_pack_unlocks as unlock_row
  where unlock_row.user_id = current_user_id;

  if progress_row.current_index > challenge_row.challenge_index then
    current_index := progress_row.current_index;
    completed_count := progress_row.completed_count;
    unlocked_pack_ids := unlocked_pack_ids_value;
    newly_unlocked_pack_ids := array[]::uuid[];
    campaign_complete := progress_row.current_index > challenge_count;
    advanced := false;
    return next;
  end if;

  if progress_row.current_index <> challenge_row.challenge_index then
    raise exception 'Only the current campaign challenge can be completed.';
  end if;

  if stars_input < 3 then
    current_index := progress_row.current_index;
    completed_count := progress_row.completed_count;
    unlocked_pack_ids := unlocked_pack_ids_value;
    newly_unlocked_pack_ids := array[]::uuid[];
    campaign_complete := progress_row.current_index > challenge_count;
    advanced := false;
    return next;
  end if;

  update public.user_campaign_progress
  set
    current_index = progress_row.current_index + 1,
    completed_count = progress_row.completed_count + 1
  where user_id = current_user_id
    and campaign_id = campaign_row.id
  returning current_index, completed_count
  into next_current_index, next_completed_count;

  with unlocked_packs as (
    select wp.id as pack_id
    from public.word_packs as wp
    where wp.unlock_tier = challenge_row.difficulty
  ),
  inserted_unlocks as (
    insert into public.user_word_pack_unlocks (
      user_id,
      pack_id,
      source_campaign_id
    )
    select
      current_user_id,
      up.pack_id,
      campaign_row.id
    from unlocked_packs as up
    on conflict (user_id, pack_id) do nothing
    returning pack_id
  )
  select coalesce(array_agg(pack_id order by pack_id), array[]::uuid[])
  into newly_unlocked_pack_ids_value
  from inserted_unlocks;

  select coalesce(array_agg(distinct unlock_row.pack_id order by unlock_row.pack_id), array[]::uuid[])
  into unlocked_pack_ids_value
  from public.user_word_pack_unlocks as unlock_row
  where unlock_row.user_id = current_user_id;

  current_index := next_current_index;
  completed_count := next_completed_count;
  unlocked_pack_ids := unlocked_pack_ids_value;
  newly_unlocked_pack_ids := newly_unlocked_pack_ids_value;
  campaign_complete := next_current_index > challenge_count;
  advanced := true;
  return next;
end;
$$;

create or replace function public.list_campaign_leaderboard(
  campaign_id uuid,
  friends_only boolean default false
)
returns table (
  rank integer,
  user_id uuid,
  username text,
  completed_count integer,
  current_index integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if campaign_id is null then
    return;
  end if;

  if friends_only and current_user_id is null then
    raise exception 'You must be logged in to view a friends-only leaderboard.';
  end if;

  return query
  with leaderboard_rows as (
    select
      row_number() over (
        order by
          up.completed_count desc,
          up.current_index desc,
          p.username asc
      ) as row_rank,
      up.user_id,
      p.username,
      up.completed_count,
      up.current_index
    from public.user_campaign_progress as up
    join public.profiles as p
      on p.id = up.user_id
    where up.campaign_id = list_campaign_leaderboard.campaign_id
      and (
        not friends_only
        or up.user_id = current_user_id
        or exists (
          select 1
          from public.friendships as f
          where
            (
              f.user_one_id = current_user_id
              and f.user_two_id = up.user_id
            )
            or (
              f.user_two_id = current_user_id
              and f.user_one_id = up.user_id
            )
        )
      )
  )
  select
    leaderboard_rows.row_rank::integer,
    leaderboard_rows.user_id,
    leaderboard_rows.username,
    leaderboard_rows.completed_count,
    leaderboard_rows.current_index
  from leaderboard_rows
  order by leaderboard_rows.row_rank asc;
end;
$$;

alter table public.campaigns enable row level security;
alter table public.campaign_challenges enable row level security;
alter table public.campaign_assets enable row level security;
alter table public.user_campaign_progress enable row level security;
alter table public.user_campaign_attempts enable row level security;
alter table public.user_word_pack_unlocks enable row level security;

drop policy if exists "Authenticated users can read campaigns" on public.campaigns;
create policy "Authenticated users can read campaigns"
on public.campaigns
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read campaign challenges" on public.campaign_challenges;
create policy "Authenticated users can read campaign challenges"
on public.campaign_challenges
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read campaign assets" on public.campaign_assets;
create policy "Authenticated users can read campaign assets"
on public.campaign_assets
for select
to authenticated
using (true);

drop policy if exists "Users can read their campaign progress" on public.user_campaign_progress;
create policy "Users can read their campaign progress"
on public.user_campaign_progress
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can read their campaign attempts" on public.user_campaign_attempts;
create policy "Users can read their campaign attempts"
on public.user_campaign_attempts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can read their pack unlocks" on public.user_word_pack_unlocks;
create policy "Users can read their pack unlocks"
on public.user_word_pack_unlocks
for select
to authenticated
using (user_id = auth.uid());

grant select on public.campaigns to authenticated;
grant select on public.campaign_challenges to authenticated;
grant select on public.campaign_assets to authenticated;
grant select on public.user_campaign_progress to authenticated;
grant select on public.user_campaign_attempts to authenticated;
grant select on public.user_word_pack_unlocks to authenticated;

grant all on public.campaigns to service_role;
grant all on public.campaign_challenges to service_role;
grant all on public.campaign_assets to service_role;
grant all on public.user_campaign_progress to service_role;
grant all on public.user_campaign_attempts to service_role;
grant all on public.user_word_pack_unlocks to service_role;

grant execute on function public.get_active_campaign_state(uuid) to authenticated;
grant execute on function public.consume_campaign_attempt(uuid) to authenticated;
grant execute on function public.complete_campaign_challenge(uuid, integer, text, numeric) to authenticated;
grant execute on function public.list_campaign_leaderboard(uuid, boolean) to authenticated;
