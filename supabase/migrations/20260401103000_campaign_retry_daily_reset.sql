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
  today_utc date := timezone('utc'::text, now())::date;
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
      case
        when ua.last_attempt_date = today_utc then coalesce(ua.attempts_today, 0)
        else 0
      end as attempts_today,
      ua.last_attempt_date,
      case
        when ua.last_attempt_date = today_utc then coalesce(ua.attempts_today, 0) < 2
        else true
      end as free_attempt_available,
      5 as retry_cost,
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
  result_user_id uuid,
  result_challenge_id uuid,
  result_attempts_today integer,
  result_last_attempt_date date,
  result_free_attempt_available boolean,
  result_retry_cost integer,
  result_current_balance integer,
  result_charged boolean
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
  current_day_attempts integer := 0;
  next_attempts_today integer := 0;
  charged_now boolean := false;
  inserted_transaction_id uuid;
  free_attempt_limit integer := 2;
  retry_cost_value integer := 5;
  today_utc date := timezone('utc'::text, now())::date;
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

  select c.*
  into campaign_row
  from public.campaigns as c
  where c.id = challenge_row.campaign_id
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

  select ucp.*
  into progress_row
  from public.user_campaign_progress as ucp
  where ucp.user_id = current_user_id
    and ucp.campaign_id = campaign_row.id
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

  select uca.*
  into attempt_row
  from public.user_campaign_attempts as uca
  where uca.user_id = current_user_id
    and uca.challenge_id = challenge_row.id
  for update;

  current_day_attempts := case
    when attempt_row.last_attempt_date = today_utc then coalesce(attempt_row.attempts_today, 0)
    else 0
  end;
  next_attempts_today := current_day_attempts + 1;

  if current_day_attempts >= free_attempt_limit then
    select ur.amount
    into current_balance_value
    from public.user_resources as ur
    where ur.user_id = current_user_id
      and ur.resource_type = 'bb_coin'
    for update;

    current_balance_value := coalesce(current_balance_value, 0);

    if current_balance_value < retry_cost_value then
      raise exception 'You need % BB Coins for another campaign retry.', retry_cost_value;
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
      -retry_cost_value,
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

    perform public.increment_resource(current_user_id, 'bb_coin', -retry_cost_value);
    charged_now := true;
  end if;

  update public.user_campaign_attempts as uca
  set
    attempts_today = next_attempts_today,
    last_attempt_date = today_utc
  where uca.user_id = current_user_id
    and uca.challenge_id = challenge_row.id;

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  result_user_id := current_user_id;
  result_challenge_id := challenge_row.id;
  result_attempts_today := next_attempts_today;
  result_last_attempt_date := today_utc;
  result_free_attempt_available := next_attempts_today < free_attempt_limit;
  result_retry_cost := retry_cost_value;
  result_current_balance := current_balance_value;
  result_charged := charged_now;
  return next;
end;
$$;

grant execute on function public.get_active_campaign_state(uuid) to authenticated;
grant execute on function public.get_active_campaign_state(uuid) to service_role;
grant execute on function public.consume_campaign_attempt(uuid) to authenticated;
grant execute on function public.consume_campaign_attempt(uuid) to service_role;
