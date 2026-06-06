alter table public.rounds
add column if not exists chat_audio_expires_at timestamptz;

create index if not exists rounds_chat_audio_expires_at_idx
on public.rounds (chat_audio_expires_at)
where round_mode = 'chat'
  and chat_audio_expires_at is not null;

update public.rounds as r
set
  chat_collapsed_at = coalesce(
    r.chat_collapsed_at,
    greatest(r.sender_viewed_results_at, r.recipient_viewed_results_at)
  ),
  chat_audio_expires_at = coalesce(
    r.chat_audio_expires_at,
    coalesce(
      r.chat_collapsed_at,
      greatest(r.sender_viewed_results_at, r.recipient_viewed_results_at)
    ) + interval '1 day'
  )
where r.round_mode = 'chat'
  and r.status = 'complete'
  and r.sender_viewed_results_at is not null
  and r.recipient_viewed_results_at is not null;

create or replace function public.mark_round_results_viewed(view_round_id uuid)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  viewed_at timestamptz := timezone('utc'::text, now());
begin
  if current_user_id is null then
    raise exception 'You must be logged in to open round results.';
  end if;

  if view_round_id is null then
    raise exception 'A round id is required.';
  end if;

  select r.*
  into round_row
  from public.rounds as r
  where r.id = view_round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if round_row.status <> 'complete' then
    return round_row;
  end if;

  if current_user_id <> round_row.sender_id and current_user_id <> round_row.recipient_id then
    raise exception 'You do not have access to this round.';
  end if;

  update public.rounds as r
  set
    sender_viewed_results_at = case
      when current_user_id = r.sender_id then coalesce(r.sender_viewed_results_at, viewed_at)
      else r.sender_viewed_results_at
    end,
    recipient_viewed_results_at = case
      when current_user_id = r.recipient_id then coalesce(r.recipient_viewed_results_at, viewed_at)
      else r.recipient_viewed_results_at
    end
  where r.id = round_row.id
  returning r.* into round_row;

  if
    round_row.round_mode = 'chat'
    and round_row.sender_viewed_results_at is not null
    and round_row.recipient_viewed_results_at is not null
    and (round_row.chat_collapsed_at is null or round_row.chat_audio_expires_at is null)
  then
    update public.rounds as r
    set
      chat_collapsed_at = coalesce(r.chat_collapsed_at, viewed_at),
      chat_audio_expires_at = coalesce(r.chat_audio_expires_at, viewed_at + interval '1 day')
    where r.id = round_row.id
    returning r.* into round_row;
  end if;

  return round_row;
end;
$$;

drop function if exists public.complete_chat_round(uuid, text, jsonb, integer, boolean);

create function public.complete_chat_round(
  chat_round_id uuid,
  guess_input text,
  guess_events_input jsonb,
  guess_mistake_count_input integer,
  gave_up_input boolean,
  attempt_audio_path_input text default null
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  normalized_guess text := regexp_replace(btrim(coalesce(guess_input, '')), '[[:space:]]+', ' ', 'g');
  normalized_guess_compare text := lower(regexp_replace(btrim(coalesce(guess_input, '')), '[[:space:]]+', ' ', 'g'));
  normalized_correct_compare text;
  normalized_guess_events jsonb := coalesce(guess_events_input, '[]'::jsonb);
  normalized_mistake_count integer := greatest(coalesce(guess_mistake_count_input, 0), 0);
  normalized_gave_up boolean := coalesce(gave_up_input, false);
  normalized_attempt_audio_path text := nullif(btrim(coalesce(attempt_audio_path_input, '')), '');
  expected_score integer;
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

  if round_row.status not in ('waiting_for_attempt', 'attempted') then
    raise exception 'Record an imitation before guessing.';
  end if;

  if round_row.attempt_audio_path is null and normalized_attempt_audio_path is null then
    raise exception 'Record an imitation before guessing.';
  end if;

  if normalized_attempt_audio_path is not null
    and normalized_attempt_audio_path not like (
      'rounds/' || current_user_id::text || '/' || round_row.id::text || '/%'
    )
  then
    raise exception 'The imitation audio path is not valid for this round.';
  end if;

  normalized_correct_compare := lower(regexp_replace(btrim(coalesce(round_row.correct_phrase, '')), '[[:space:]]+', ' ', 'g'));

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
    and normalized_guess_compare <> normalized_correct_compare
    and normalized_mistake_count < 5
  then
    raise exception 'The guess is not complete yet.';
  end if;

  update public.rounds as r
  set
    attempt_audio_path = coalesce(r.attempt_audio_path, normalized_attempt_audio_path),
    attempt_reversed_path = null,
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

grant execute on function public.mark_round_results_viewed(uuid) to authenticated;
grant execute on function public.complete_chat_round(uuid, text, jsonb, integer, boolean, text) to authenticated;
