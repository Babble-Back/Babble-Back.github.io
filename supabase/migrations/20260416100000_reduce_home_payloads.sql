create or replace function public.list_home_threads()
returns table (
  friend_id uuid,
  latest_round_id uuid,
  latest_round_created_at timestamptz,
  latest_round_sender_id uuid,
  latest_round_recipient_id uuid,
  latest_round_score integer,
  latest_round_status text,
  active_round_id uuid,
  active_round_created_at timestamptz,
  active_round_sender_id uuid,
  active_round_recipient_id uuid,
  active_round_score integer,
  active_round_status text,
  review_round_id uuid,
  review_round_created_at timestamptz,
  review_round_sender_id uuid,
  review_round_recipient_id uuid,
  review_round_score integer,
  review_round_status text,
  current_round_count integer,
  last_active_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with current_user as (
    select auth.uid() as user_id
  ),
  my_rounds as (
    select
      case
        when r.sender_id = cu.user_id then r.recipient_id
        else r.sender_id
      end as friend_id,
      r.id,
      r.created_at,
      r.sender_id,
      r.recipient_id,
      r.score,
      r.status
    from public.rounds as r
    cross join current_user as cu
    where cu.user_id is not null
      and (r.sender_id = cu.user_id or r.recipient_id = cu.user_id)
  ),
  friend_ids as (
    select distinct my_rounds.friend_id
    from my_rounds
  ),
  latest_rounds as (
    select distinct on (my_rounds.friend_id)
      my_rounds.friend_id,
      my_rounds.id,
      my_rounds.created_at,
      my_rounds.sender_id,
      my_rounds.recipient_id,
      my_rounds.score,
      my_rounds.status
    from my_rounds
    order by my_rounds.friend_id, my_rounds.created_at desc, my_rounds.id desc
  ),
  active_rounds as (
    select distinct on (my_rounds.friend_id)
      my_rounds.friend_id,
      my_rounds.id,
      my_rounds.created_at,
      my_rounds.sender_id,
      my_rounds.recipient_id,
      my_rounds.score,
      my_rounds.status
    from my_rounds
    where my_rounds.status <> 'complete'
    order by my_rounds.friend_id, my_rounds.created_at desc, my_rounds.id desc
  ),
  review_rounds as (
    select distinct on (my_rounds.friend_id)
      my_rounds.friend_id,
      my_rounds.id,
      my_rounds.created_at,
      my_rounds.sender_id,
      my_rounds.recipient_id,
      my_rounds.score,
      my_rounds.status
    from my_rounds
    cross join current_user as cu
    where my_rounds.status = 'complete'
      and my_rounds.sender_id = cu.user_id
    order by my_rounds.friend_id, my_rounds.created_at desc, my_rounds.id desc
  ),
  thread_counts as (
    select
      my_rounds.friend_id,
      count(*)::integer as current_round_count,
      max(my_rounds.created_at) as last_active_at
    from my_rounds
    group by my_rounds.friend_id
  )
  select
    friend_ids.friend_id,
    latest_rounds.id as latest_round_id,
    latest_rounds.created_at as latest_round_created_at,
    latest_rounds.sender_id as latest_round_sender_id,
    latest_rounds.recipient_id as latest_round_recipient_id,
    latest_rounds.score as latest_round_score,
    latest_rounds.status as latest_round_status,
    active_rounds.id as active_round_id,
    active_rounds.created_at as active_round_created_at,
    active_rounds.sender_id as active_round_sender_id,
    active_rounds.recipient_id as active_round_recipient_id,
    active_rounds.score as active_round_score,
    active_rounds.status as active_round_status,
    review_rounds.id as review_round_id,
    review_rounds.created_at as review_round_created_at,
    review_rounds.sender_id as review_round_sender_id,
    review_rounds.recipient_id as review_round_recipient_id,
    review_rounds.score as review_round_score,
    review_rounds.status as review_round_status,
    thread_counts.current_round_count,
    thread_counts.last_active_at
  from friend_ids
  join thread_counts
    on thread_counts.friend_id = friend_ids.friend_id
  left join latest_rounds
    on latest_rounds.friend_id = friend_ids.friend_id
  left join active_rounds
    on active_rounds.friend_id = friend_ids.friend_id
  left join review_rounds
    on review_rounds.friend_id = friend_ids.friend_id
  order by thread_counts.last_active_at desc, friend_ids.friend_id asc;
$$;

grant execute on function public.list_home_threads() to authenticated;

create or replace function public.get_active_campaign_home()
returns table (
  campaign_id uuid,
  banner_image text
)
language sql
security definer
stable
set search_path = public
as $$
  with active_campaign as (
    select c.id
    from public.campaigns as c
    where c.is_active
      and (c.start_date is null or c.start_date <= timezone('utc'::text, now()))
      and (c.end_date is null or c.end_date >= timezone('utc'::text, now()))
    order by c.start_date desc nulls last, c.id desc
    limit 1
  )
  select
    active_campaign.id as campaign_id,
    (
      select ca.value
      from public.campaign_assets as ca
      where ca.campaign_id = active_campaign.id
        and ca.key = 'banner_image'
      order by ca.key asc
      limit 1
    ) as banner_image
  from active_campaign;
$$;

grant execute on function public.get_active_campaign_home() to authenticated;

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
    return query
    select campaign_json, challenges_json, assets_json, progress_json, attempts_json, unlocked_pack_ids_value;
    return;
  end if;

  campaign_json := to_jsonb(campaign_row);

  select coalesce(
    jsonb_agg(to_jsonb(challenge_row) order by challenge_row.challenge_index),
    '[]'::jsonb
  )
  into challenges_json
  from (
    select
      id,
      campaign_id,
      challenge_index,
      phrase,
      difficulty,
      mode,
      created_at,
      lm_token_count,
      lm_ready
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

  return query
  select campaign_json, challenges_json, assets_json, progress_json, attempts_json, unlocked_pack_ids_value;
end;
$$;

grant execute on function public.get_active_campaign_state(uuid) to authenticated;

create or replace function public.get_campaign_challenge_lm_prior(challenge_id uuid)
returns table (
  challenge_id uuid,
  model_name text,
  ready boolean,
  token_count integer,
  token_ids jsonb,
  token_texts jsonb,
  token_probs jsonb,
  token_log_probs jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id as challenge_id,
    c.lm_model_name as model_name,
    c.lm_ready as ready,
    c.lm_token_count as token_count,
    coalesce(c.lm_token_ids, '[]'::jsonb) as token_ids,
    coalesce(c.lm_token_texts, '[]'::jsonb) as token_texts,
    coalesce(c.lm_token_probs, '[]'::jsonb) as token_probs,
    coalesce(c.lm_token_log_probs, '[]'::jsonb) as token_log_probs
  from public.campaign_challenges as c
  where c.id = get_campaign_challenge_lm_prior.challenge_id
  limit 1;
$$;

grant execute on function public.get_campaign_challenge_lm_prior(uuid) to authenticated;
