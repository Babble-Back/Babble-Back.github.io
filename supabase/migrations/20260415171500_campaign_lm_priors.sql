alter table public.campaign_challenges
  add column if not exists lm_model_name text,
  add column if not exists lm_token_ids jsonb,
  add column if not exists lm_token_texts jsonb,
  add column if not exists lm_token_probs jsonb,
  add column if not exists lm_token_log_probs jsonb,
  add column if not exists lm_token_count integer not null default 0 check (lm_token_count >= 0),
  add column if not exists lm_ready boolean not null default false;

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
    select
      id,
      campaign_id,
      challenge_index,
      phrase,
      difficulty,
      mode,
      created_at,
      lm_model_name,
      lm_token_ids,
      lm_token_texts,
      lm_token_probs,
      lm_token_log_probs,
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

  return query select campaign_json, challenges_json, assets_json, progress_json, attempts_json, unlocked_pack_ids_value;
end;
$$;

grant execute on function public.get_active_campaign_state(uuid) to authenticated;
