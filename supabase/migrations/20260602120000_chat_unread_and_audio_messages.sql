alter table public.rounds
add column if not exists sender_chat_read_at timestamptz;

alter table public.rounds
add column if not exists recipient_chat_read_at timestamptz;

update public.rounds as r
set sender_chat_read_at = coalesce(r.sender_chat_read_at, r.created_at)
where r.round_mode = 'chat'
  and r.sender_chat_read_at is null;

update public.rounds as r
set recipient_chat_read_at = coalesce(r.recipient_chat_read_at, r.recipient_viewed_results_at)
where r.round_mode = 'chat'
  and r.status = 'complete'
  and r.recipient_chat_read_at is null;

create index if not exists rounds_chat_read_state_idx
on public.rounds (round_mode, sender_id, recipient_id, updated_at desc);

drop function if exists public.list_home_threads();

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
  chat_unread_count integer,
  chat_last_active_at timestamptz,
  last_active_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with auth_context as (
    select auth.uid() as user_id
  ),
  my_reward_rounds as (
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
    cross join auth_context as cu
    where cu.user_id is not null
      and r.round_mode = 'reward'
      and (r.sender_id = cu.user_id or r.recipient_id = cu.user_id)
  ),
  my_chat_rounds as (
    select
      case
        when r.sender_id = cu.user_id then r.recipient_id
        else r.sender_id
      end as friend_id,
      r.id,
      r.created_at,
      r.updated_at,
      r.sender_id,
      r.recipient_id,
      r.status,
      r.sender_chat_read_at,
      r.recipient_chat_read_at
    from public.rounds as r
    cross join auth_context as cu
    where cu.user_id is not null
      and r.round_mode = 'chat'
      and (r.sender_id = cu.user_id or r.recipient_id = cu.user_id)
  ),
  friend_ids as (
    select distinct my_reward_rounds.friend_id
    from my_reward_rounds
    union
    select distinct my_chat_rounds.friend_id
    from my_chat_rounds
  ),
  latest_rounds as (
    select distinct on (my_reward_rounds.friend_id)
      my_reward_rounds.friend_id,
      my_reward_rounds.id,
      my_reward_rounds.created_at,
      my_reward_rounds.sender_id,
      my_reward_rounds.recipient_id,
      my_reward_rounds.score,
      my_reward_rounds.status
    from my_reward_rounds
    order by my_reward_rounds.friend_id, my_reward_rounds.created_at desc, my_reward_rounds.id desc
  ),
  active_rounds as (
    select distinct on (my_reward_rounds.friend_id)
      my_reward_rounds.friend_id,
      my_reward_rounds.id,
      my_reward_rounds.created_at,
      my_reward_rounds.sender_id,
      my_reward_rounds.recipient_id,
      my_reward_rounds.score,
      my_reward_rounds.status
    from my_reward_rounds
    where my_reward_rounds.status <> 'complete'
    order by my_reward_rounds.friend_id, my_reward_rounds.created_at desc, my_reward_rounds.id desc
  ),
  review_rounds as (
    select distinct on (my_reward_rounds.friend_id)
      my_reward_rounds.friend_id,
      my_reward_rounds.id,
      my_reward_rounds.created_at,
      my_reward_rounds.sender_id,
      my_reward_rounds.recipient_id,
      my_reward_rounds.score,
      my_reward_rounds.status
    from my_reward_rounds
    cross join auth_context as cu
    where my_reward_rounds.status = 'complete'
      and my_reward_rounds.sender_id = cu.user_id
    order by my_reward_rounds.friend_id, my_reward_rounds.created_at desc, my_reward_rounds.id desc
  ),
  reward_thread_counts as (
    select
      my_reward_rounds.friend_id,
      count(*)::integer as current_round_count,
      max(my_reward_rounds.created_at) as last_active_at
    from my_reward_rounds
    group by my_reward_rounds.friend_id
  ),
  chat_thread_counts as (
    select
      my_chat_rounds.friend_id,
      count(*) filter (
        where (
          my_chat_rounds.sender_id = cu.user_id
          and my_chat_rounds.status in ('attempted', 'complete')
          and (
            my_chat_rounds.sender_chat_read_at is null
            or my_chat_rounds.sender_chat_read_at < my_chat_rounds.updated_at
          )
        )
        or (
          my_chat_rounds.recipient_id = cu.user_id
          and my_chat_rounds.status = 'waiting_for_attempt'
          and (
            my_chat_rounds.recipient_chat_read_at is null
            or my_chat_rounds.recipient_chat_read_at < my_chat_rounds.created_at
          )
        )
      )::integer as chat_unread_count,
      max(my_chat_rounds.updated_at) as chat_last_active_at
    from my_chat_rounds
    cross join auth_context as cu
    group by my_chat_rounds.friend_id
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
    coalesce(reward_thread_counts.current_round_count, 0) as current_round_count,
    coalesce(chat_thread_counts.chat_unread_count, 0) as chat_unread_count,
    chat_thread_counts.chat_last_active_at,
    case
      when reward_thread_counts.last_active_at is null then chat_thread_counts.chat_last_active_at
      when chat_thread_counts.chat_last_active_at is null then reward_thread_counts.last_active_at
      else greatest(reward_thread_counts.last_active_at, chat_thread_counts.chat_last_active_at)
    end as last_active_at
  from friend_ids
  left join reward_thread_counts
    on reward_thread_counts.friend_id = friend_ids.friend_id
  left join chat_thread_counts
    on chat_thread_counts.friend_id = friend_ids.friend_id
  left join latest_rounds
    on latest_rounds.friend_id = friend_ids.friend_id
  left join active_rounds
    on active_rounds.friend_id = friend_ids.friend_id
  left join review_rounds
    on review_rounds.friend_id = friend_ids.friend_id
  order by last_active_at desc nulls last, friend_ids.friend_id asc;
$$;

create or replace function public.mark_chat_thread_read(chat_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be logged in to mark chat messages as read.';
  end if;

  if chat_friend_id is null then
    return;
  end if;

  update public.rounds as r
  set
    sender_chat_read_at = case
      when current_user_id = r.sender_id then timezone('utc'::text, now())
      else r.sender_chat_read_at
    end,
    recipient_chat_read_at = case
      when current_user_id = r.recipient_id then timezone('utc'::text, now())
      else r.recipient_chat_read_at
    end,
    sender_viewed_results_at = case
      when r.status = 'complete' and current_user_id = r.sender_id then coalesce(r.sender_viewed_results_at, timezone('utc'::text, now()))
      else r.sender_viewed_results_at
    end,
    recipient_viewed_results_at = case
      when r.status = 'complete' and current_user_id = r.recipient_id then coalesce(r.recipient_viewed_results_at, timezone('utc'::text, now()))
      else r.recipient_viewed_results_at
    end
  where r.round_mode = 'chat'
    and (
      (r.sender_id = current_user_id and r.recipient_id = chat_friend_id)
      or (r.sender_id = chat_friend_id and r.recipient_id = current_user_id)
    );

  update public.rounds as r
  set chat_collapsed_at = timezone('utc'::text, now())
  where r.round_mode = 'chat'
    and r.status = 'complete'
    and r.chat_collapsed_at is null
    and r.sender_viewed_results_at is not null
    and r.recipient_viewed_results_at is not null
    and (
      (r.sender_id = current_user_id and r.recipient_id = chat_friend_id)
      or (r.sender_id = chat_friend_id and r.recipient_id = current_user_id)
    );
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

  if not normalized_gave_up and normalized_guess <> round_row.correct_phrase then
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
    score = null,
    recipient_viewed_results_at = coalesce(r.recipient_viewed_results_at, timezone('utc'::text, now())),
    status = 'complete'
  where r.id = round_row.id
  returning r.* into round_row;

  return round_row;
end;
$$;

grant execute on function public.list_home_threads() to authenticated;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;
grant execute on function public.complete_chat_round(uuid, text, jsonb, integer, boolean) to authenticated;
