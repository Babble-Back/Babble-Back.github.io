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

  select r.*
  into archived_round
  from public.rounds as r
  where r.id = round_id
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
    from public.round_rewards as rr
    where rr.round_id = archived_round.id
      and rr.claimed = false
  ) then
    raise exception 'Both players must open the results screen before the thread can continue.';
  end if;

  select f.*
  into friendship_row
  from public.friendships as f
  where
    (f.user_one_id = archived_round.sender_id and f.user_two_id = archived_round.recipient_id)
    or (f.user_one_id = archived_round.recipient_id and f.user_two_id = archived_round.sender_id)
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
  where public.friendships.id = friendship_row.id
  returning * into friendship_row;

  delete from public.rounds as r
  where r.id = archived_round.id;

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

grant execute on function public.archive_completed_round(uuid) to authenticated;
