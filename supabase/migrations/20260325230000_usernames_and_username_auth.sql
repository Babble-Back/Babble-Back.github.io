create or replace function public.normalize_username(username_input text)
returns text
language sql
immutable
as $$
  select trim(both '_' from regexp_replace(lower(btrim(coalesce(username_input, ''))), '[^a-z0-9_]+', '_', 'g'));
$$;

create or replace function public.generate_unique_username(
  desired_username text,
  fallback_email text,
  current_profile_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text := public.normalize_username(desired_username);
  candidate text;
  suffix integer := 0;
  suffix_text text;
  max_base_length integer;
begin
  if base_username = '' then
    base_username := public.normalize_username(split_part(coalesce(fallback_email, ''), '@', 1));
  end if;

  if base_username = '' then
    base_username := 'player';
  end if;

  if char_length(base_username) < 3 then
    base_username := substr(base_username || 'player', 1, 24);
  end if;

  if char_length(base_username) < 3 then
    base_username := 'player';
  end if;

  candidate := substr(base_username, 1, 24);

  while exists (
    select 1
    from public.profiles as p
    where p.username = candidate
      and (current_profile_id is null or p.id <> current_profile_id)
  ) loop
    suffix := suffix + 1;
    suffix_text := '_' || suffix::text;
    max_base_length := greatest(24 - char_length(suffix_text), 1);
    candidate := substr(base_username, 1, max_base_length) || suffix_text;
  end loop;

  return candidate;
end;
$$;

alter table public.profiles
  add column if not exists username text;

update public.profiles
set username = public.generate_unique_username(username, email, id)
where
  username is null
  or btrim(username) = ''
  or username <> public.normalize_username(username);

alter table public.profiles
  alter column username set not null;

drop index if exists public.profiles_username_idx;
create unique index if not exists profiles_username_idx
on public.profiles (username);

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (
    char_length(username) between 3 and 24
    and username = public.normalize_username(username)
    and username ~ '^[a-z0-9_]+$'
  );

alter table public.friend_requests
  add column if not exists requester_username text,
  add column if not exists recipient_username text;

update public.friend_requests as fr
set requester_username = p.username
from public.profiles as p
where p.id = fr.requester_id
  and (fr.requester_username is null or btrim(fr.requester_username) = '');

update public.friend_requests as fr
set recipient_username = p.username
from public.profiles as p
where p.id = fr.recipient_id
  and (fr.recipient_username is null or btrim(fr.recipient_username) = '');

alter table public.friend_requests
  alter column requester_username set not null,
  alter column recipient_username set not null;

alter table public.friendships
  add column if not exists user_one_username text,
  add column if not exists user_two_username text;

update public.friendships as f
set user_one_username = p.username
from public.profiles as p
where p.id = f.user_one_id
  and (f.user_one_username is null or btrim(f.user_one_username) = '');

update public.friendships as f
set user_two_username = p.username
from public.profiles as p
where p.id = f.user_two_id
  and (f.user_two_username is null or btrim(f.user_two_username) = '');

alter table public.friendships
  alter column user_one_username set not null,
  alter column user_two_username set not null;

alter table public.rounds
  add column if not exists sender_username text,
  add column if not exists recipient_username text;

update public.rounds as r
set sender_username = p.username
from public.profiles as p
where p.id = r.sender_id
  and (r.sender_username is null or btrim(r.sender_username) = '');

update public.rounds as r
set recipient_username = p.username
from public.profiles as p
where p.id = r.recipient_id
  and (r.recipient_username is null or btrim(r.recipient_username) = '');

alter table public.rounds
  alter column sender_username set not null,
  alter column recipient_username set not null;

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_username text := public.generate_unique_username(
    new.raw_user_meta_data ->> 'username',
    new.email,
    new.id
  );
begin
  if new.email is null or char_length(btrim(new.email)) = 0 then
    raise exception 'Auth user email is required.';
  end if;

  insert into public.profiles (id, email, username, created_at, updated_at)
  values (
    new.id,
    lower(btrim(new.email)),
    next_username,
    coalesce(new.created_at, timezone('utc'::text, now())),
    timezone('utc'::text, now())
  )
  on conflict (id) do update
  set
    email = excluded.email,
    username = coalesce(public.profiles.username, excluded.username),
    updated_at = timezone('utc'::text, now());

  return new;
end;
$$;

create or replace function public.hydrate_round_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_id is null then
    new.sender_id = auth.uid();
  end if;

  select email, username
  into new.sender_email, new.sender_username
  from public.profiles
  where id = new.sender_id;

  select email, username
  into new.recipient_email, new.recipient_username
  from public.profiles
  where id = new.recipient_id;

  if new.sender_email is null or new.sender_username is null then
    raise exception 'Sender profile not found.';
  end if;

  if new.recipient_email is null or new.recipient_username is null then
    raise exception 'Recipient profile not found.';
  end if;

  return new;
end;
$$;

drop function if exists public.request_friendship(text);

create or replace function public.request_friendship(recipient_identifier_input text)
returns public.friend_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text;
  current_user_username text;
  normalized_identifier text := lower(btrim(recipient_identifier_input));
  recipient_profile public.profiles%rowtype;
  new_request public.friend_requests;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to send a friend request.';
  end if;

  if normalized_identifier is null or normalized_identifier = '' then
    raise exception 'Recipient username is required.';
  end if;

  select email, username
  into current_user_email, current_user_username
  from public.profiles
  where id = current_user_id;

  if current_user_email is null or current_user_username is null then
    raise exception 'No profile was found for the current user.';
  end if;

  select *
  into recipient_profile
  from public.profiles
  where
    username = public.normalize_username(normalized_identifier)
    or email = normalized_identifier;

  if recipient_profile.id is null then
    raise exception 'No account exists for that username yet.';
  end if;

  if recipient_profile.id = current_user_id then
    raise exception 'You cannot add yourself as a friend.';
  end if;

  if public.are_friends(current_user_id, recipient_profile.id) then
    raise exception 'You are already friends with that user.';
  end if;

  if exists (
    select 1
    from public.friend_requests
    where status = 'pending'
      and (
        (requester_id = current_user_id and recipient_id = recipient_profile.id)
        or (requester_id = recipient_profile.id and recipient_id = current_user_id)
      )
  ) then
    raise exception 'A pending friend request already exists for that user.';
  end if;

  insert into public.friend_requests (
    requester_id,
    requester_email,
    requester_username,
    recipient_id,
    recipient_email,
    recipient_username
  )
  values (
    current_user_id,
    current_user_email,
    current_user_username,
    recipient_profile.id,
    recipient_profile.email,
    recipient_profile.username
  )
  returning * into new_request;

  return new_request;
end;
$$;

grant execute on function public.request_friendship(text) to authenticated;

create or replace function public.respond_to_friend_request(
  friend_request_id uuid,
  accept_request boolean
)
returns public.friend_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_request public.friend_requests;
  updated_request public.friend_requests;
  first_user_id uuid;
  first_user_email text;
  first_user_username text;
  second_user_id uuid;
  second_user_email text;
  second_user_username text;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to respond to a friend request.';
  end if;

  select *
  into existing_request
  from public.friend_requests
  where id = friend_request_id
  for update;

  if existing_request.id is null then
    raise exception 'Friend request not found.';
  end if;

  if existing_request.recipient_id <> current_user_id then
    raise exception 'Only the recipient can respond to this friend request.';
  end if;

  if existing_request.status <> 'pending' then
    raise exception 'This friend request has already been resolved.';
  end if;

  update public.friend_requests
  set
    status = case when accept_request then 'accepted' else 'rejected' end,
    responded_at = timezone('utc'::text, now())
  where id = existing_request.id
  returning * into updated_request;

  if accept_request and not public.are_friends(existing_request.requester_id, existing_request.recipient_id) then
    if existing_request.requester_id::text < existing_request.recipient_id::text then
      first_user_id = existing_request.requester_id;
      first_user_email = existing_request.requester_email;
      first_user_username = existing_request.requester_username;
      second_user_id = existing_request.recipient_id;
      second_user_email = existing_request.recipient_email;
      second_user_username = existing_request.recipient_username;
    else
      first_user_id = existing_request.recipient_id;
      first_user_email = existing_request.recipient_email;
      first_user_username = existing_request.recipient_username;
      second_user_id = existing_request.requester_id;
      second_user_email = existing_request.requester_email;
      second_user_username = existing_request.requester_username;
    end if;

    insert into public.friendships (
      user_one_id,
      user_one_email,
      user_one_username,
      user_two_id,
      user_two_email,
      user_two_username
    )
    values (
      first_user_id,
      first_user_email,
      first_user_username,
      second_user_id,
      second_user_email,
      second_user_username
    )
    on conflict (user_one_id, user_two_id) do nothing;
  end if;

  return updated_request;
end;
$$;

create or replace function public.resolve_login_email(login_input text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_input text := lower(btrim(login_input));
  resolved_email text;
begin
  if normalized_input is null or normalized_input = '' then
    return null;
  end if;

  select p.email
  into resolved_email
  from public.profiles as p
  where p.email = normalized_input
     or p.username = public.normalize_username(normalized_input)
  order by case when p.email = normalized_input then 0 else 1 end
  limit 1;

  return resolved_email;
end;
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated;
