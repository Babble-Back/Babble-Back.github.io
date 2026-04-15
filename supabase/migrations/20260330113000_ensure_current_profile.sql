create or replace function public.ensure_current_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  auth_user auth.users%rowtype;
  ensured_profile public.profiles%rowtype;
  next_username text;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to repair a profile.';
  end if;

  select *
  into auth_user
  from auth.users
  where id = current_user_id;

  if auth_user.id is null then
    raise exception 'Authenticated user not found.';
  end if;

  if auth_user.email is null or char_length(btrim(auth_user.email)) = 0 then
    raise exception 'Authenticated user email is required.';
  end if;

  next_username := public.generate_unique_username(
    auth_user.raw_user_meta_data ->> 'username',
    auth_user.email,
    auth_user.id
  );

  insert into public.profiles (id, email, username, created_at, updated_at)
  values (
    auth_user.id,
    lower(btrim(auth_user.email)),
    next_username,
    coalesce(auth_user.created_at, timezone('utc'::text, now())),
    timezone('utc'::text, now())
  )
  on conflict (id) do update
  set
    email = excluded.email,
    username = coalesce(public.profiles.username, excluded.username),
    updated_at = timezone('utc'::text, now())
  returning * into ensured_profile;

  return ensured_profile;
end;
$$;

grant execute on function public.ensure_current_profile() to authenticated;
