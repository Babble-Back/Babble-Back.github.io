create or replace function public.get_public_campaign_demo_state()
returns table (
  campaign jsonb,
  challenges jsonb,
  assets jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  with active_campaign as (
    select
      c.id,
      c.name,
      c.theme,
      c.start_date,
      c.end_date,
      c.is_active,
      c.reward_pack_id,
      c.config
    from public.campaigns as c
    where c.is_active
      and (c.start_date is null or c.start_date <= timezone('utc'::text, now()))
      and (c.end_date is null or c.end_date >= timezone('utc'::text, now()))
    order by c.start_date desc nulls last, c.id desc
    limit 1
  )
  select
    to_jsonb(active_campaign) as campaign,
    coalesce(
      (
        select jsonb_agg(to_jsonb(challenge_row) order by challenge_row.challenge_index asc)
        from (
          select
            cc.id,
            cc.campaign_id,
            cc.challenge_index,
            cc.phrase,
            cc.difficulty,
            cc.mode,
            cc.created_at,
            cc.lm_token_count,
            cc.lm_ready
          from public.campaign_challenges as cc
          where cc.campaign_id = active_campaign.id
          order by cc.challenge_index asc
          limit 5
        ) as challenge_row
      ),
      '[]'::jsonb
    ) as challenges,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('key', asset_row.key, 'value', asset_row.value)
          order by asset_row.key asc
        )
        from (
          select ca.key, ca.value
          from public.campaign_assets as ca
          where ca.campaign_id = active_campaign.id
            and ca.key in ('banner_image', 'challenge_icon', 'subtitle', 'title')
          order by ca.key asc
        ) as asset_row
      ),
      '[]'::jsonb
    ) as assets
  from active_campaign;
$$;

grant execute on function public.get_public_campaign_demo_state() to anon;
grant execute on function public.get_public_campaign_demo_state() to authenticated;
grant execute on function public.get_public_campaign_demo_state() to service_role;

grant execute on function public.get_campaign_challenge_lm_prior(uuid) to anon;
