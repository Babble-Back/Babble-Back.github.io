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

  if attempt_row.last_attempt_date = current_date then
    next_attempts_today := coalesce(attempt_row.attempts_today, 0) + 1;

    select ur.amount
    into current_balance_value
    from public.user_resources as ur
    where ur.user_id = current_user_id
      and ur.resource_type = 'bb_coin'
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

  update public.user_campaign_attempts as uca
  set
    attempts_today = next_attempts_today,
    last_attempt_date = current_date
  where uca.user_id = current_user_id
    and uca.challenge_id = challenge_row.id;

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

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
  next_unlock_difficulty text := null;
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

  select c.*
  into campaign_row
  from public.campaigns as c
  where c.id = challenge_row.campaign_id
  for update;

  select count(*)
  into challenge_count
  from public.campaign_challenges as cc
  where cc.campaign_id = campaign_row.id;

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

  update public.user_campaign_progress as ucp
  set
    current_index = progress_row.current_index + 1,
    completed_count = progress_row.completed_count + 1
  where ucp.user_id = current_user_id
    and ucp.campaign_id = campaign_row.id
  returning ucp.current_index, ucp.completed_count
  into next_current_index, next_completed_count;

  if campaign_row.reward_pack_id is not null then
    if campaign_row.hard_unlock_completed_count is not null
      and next_completed_count >= campaign_row.hard_unlock_completed_count then
      next_unlock_difficulty := 'hard';
    elsif campaign_row.medium_unlock_completed_count is not null
      and next_completed_count >= campaign_row.medium_unlock_completed_count then
      next_unlock_difficulty := 'medium';
    elsif campaign_row.easy_unlock_completed_count is not null
      and next_completed_count >= campaign_row.easy_unlock_completed_count then
      next_unlock_difficulty := 'easy';
    end if;

    if next_unlock_difficulty is not null then
      with reward_unlock as (
        insert into public.user_word_pack_unlocks (
          user_id,
          pack_id,
          source_campaign_id,
          max_unlocked_difficulty,
          unlocked_at
        )
        values (
          current_user_id,
          campaign_row.reward_pack_id,
          campaign_row.id,
          next_unlock_difficulty,
          timezone('utc'::text, now())
        )
        on conflict (user_id, pack_id) do update
        set
          source_campaign_id = excluded.source_campaign_id,
          max_unlocked_difficulty = excluded.max_unlocked_difficulty,
          unlocked_at = excluded.unlocked_at
        where public.word_difficulty_rank(excluded.max_unlocked_difficulty) >
          public.word_difficulty_rank(public.user_word_pack_unlocks.max_unlocked_difficulty)
        returning pack_id
      )
      select coalesce(array_agg(reward_unlock.pack_id order by reward_unlock.pack_id), array[]::uuid[])
      into newly_unlocked_pack_ids_value
      from reward_unlock;
    end if;
  else
    with unlocked_packs as (
      select wp.id as pack_id
      from public.word_packs as wp
      where wp.unlock_tier = challenge_row.difficulty
    ),
    inserted_unlocks as (
      insert into public.user_word_pack_unlocks (
        user_id,
        pack_id,
        source_campaign_id,
        max_unlocked_difficulty
      )
      select
        current_user_id,
        up.pack_id,
        campaign_row.id,
        'hard'
      from unlocked_packs as up
      on conflict (user_id, pack_id) do nothing
      returning pack_id
    )
    select coalesce(array_agg(inserted_unlocks.pack_id order by inserted_unlocks.pack_id), array[]::uuid[])
    into newly_unlocked_pack_ids_value
    from inserted_unlocks;
  end if;

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

grant execute on function public.consume_campaign_attempt(uuid) to authenticated;
grant execute on function public.consume_campaign_attempt(uuid) to service_role;
grant execute on function public.complete_campaign_challenge(uuid, integer, text, numeric) to authenticated;
grant execute on function public.complete_campaign_challenge(uuid, integer, text, numeric) to service_role;
