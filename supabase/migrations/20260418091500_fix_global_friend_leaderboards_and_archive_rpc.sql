create table if not exists public.archived_round_history (
  round_id uuid primary key,
  friendship_id uuid not null references public.friendships (id) on delete cascade,
  speaker_id uuid not null references public.profiles (id) on delete cascade,
  babbler_id uuid not null references public.profiles (id) on delete cascade,
  stars integer not null check (stars between 0 and 3),
  pair_coin_total integer not null default 0 check (pair_coin_total >= 0),
  campaign_id uuid references public.campaigns (id) on delete set null,
  campaign_resource_type text,
  pair_campaign_reward_total integer not null default 0 check (pair_campaign_reward_total >= 0),
  completed_at timestamptz not null,
  archived_at timestamptz not null default timezone('utc'::text, now()),
  check (speaker_id <> babbler_id)
);

create index if not exists archived_round_history_friendship_idx
on public.archived_round_history (friendship_id, completed_at desc);

create index if not exists archived_round_history_speaker_idx
on public.archived_round_history (speaker_id, completed_at desc);

create index if not exists archived_round_history_babbler_idx
on public.archived_round_history (babbler_id, completed_at desc);

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
  where r.id = archive_completed_round.round_id
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
  on conflict (round_id) do update
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

