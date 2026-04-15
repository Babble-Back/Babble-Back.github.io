alter table public.rounds
  add column if not exists pack_id uuid references public.word_packs (id) on delete set null;

create index if not exists idx_rounds_pack_id
on public.rounds (pack_id);

create index if not exists idx_campaigns_reward_pack_id
on public.campaigns (reward_pack_id);

alter table public.round_rewards
  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null,
  add column if not exists campaign_resource_type text,
  add column if not exists campaign_reward_amount integer not null default 0
  check (campaign_reward_amount >= 0);

create or replace function public.seeded_reward_roll(seed text)
returns double precision
language sql
immutable
set search_path = public
as $$
  with digest as (
    select decode(md5(coalesce(seed, '')), 'hex') as bytes
  )
  select (
    (
      get_byte(bytes, 0)::bigint * 16777216 +
      get_byte(bytes, 1)::bigint * 65536 +
      get_byte(bytes, 2)::bigint * 256 +
      get_byte(bytes, 3)::bigint
    )::double precision / 4294967295.0
  )
  from digest;
$$;

create or replace function public.get_campaign_currency_resource_type(config jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(btrim(coalesce(config -> 'currency' ->> 'resource_type', '')), '');
$$;

create or replace function public.get_campaign_currency_name(config jsonb, amount integer default 2)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    btrim(
      coalesce(
        case
          when coalesce(amount, 0) = 1 then config -> 'currency' ->> 'singular_name'
          else config -> 'currency' ->> 'plural_name'
        end,
        config -> 'currency' ->> 'plural_name',
        config -> 'currency' ->> 'singular_name',
        ''
      )
    ),
    ''
  );
$$;

create or replace function public.get_campaign_pack_unlock_cost(config jsonb, difficulty text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(difficulty, '')))
    when 'easy' then coalesce((config -> 'currency' -> 'pack_costs' ->> 'easy')::integer, 25)
    when 'medium' then coalesce((config -> 'currency' -> 'pack_costs' ->> 'medium')::integer, 50)
    when 'hard' then coalesce((config -> 'currency' -> 'pack_costs' ->> 'hard')::integer, 150)
    else null
  end;
$$;

create or replace function public.calculate_campaign_currency_reward_count(
  difficulty text,
  seed text
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized_difficulty text := lower(btrim(coalesce(difficulty, '')));
  first_item_chance double precision := 0;
  repeated_item_chance double precision := 0;
  next_item_chance double precision := 0;
  reward_count integer := 0;
  roll_value double precision := 0;
begin
  case normalized_difficulty
    when 'easy' then
      first_item_chance := 0.25;
      repeated_item_chance := 0.15;
    when 'medium' then
      first_item_chance := 0.50;
      repeated_item_chance := 0.25;
    when 'hard' then
      first_item_chance := 1.00;
      repeated_item_chance := 0.50;
    else
      return 0;
  end case;

  for item_index in 1..5 loop
    if item_index = 1 then
      next_item_chance := first_item_chance;
    elsif item_index = 2 then
      next_item_chance := repeated_item_chance;
    else
      next_item_chance := repeated_item_chance / power(2::double precision, item_index - 2);
    end if;

    if next_item_chance <= 0 then
      exit;
    end if;

    roll_value := public.seeded_reward_roll(concat_ws(':', seed, item_index::text));

    if roll_value <= next_item_chance then
      reward_count := reward_count + 1;
    else
      exit;
    end if;
  end loop;

  return reward_count;
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
  campaign_row public.campaigns%rowtype;
  normalized_guess text := btrim(coalesce(guess_input, ''));
  normalized_difficulty text := lower(btrim(coalesce(difficulty_input, '')));
  stars integer;
  difficulty_multiplier integer;
  coins_awarded integer;
  campaign_currency_type text := null;
  campaign_currency_amount integer := 0;
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

  if round_row.pack_id is not null then
    select c.*
    into campaign_row
    from public.campaigns as c
    where c.reward_pack_id = round_row.pack_id
    order by c.is_active desc, c.end_date desc nulls last, c.start_date desc nulls last, c.id desc
    limit 1;

    campaign_currency_type := public.get_campaign_currency_resource_type(campaign_row.config);

    if stars = 3 and campaign_currency_type is not null then
      campaign_currency_amount := public.calculate_campaign_currency_reward_count(
        normalized_difficulty,
        round_row.id::text
      );
    end if;
  end if;

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
    reward_amount,
    campaign_id,
    campaign_resource_type,
    campaign_reward_amount
  )
  values
    (
      round_row.id,
      round_row.sender_id,
      stars,
      normalized_difficulty,
      coins_awarded,
      campaign_row.id,
      campaign_currency_type,
      campaign_currency_amount
    ),
    (
      round_row.id,
      round_row.recipient_id,
      stars,
      normalized_difficulty,
      coins_awarded,
      campaign_row.id,
      campaign_currency_type,
      campaign_currency_amount
    )
  on conflict (round_id, user_id) do nothing;

  return round_row;
