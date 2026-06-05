create or replace function public.score_guess_trace(
  correct_phrase_input text,
  guess_events_input jsonb,
  guess_mistake_count_input integer
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized_events jsonb := coalesce(guess_events_input, '[]'::jsonb);
  normalized_mistake_count integer := greatest(coalesce(guess_mistake_count_input, 0), 0);
  target_letter_count integer := 0;
  correct_letter_count integer := 0;
  correct_ratio numeric := 0;
begin
  if jsonb_typeof(normalized_events) <> 'array' then
    raise exception 'Guess events must be a JSON array.';
  end if;

  with target_letters as (
    select
      phrase_positions.position - 1 as event_index,
      substr(coalesce(correct_phrase_input, ''), phrase_positions.position, 1) as expected
    from generate_series(1, char_length(coalesce(correct_phrase_input, ''))) as phrase_positions(position)
    where substr(coalesce(correct_phrase_input, ''), phrase_positions.position, 1) !~ '^\s$'
  ),
  event_values as (
    select
      case
        when event.value->>'index' ~ '^[0-9]+$' then (event.value->>'index')::integer
        else null
      end as event_index,
      left(coalesce(event.value->>'value', ''), 1) as guessed
    from jsonb_array_elements(normalized_events) as event(value)
    where jsonb_typeof(event.value) = 'object'
  )
  select
    count(distinct event_values.event_index),
    (select count(*) from target_letters)
  into correct_letter_count, target_letter_count
  from event_values
  join target_letters on target_letters.event_index = event_values.event_index
  where lower(event_values.guessed) = lower(target_letters.expected);

  if target_letter_count = 0 then
    return case when normalized_mistake_count = 0 then 10 else 0 end;
  end if;

  if correct_letter_count = target_letter_count then
    return case
      when normalized_mistake_count = 0 then 10
      when normalized_mistake_count < 3 then 8
      when normalized_mistake_count < 5 then 5
      else 0
    end;
  end if;

  if normalized_mistake_count >= 5 then
    correct_ratio := correct_letter_count::numeric / target_letter_count;

    return case
      when correct_ratio > 0.75 then 8
      when correct_ratio > 0.5 then 5
      else 0
    end;
  end if;

  return 0;
end;
$$;

grant execute on function public.score_guess_trace(text, jsonb, integer) to authenticated;

create or replace function public.complete_round_and_award_resources(
  round_id uuid,
  guess_input text,
  score_input integer,
  difficulty_input text,
  guess_events_input jsonb,
  guess_mistake_count_input integer
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
  normalized_guess_events jsonb := coalesce(guess_events_input, '[]'::jsonb);
  normalized_mistake_count integer := guess_mistake_count_input;
  expected_score integer;
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

  if jsonb_typeof(normalized_guess_events) <> 'array' then
    raise exception 'Guess events must be a JSON array.';
  end if;

  if jsonb_array_length(normalized_guess_events) > 1000 then
    raise exception 'Guess events are too large.';
  end if;

  if normalized_mistake_count is not null and normalized_mistake_count < 0 then
    raise exception 'Mistake count must be zero or greater.';
  end if;

  select r.*
  into round_row
  from public.rounds as r
  where r.id = complete_round_and_award_resources.round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if normalized_mistake_count is not null then
    expected_score := public.score_guess_trace(
      round_row.correct_phrase,
      normalized_guess_events,
      normalized_mistake_count
    );

    if score_input is distinct from expected_score then
      raise exception 'Score does not match the guess progress.';
    end if;
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

  if round_row.attempt_audio_path is null then
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

  update public.rounds as r
  set
    guess = normalized_guess,
    guess_events = normalized_guess_events,
    guess_mistake_count = normalized_mistake_count,
    score = score_input,
    status = 'complete',
    difficulty = normalized_difficulty
  where r.id = round_row.id
  returning r.* into round_row;

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
  on conflict on constraint round_rewards_round_id_user_id_key do nothing;

  return round_row;
end;
$$;

create or replace function public.complete_chat_round(
  chat_round_id uuid,
  guess_input text,
  guess_events_input jsonb,
  guess_mistake_count_input integer,
  gave_up_input boolean
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  normalized_guess text := lower(regexp_replace(btrim(coalesce(guess_input, '')), '[[:space:]]+', ' ', 'g'));
  normalized_guess_events jsonb := coalesce(guess_events_input, '[]'::jsonb);
  normalized_mistake_count integer := greatest(coalesce(guess_mistake_count_input, 0), 0);
  normalized_gave_up boolean := coalesce(gave_up_input, false);
  expected_score integer := 0;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to finish a chat round.';
  end if;

  if chat_round_id is null then
    raise exception 'A round id is required.';
  end if;

  if jsonb_typeof(normalized_guess_events) <> 'array' then
    raise exception 'Guess events must be a JSON array.';
  end if;

  if jsonb_array_length(normalized_guess_events) > 1000 then
    raise exception 'Too many guess events were submitted.';
  end if;

  select r.*
  into round_row
  from public.rounds as r
  where r.id = complete_chat_round.chat_round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if round_row.round_mode <> 'chat' then
    raise exception 'This round is not a chat round.';
  end if;

  if round_row.recipient_id <> current_user_id then
    raise exception 'Only the recipient can finish this chat round.';
  end if;

  if round_row.status = 'complete' then
    return round_row;
  end if;

  if round_row.status <> 'attempted' then
    raise exception 'Record an imitation before guessing.';
  end if;

  if round_row.attempt_audio_path is null then
    raise exception 'Record an imitation before guessing.';
  end if;

  expected_score := case
    when normalized_gave_up and normalized_mistake_count < 5 then 0
    else public.score_guess_trace(
      round_row.correct_phrase,
      normalized_guess_events,
      normalized_mistake_count
    )
  end;

  if
    not normalized_gave_up
    and normalized_guess <> round_row.correct_phrase
    and normalized_mistake_count < 5
  then
    raise exception 'The guess is not complete yet.';
  end if;

  update public.rounds as r
  set
    guess = normalized_guess,
    guess_events = normalized_guess_events,
    guess_mistake_count = normalized_mistake_count,
    chat_gave_up = normalized_gave_up,
    recipient_chat_read_at = timezone('utc'::text, now()),
    sender_chat_read_at = null,
    score = expected_score,
    recipient_viewed_results_at = coalesce(r.recipient_viewed_results_at, timezone('utc'::text, now())),
    status = 'complete'
  where r.id = round_row.id
  returning r.* into round_row;

  return round_row;
end;
$$;

grant execute on function public.complete_round_and_award_resources(uuid, text, integer, text, jsonb, integer) to authenticated;
grant execute on function public.complete_chat_round(uuid, text, jsonb, integer, boolean) to authenticated;