create or replace function public.list_monthly_friend_match_leaderboards(
  period_start_input timestamptz,
  period_end_input timestamptz,
  leaderboard_limit integer default 5
)
returns table (
  leaderboard_key text,
  rank integer,
  primary_user_id uuid,
  primary_username text,
  secondary_user_id uuid,
  secondary_username text,
  metric_value double precision,
  sample_size integer
)
language sql
security definer
stable
set search_path = public
as $$
  with friendships_with_profiles as (
    select
      f.id as friendship_id,
      f.user_one_id,
      f.user_two_id,
      coalesce(p1.username, f.user_one_username, f.user_one_email) as user_one_username,
      coalesce(p2.username, f.user_two_username, f.user_two_email) as user_two_username
    from public.friendships as f
    left join public.profiles as p1
      on p1.id = f.user_one_id
    left join public.profiles as p2
      on p2.id = f.user_two_id
  ),
  live_round_totals as (
    select
      r.id as round_id,
      f.id as friendship_id,
      r.sender_id as speaker_id,
      r.recipient_id as babbler_id,
      public.score_to_stars(r.score) as stars,
      coalesce(sum(rr.reward_amount), 0)::integer as pair_coin_total,
      min(rr.campaign_id::text)::uuid as campaign_id,
      max(rr.campaign_resource_type) as campaign_resource_type,
      coalesce(sum(rr.campaign_reward_amount), 0)::integer as pair_campaign_reward_total,
      coalesce(min(rr.created_at), r.updated_at, r.created_at) as completed_at
    from public.rounds as r
    join public.friendships as f
      on (
        (f.user_one_id = r.sender_id and f.user_two_id = r.recipient_id)
        or (f.user_one_id = r.recipient_id and f.user_two_id = r.sender_id)
      )
    left join public.round_rewards as rr
      on rr.round_id = r.id
    where r.status = 'complete'
    group by
      r.id,
      f.id,
      r.sender_id,
      r.recipient_id,
      r.score,
      r.updated_at,
      r.created_at
  ),
  live_rounds as (
    select *
    from live_round_totals
    where completed_at >= period_start_input
      and completed_at < period_end_input
  ),
  archived_rounds as (
    select
      arh.round_id,
      arh.friendship_id,
      arh.speaker_id,
      arh.babbler_id,
      arh.stars,
      arh.pair_coin_total,
      arh.campaign_id,
      arh.campaign_resource_type,
      arh.pair_campaign_reward_total,
      arh.completed_at
    from public.archived_round_history as arh
    where arh.completed_at >= period_start_input
      and arh.completed_at < period_end_input
  ),
  all_rounds as (
    select * from live_rounds
    union all
    select * from archived_rounds
  ),
  active_campaign as (
    select
      c.id,
      public.get_campaign_currency_resource_type(c.config) as campaign_resource_type
    from public.campaigns as c
    where c.is_active
      and (c.start_date is null or c.start_date <= timezone('utc'::text, now()))
      and (c.end_date is null or c.end_date >= timezone('utc'::text, now()))
    order by c.start_date desc nulls last, c.id desc
    limit 1
  ),
  pair_round_counts as (
    select
      ar.friendship_id,
      count(*)::integer as total_rounds
    from all_rounds as ar
    group by ar.friendship_id
  ),
  pair_coin_board as (
    select
      1 as board_order,
      'best_team_coins'::text as leaderboard_key,
      fp.user_one_id as primary_user_id,
      fp.user_one_username as primary_username,
      fp.user_two_id as secondary_user_id,
      fp.user_two_username as secondary_username,
      sum(ar.pair_coin_total)::double precision as metric_value,
      count(*)::integer as sample_size
    from all_rounds as ar
    join friendships_with_profiles as fp
      on fp.friendship_id = ar.friendship_id
    group by
      fp.user_one_id,
      fp.user_one_username,
      fp.user_two_id,
      fp.user_two_username
  ),
  pair_event_board as (
    select
      2 as board_order,
      'best_event_team'::text as leaderboard_key,
      fp.user_one_id as primary_user_id,
      fp.user_one_username as primary_username,
      fp.user_two_id as secondary_user_id,
      fp.user_two_username as secondary_username,
      sum(ar.pair_campaign_reward_total)::double precision as metric_value,
      count(*)::integer as sample_size
    from all_rounds as ar
    join active_campaign as ac
      on ac.id = ar.campaign_id
    join friendships_with_profiles as fp
      on fp.friendship_id = ar.friendship_id
    where ac.campaign_resource_type is not null
      and ar.campaign_resource_type = ac.campaign_resource_type
      and ar.pair_campaign_reward_total > 0
    group by
      fp.user_one_id,
      fp.user_one_username,
      fp.user_two_id,
      fp.user_two_username
  ),
  speaker_board as (
    select
      3 as board_order,
      'best_speaker'::text as leaderboard_key,
      p.id as primary_user_id,
      coalesce(p.username, p.email) as primary_username,
      null::uuid as secondary_user_id,
      null::text as secondary_username,
      avg(ar.stars)::double precision as metric_value,
      count(*)::integer as sample_size
    from all_rounds as ar
    join public.profiles as p
      on p.id = ar.speaker_id
    group by p.id, coalesce(p.username, p.email)
  ),
  babbler_board as (
    select
      4 as board_order,
      'best_babbler'::text as leaderboard_key,
      p.id as primary_user_id,
      coalesce(p.username, p.email) as primary_username,
      null::uuid as secondary_user_id,
      null::text as secondary_username,
      avg(ar.stars)::double precision as metric_value,
      count(*)::integer as sample_size
    from all_rounds as ar
    join public.profiles as p
      on p.id = ar.babbler_id
    group by p.id, coalesce(p.username, p.email)
  ),
  pair_streak_source as (
    select
      ar.friendship_id,
      ar.round_id,
      ar.stars,
      ar.completed_at,
      sum(case when ar.stars = 3 then 0 else 1 end)
        over (
          partition by ar.friendship_id
          order by ar.completed_at asc, ar.round_id asc
        ) as streak_group
    from all_rounds as ar
  ),
  pair_three_star_streaks as (
    select
      pss.friendship_id,
      count(*)::integer as streak_length
    from pair_streak_source as pss
    where pss.stars = 3
    group by pss.friendship_id, pss.streak_group
  ),
  pair_streak_board as (
    select
      5 as board_order,
      'best_three_star_streak'::text as leaderboard_key,
      fp.user_one_id as primary_user_id,
      fp.user_one_username as primary_username,
      fp.user_two_id as secondary_user_id,
      fp.user_two_username as secondary_username,
      max(pts.streak_length)::double precision as metric_value,
      prc.total_rounds as sample_size
    from pair_three_star_streaks as pts
    join pair_round_counts as prc
      on prc.friendship_id = pts.friendship_id
    join friendships_with_profiles as fp
      on fp.friendship_id = pts.friendship_id
    group by
      fp.user_one_id,
      fp.user_one_username,
      fp.user_two_id,
      fp.user_two_username,
      prc.total_rounds
  ),
  combined as (
    select * from pair_coin_board
    union all
    select * from pair_event_board
    union all
    select * from speaker_board
    union all
    select * from babbler_board
    union all
    select * from pair_streak_board
  ),
  ranked as (
    select
      combined.board_order,
      combined.leaderboard_key,
      row_number() over (
        partition by combined.leaderboard_key
        order by
          combined.metric_value desc,
          combined.sample_size desc,
          combined.primary_username asc,
          coalesce(combined.secondary_username, '') asc
      )::integer as rank,
      combined.primary_user_id,
      combined.primary_username,
      combined.secondary_user_id,
      combined.secondary_username,
      combined.metric_value,
      combined.sample_size
    from combined
  )
  select
    ranked.leaderboard_key,
    ranked.rank,
    ranked.primary_user_id,
    ranked.primary_username,
    ranked.secondary_user_id,
    ranked.secondary_username,
    ranked.metric_value,
    ranked.sample_size
  from ranked
  where ranked.rank <= greatest(coalesce(leaderboard_limit, 5), 1)
  order by ranked.board_order, ranked.rank;
$$;

grant execute on function public.archive_completed_round(uuid) to authenticated;
grant execute on function public.list_monthly_friend_match_leaderboards(timestamptz, timestamptz, integer) to authenticated;