end;
$$;

drop function if exists public.claim_round_reward(uuid);

create function public.claim_round_reward(claim_round_id uuid)
returns table (
  id uuid,
  round_id uuid,
  user_id uuid,
  stars integer,
  difficulty text,
  reward_amount integer,
  claimed boolean,
  created_at timestamptz,
  campaign_id uuid,
  campaign_resource_type text,
  campaign_reward_amount integer,
  claimed_now boolean,
  current_balance integer,
  campaign_current_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  reward_row public.round_rewards%rowtype;
  inserted_coin_transaction_id uuid;
  inserted_currency_transaction_id uuid;
  reward_claimed_now boolean := false;
  current_balance_value integer := 0;
  campaign_current_balance_value integer := 0;
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

    if reward_row.reward_amount > 0 then
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
      returning id into inserted_coin_transaction_id;

      if inserted_coin_transaction_id is not null then
        perform public.increment_resource(current_user_id, 'bb_coin', reward_row.reward_amount);
      end if;
    end if;

    if reward_row.campaign_resource_type is not null and reward_row.campaign_reward_amount > 0 then
      insert into public.transactions (
        user_id,
        resource_type,
        amount,
        reason,
        metadata
      )
      values (
        current_user_id,
        reward_row.campaign_resource_type,
        reward_row.campaign_reward_amount,
        'round_reward',
        jsonb_build_object(
          'round_id', reward_row.round_id,
          'campaign_id', reward_row.campaign_id,
          'stars', reward_row.stars,
          'difficulty', reward_row.difficulty
        )
      )
      on conflict do nothing
      returning id into inserted_currency_transaction_id;

      if inserted_currency_transaction_id is not null then
        perform public.increment_resource(
          current_user_id,
          reward_row.campaign_resource_type,
          reward_row.campaign_reward_amount
        );
      end if;
    end if;

    reward_claimed_now :=
      inserted_coin_transaction_id is not null
      or inserted_currency_transaction_id is not null;
  end if;

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  if reward_row.campaign_resource_type is not null then
    select ur.amount
    into campaign_current_balance_value
    from public.user_resources as ur
    where ur.user_id = current_user_id
      and ur.resource_type = reward_row.campaign_resource_type;

    campaign_current_balance_value := coalesce(campaign_current_balance_value, 0);
  end if;

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
    reward_row.campaign_id,
    reward_row.campaign_resource_type,
    reward_row.campaign_reward_amount,
    reward_claimed_now,
    current_balance_value,
    case
      when reward_row.campaign_resource_type is null then null
      else campaign_current_balance_value
    end;
end;
$$;

drop function if exists public.award_campaign_attempt_reward(uuid, integer, text, numeric);

create function public.award_campaign_attempt_reward(
  reward_challenge_id uuid,
  stars_input integer,
  transcript_input text,
  score_input numeric
)
returns table (
  result_challenge_id uuid,
  result_user_id uuid,
  result_current_balance integer,
  result_reward_amount integer,
  result_currency_resource_type text,
  result_currency_reward_amount integer,
  result_currency_current_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  challenge_row public.campaign_challenges%rowtype;
  progress_row public.user_campaign_progress%rowtype;
  attempt_row public.user_campaign_attempts%rowtype;
  current_balance_value integer := 0;
  difficulty_multiplier_value integer := 0;
  reward_amount_value integer := 0;
  actual_reward_amount_value integer := 0;
  reward_key_value text := null;
  inserted_transaction_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to award a campaign attempt reward.';
  end if;

  if reward_challenge_id is null then
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
  where cc.id = reward_challenge_id
    and c.is_active
    and (c.start_date is null or c.start_date <= timezone('utc'::text, now()))
    and (c.end_date is null or c.end_date >= timezone('utc'::text, now()))
  for update;

  if challenge_row.id is null then
    raise exception 'Challenge not found.';
  end if;

  insert into public.user_campaign_progress (
    user_id,
    campaign_id,
    current_index,
    completed_count
  )
  values (
    current_user_id,
    challenge_row.campaign_id,
    1,
    0
  )
  on conflict (user_id, campaign_id) do nothing;

  select ucp.*
  into progress_row
  from public.user_campaign_progress as ucp
  where ucp.user_id = current_user_id
    and ucp.campaign_id = challenge_row.campaign_id
  for update;

  if progress_row.current_index <> challenge_row.challenge_index then
    raise exception 'Only the current campaign challenge can receive an attempt reward.';
  end if;

  select uca.*
  into attempt_row
  from public.user_campaign_attempts as uca
  where uca.user_id = current_user_id
    and uca.challenge_id = challenge_row.id
  for update;

  if attempt_row.user_id is null then
    raise exception 'No active campaign attempt was found for this challenge.';
  end if;

  if attempt_row.last_attempt_date is null then
    raise exception 'Campaign attempt metadata is missing for this challenge.';
  end if;

  difficulty_multiplier_value := case challenge_row.difficulty
    when 'easy' then 1
    when 'medium' then 2
    when 'hard' then 3
    else 0
  end;

  reward_amount_value := greatest(0, stars_input) * difficulty_multiplier_value;
  reward_key_value := concat_ws(
    ':',
    current_user_id::text,
    challenge_row.id::text,
    attempt_row.last_attempt_date::text,
    greatest(coalesce(attempt_row.attempts_today, 0), 0)::text
  );

  if reward_amount_value > 0 then
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
      reward_amount_value,
      'campaign_reward',
      jsonb_build_object(
        'reward_key', reward_key_value,
        'campaign_id', challenge_row.campaign_id,
        'challenge_id', challenge_row.id,
        'attempt_date', attempt_row.last_attempt_date,
        'attempts_today', attempt_row.attempts_today,
        'stars', stars_input,
        'difficulty', challenge_row.difficulty,
        'score', score_input,
        'transcript', transcript_input
      )
    )
    on conflict do nothing
    returning id into inserted_transaction_id;

    if inserted_transaction_id is not null then
      perform public.increment_resource(current_user_id, 'bb_coin', reward_amount_value);
      actual_reward_amount_value := reward_amount_value;
    end if;
  end if;

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  result_challenge_id := challenge_row.id;
  result_user_id := current_user_id;
  result_current_balance := current_balance_value;
  result_reward_amount := actual_reward_amount_value;
  result_currency_resource_type := null;
  result_currency_reward_amount := 0;
  result_currency_current_balance := null;
  return next;
end;
$$;

drop function if exists public.complete_campaign_challenge(uuid, integer, text, numeric);

create function public.complete_campaign_challenge(
  complete_challenge_id uuid,
  stars_input integer,
  transcript_input text,
  score_input numeric
)
returns table (
  result_campaign_id uuid,
  result_challenge_id uuid,
  result_user_id uuid,
  result_current_index integer,
  result_completed_count integer,
  result_unlocked_pack_ids uuid[],
  result_newly_unlocked_pack_ids uuid[],
  result_campaign_complete boolean,
  result_advanced boolean,
  result_current_balance integer,
  result_reward_amount integer,
  result_currency_resource_type text,
  result_currency_reward_amount integer,
  result_currency_current_balance integer
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
  challenge_count integer := 0;
  next_current_index integer := 0;
  next_completed_count integer := 0;
  next_unlock_difficulty text := null;
  unlocked_pack_ids_value uuid[] := array[]::uuid[];
  newly_unlocked_pack_ids_value uuid[] := array[]::uuid[];
  current_balance_value integer := 0;
  difficulty_multiplier_value integer := 0;
  reward_amount_value integer := 0;
  actual_reward_amount_value integer := 0;
  reward_key_value text := null;
  inserted_transaction_id uuid;
  campaign_currency_type text := null;
  campaign_currency_amount integer := 0;
  actual_campaign_currency_amount integer := 0;
  campaign_currency_balance_value integer := 0;
  inserted_currency_transaction_id uuid;
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

  result_campaign_id := campaign_row.id;
  result_challenge_id := challenge_row.id;
  result_user_id := current_user_id;
  result_reward_amount := 0;
  result_currency_resource_type := null;
  result_currency_reward_amount := 0;
  result_currency_current_balance := null;

  select coalesce(array_agg(distinct unlock_row.pack_id order by unlock_row.pack_id), array[]::uuid[])
  into unlocked_pack_ids_value
  from public.user_word_pack_unlocks as unlock_row
  where unlock_row.user_id = current_user_id;

  if progress_row.current_index > challenge_row.challenge_index then
    select ur.amount
    into current_balance_value
    from public.user_resources as ur
    where ur.user_id = current_user_id
      and ur.resource_type = 'bb_coin';

    current_balance_value := coalesce(current_balance_value, 0);

    result_current_index := progress_row.current_index;
    result_completed_count := progress_row.completed_count;
    result_unlocked_pack_ids := unlocked_pack_ids_value;
    result_newly_unlocked_pack_ids := array[]::uuid[];
    result_campaign_complete := progress_row.current_index > challenge_count;
    result_advanced := false;
    result_current_balance := current_balance_value;
    return next;
  end if;

  if progress_row.current_index <> challenge_row.challenge_index then
    raise exception 'Only the current campaign challenge can be completed.';
  end if;

  select uca.*
  into attempt_row
  from public.user_campaign_attempts as uca
  where uca.user_id = current_user_id
    and uca.challenge_id = challenge_row.id
  for update;

  if attempt_row.user_id is null then
    raise exception 'No active campaign attempt was found for this challenge.';
  end if;

  if attempt_row.last_attempt_date is null then
    raise exception 'Campaign attempt metadata is missing for this challenge.';
  end if;

  if stars_input < 3 then
    select ur.amount
    into current_balance_value
    from public.user_resources as ur
    where ur.user_id = current_user_id
      and ur.resource_type = 'bb_coin';

    current_balance_value := coalesce(current_balance_value, 0);

    result_current_index := progress_row.current_index;
    result_completed_count := progress_row.completed_count;
    result_unlocked_pack_ids := unlocked_pack_ids_value;
    result_newly_unlocked_pack_ids := array[]::uuid[];
    result_campaign_complete := progress_row.current_index > challenge_count;
    result_advanced := false;
    result_current_balance := current_balance_value;
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

  difficulty_multiplier_value := case challenge_row.difficulty
    when 'easy' then 1
    when 'medium' then 2
    when 'hard' then 3
    else 0
  end;

  reward_amount_value := greatest(0, stars_input) * difficulty_multiplier_value;
  reward_key_value := concat_ws(
    ':',
    current_user_id::text,
    challenge_row.id::text,
    attempt_row.last_attempt_date::text,
    greatest(coalesce(attempt_row.attempts_today, 0), 0)::text
  );

  if reward_amount_value > 0 then
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
      reward_amount_value,
      'campaign_reward',
      jsonb_build_object(
        'reward_key', reward_key_value,
        'campaign_id', campaign_row.id,
        'challenge_id', challenge_row.id,
        'attempt_date', attempt_row.last_attempt_date,
        'attempts_today', attempt_row.attempts_today,
        'stars', stars_input,
        'difficulty', challenge_row.difficulty,
        'score', score_input,
        'transcript', transcript_input
      )
    )
    on conflict do nothing
    returning id into inserted_transaction_id;

    if inserted_transaction_id is not null then
      perform public.increment_resource(current_user_id, 'bb_coin', reward_amount_value);
      actual_reward_amount_value := reward_amount_value;
    end if;
  end if;

  campaign_currency_type := public.get_campaign_currency_resource_type(campaign_row.config);
  result_currency_resource_type := campaign_currency_type;

  if campaign_currency_type is not null then
    campaign_currency_amount := public.calculate_campaign_currency_reward_count(
      challenge_row.difficulty,
      reward_key_value
    );

    if campaign_currency_amount > 0 then
      insert into public.transactions (
        user_id,
        resource_type,
        amount,
        reason,
        metadata
      )
      values (
        current_user_id,
        campaign_currency_type,
        campaign_currency_amount,
        'campaign_reward',
        jsonb_build_object(
          'reward_key', reward_key_value,
          'campaign_id', campaign_row.id,
          'challenge_id', challenge_row.id,
          'attempt_date', attempt_row.last_attempt_date,
          'attempts_today', attempt_row.attempts_today,
          'stars', stars_input,
          'difficulty', challenge_row.difficulty,
          'score', score_input,
          'transcript', transcript_input,
          'reward_kind', 'campaign_currency'
        )
      )
      on conflict do nothing
      returning id into inserted_currency_transaction_id;

      if inserted_currency_transaction_id is not null then
        perform public.increment_resource(
          current_user_id,
          campaign_currency_type,
          campaign_currency_amount
        );
        actual_campaign_currency_amount := campaign_currency_amount;
      end if;
    end if;
  end if;

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

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  if campaign_currency_type is not null then
    select ur.amount
    into campaign_currency_balance_value
    from public.user_resources as ur
    where ur.user_id = current_user_id
      and ur.resource_type = campaign_currency_type;

    campaign_currency_balance_value := coalesce(campaign_currency_balance_value, 0);
  end if;

  result_current_index := next_current_index;
  result_completed_count := next_completed_count;
  result_unlocked_pack_ids := unlocked_pack_ids_value;
  result_newly_unlocked_pack_ids := newly_unlocked_pack_ids_value;
  result_campaign_complete := next_current_index > challenge_count;
  result_advanced := true;
  result_current_balance := current_balance_value;
  result_reward_amount := actual_reward_amount_value;
  result_currency_reward_amount := actual_campaign_currency_amount;
  result_currency_current_balance := case
    when campaign_currency_type is null then null
    else campaign_currency_balance_value
  end;
  return next;
end;
$$;

create or replace function public.purchase_campaign_pack_unlock(purchase_pack_id uuid)
returns table (
  result_pack_id uuid,
  result_campaign_id uuid,
  result_resource_type text,
  result_spent_amount integer,
  result_current_resource_balance integer,
  result_max_unlocked_difficulty text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  campaign_row public.campaigns%rowtype;
  unlock_row public.user_word_pack_unlocks%rowtype;
  currency_resource_type text := null;
  currency_name text := null;
  current_currency_balance integer := 0;
  current_unlock_rank integer := 0;
  next_unlock_difficulty text := null;
  next_unlock_cost integer := 0;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to unlock a campaign pack.';
  end if;

  if purchase_pack_id is null then
    raise exception 'A pack id is required.';
  end if;

  select c.*
  into campaign_row
  from public.campaigns as c
  where c.reward_pack_id = purchase_pack_id
  order by c.is_active desc, c.end_date desc nulls last, c.start_date desc nulls last, c.id desc
  limit 1
  for update;

  if campaign_row.id is null then
    raise exception 'This pack cannot be unlocked with campaign currency.';
  end if;

  currency_resource_type := public.get_campaign_currency_resource_type(campaign_row.config);
  currency_name := public.get_campaign_currency_name(campaign_row.config, 2);

  if currency_resource_type is null then
    raise exception 'This campaign does not define a currency reward.';
  end if;

  select uwpu.*
  into unlock_row
  from public.user_word_pack_unlocks as uwpu
  where uwpu.user_id = current_user_id
    and uwpu.pack_id = purchase_pack_id
  for update;

  current_unlock_rank := public.word_difficulty_rank(unlock_row.max_unlocked_difficulty);

  if current_unlock_rank >= 3 then
    raise exception 'This pack is already fully unlocked.';
  end if;

  next_unlock_difficulty := case current_unlock_rank
    when 0 then 'easy'
    when 1 then 'medium'
    when 2 then 'hard'
    else null
  end;

  next_unlock_cost := coalesce(
    public.get_campaign_pack_unlock_cost(campaign_row.config, next_unlock_difficulty),
    0
  );

  if next_unlock_difficulty is null or next_unlock_cost <= 0 then
    raise exception 'The next campaign-pack unlock tier is not available.';
  end if;

  select ur.amount
  into current_currency_balance
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = currency_resource_type
  for update;

  current_currency_balance := coalesce(current_currency_balance, 0);

  if current_currency_balance < next_unlock_cost then
    raise exception 'You need % % to unlock this tier.', next_unlock_cost, coalesce(currency_name, 'currency');
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
    currency_resource_type,
    -next_unlock_cost,
    'campaign_pack_purchase',
    jsonb_build_object(
      'campaign_id', campaign_row.id,
      'pack_id', purchase_pack_id,
      'difficulty', next_unlock_difficulty
    )
  );

  perform public.increment_resource(current_user_id, currency_resource_type, -next_unlock_cost);

  insert into public.user_word_pack_unlocks (
    user_id,
    pack_id,
    source_campaign_id,
    max_unlocked_difficulty,
    unlocked_at
  )
  values (
    current_user_id,
    purchase_pack_id,
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
    public.word_difficulty_rank(public.user_word_pack_unlocks.max_unlocked_difficulty);

  select ur.amount
  into current_currency_balance
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = currency_resource_type;

  current_currency_balance := coalesce(current_currency_balance, 0);

  result_pack_id := purchase_pack_id;
  result_campaign_id := campaign_row.id;
  result_resource_type := currency_resource_type;
  result_spent_amount := next_unlock_cost;
  result_current_resource_balance := current_currency_balance;
  result_max_unlocked_difficulty := next_unlock_difficulty;
  return next;
end;
$$;

grant execute on function public.complete_round_and_award_resources(uuid, text, integer, text) to authenticated;
grant execute on function public.claim_round_reward(uuid) to authenticated;
grant execute on function public.award_campaign_attempt_reward(uuid, integer, text, numeric) to authenticated;
grant execute on function public.award_campaign_attempt_reward(uuid, integer, text, numeric) to service_role;
grant execute on function public.complete_campaign_challenge(uuid, integer, text, numeric) to authenticated;
grant execute on function public.complete_campaign_challenge(uuid, integer, text, numeric) to service_role;
grant execute on function public.purchase_campaign_pack_unlock(uuid) to authenticated;
grant execute on function public.purchase_campaign_pack_unlock(uuid) to service_role;
