drop function if exists public.get_active_campaign_home();

create function public.get_active_campaign_home()
returns table (
  campaign_id uuid,
  banner_image text,
  challenge_icon text,
  subtitle text,
  title text
)
language sql
security definer
stable
set search_path = public
as $$
  with active_campaign as (
    select c.id
    from public.campaigns as c
    where c.is_active
      and (c.start_date is null or c.start_date <= timezone('utc'::text, now()))
      and (c.end_date is null or c.end_date >= timezone('utc'::text, now()))
    order by c.start_date desc nulls last, c.id desc
    limit 1
  )
  select
    active_campaign.id as campaign_id,
    max(ca.value) filter (where ca.key = 'banner_image') as banner_image,
    max(ca.value) filter (where ca.key = 'challenge_icon') as challenge_icon,
    max(ca.value) filter (where ca.key = 'subtitle') as subtitle,
    max(ca.value) filter (where ca.key = 'title') as title
  from active_campaign
  left join public.campaign_assets as ca
    on ca.campaign_id = active_campaign.id
  group by active_campaign.id;
$$;

grant execute on function public.get_active_campaign_home() to anon;
grant execute on function public.get_active_campaign_home() to authenticated;
grant execute on function public.get_active_campaign_home() to service_role;
