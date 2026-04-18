drop function if exists public.archive_completed_round(uuid);

create function public.archive_completed_round(archive_round_id uuid)
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
  pair_coin_total_value integer := 0;
  archived_campaign_id uuid := null;
  archived_campaign_resource_type text := null;
  pair_campaign_reward_total_value integer := 0;
  completed_at_value timestamptz := null;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to archive a round.';
  end if;

  select r.*
  into archived_round
  from public.rounds as r
  where r.id = archive_round_id
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

  if archived_round.sender_viewed_results_at is null then
    raise exception 'Open the results screen once on the sender account before continuing the thread.';
  end if;

  if archived_round.recipient_viewed_results_at is null then
    raise exception 'The recipient must open the results screen before the thread can continue.';
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

  select
    coalesce(sum(rr.reward_amount), 0)::integer,
    min(rr.campaign_id::text)::uuid,
    max(rr.campaign_resource_type),
    coalesce(sum(rr.campaign_reward_amount), 0)::integer,
    coalesce(min(rr.created_at), archived_round.updated_at, archived_round.created_at)
  into
    pair_coin_total_value,
    archived_campaign_id,
    archived_campaign_resource_type,
    pair_campaign_reward_total_value,
    completed_at_value
  from public.round_rewards as rr
  where rr.round_id = archived_round.id;

  insert into public.archived_round_history (
    round_id,
    friendship_id,
    speaker_id,
    babbler_id,
    stars,
    pair_coin_total,
    campaign_id,
    campaign_resource_type,
    pair_campaign_reward_total,
    completed_at,
    archived_at
  )
  values (
    archived_round.id,
    friendship_row.id,
    archived_round.sender_id,
    archived_round.recipient_id,
    public.score_to_stars(archived_round.score),
    pair_coin_total_value,
    archived_campaign_id,
    archived_campaign_resource_type,
    pair_campaign_reward_total_value,
    completed_at_value,
    timezone('utc'::text, now())
  )
  on conflict on constraint archived_round_history_pkey do update
  set
    friendship_id = excluded.friendship_id,
    speaker_id = excluded.speaker_id,
    babbler_id = excluded.babbler_id,
    stars = excluded.stars,
    pair_coin_total = excluded.pair_coin_total,
    campaign_id = excluded.campaign_id,
    campaign_resource_type = excluded.campaign_resource_type,
    pair_campaign_reward_total = excluded.pair_campaign_reward_total,
    completed_at = excluded.completed_at,
    archived_at = excluded.archived_at;

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
