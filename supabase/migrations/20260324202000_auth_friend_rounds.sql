create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio',
  'audio',
  false,
  52428800,
  array['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can read audio objects" on storage.objects;
drop policy if exists "Anyone can insert audio objects" on storage.objects;
drop policy if exists "Anyone can update audio objects" on storage.objects;

drop trigger if exists set_rounds_updated_at on public.rounds;
drop function if exists public.set_rounds_updated_at();
drop table if exists public.rounds cascade;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  check (char_length(btrim(email)) > 3),
  check (email = lower(btrim(email)))
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  requester_email text not null,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  responded_at timestamptz,
  check (requester_id <> recipient_id)
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references public.profiles (id) on delete cascade,
  user_one_email text not null,
  user_two_id uuid not null references public.profiles (id) on delete cascade,
  user_two_email text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  check (user_one_id <> user_two_id),
  check (user_one_id::text < user_two_id::text),
  unique (user_one_id, user_two_id)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  sender_email text not null,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  recipient_email text not null,
  correct_phrase text not null check (char_length(btrim(correct_phrase)) > 0),
  original_audio_path text not null,
  reversed_audio_path text not null,
  guess text,
  attempt_audio_path text,
  attempt_reversed_path text,
  score integer check (score is null or score between 0 and 10),
  status text not null default 'waiting_for_attempt' check (
    status in ('waiting_for_attempt', 'attempted', 'complete')
  ),
  check (sender_id <> recipient_id)
);

create index if not exists friend_requests_requester_idx
on public.friend_requests (requester_id, created_at desc);

create index if not exists friend_requests_recipient_idx
on public.friend_requests (recipient_id, created_at desc);

create unique index if not exists friend_requests_pending_pair_idx
on public.friend_requests (
  least(requester_id::text, recipient_id::text),
  greatest(requester_id::text, recipient_id::text)
)
where status = 'pending';

create index if not exists friendships_user_one_idx
on public.friendships (user_one_id, created_at desc);

create index if not exists friendships_user_two_idx
on public.friendships (user_two_id, created_at desc);

create index if not exists rounds_sender_idx
on public.rounds (sender_id, created_at desc);

create index if not exists rounds_recipient_idx
on public.rounds (recipient_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or char_length(btrim(new.email)) = 0 then
    raise exception 'Auth user email is required.';
  end if;

  insert into public.profiles (id, email, created_at, updated_at)
  values (
    new.id,
    lower(btrim(new.email)),
    coalesce(new.created_at, timezone('utc'::text, now())),
    timezone('utc'::text, now())
  )
  on conflict (id) do update
  set
    email = excluded.email,
    updated_at = timezone('utc'::text, now());

  return new;
end;
$$;

create or replace function public.are_friends(user_a uuid, user_b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.friendships
    where
      (user_one_id = user_a and user_two_id = user_b)
      or (user_one_id = user_b and user_two_id = user_a)
  );
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

  select email into new.sender_email
  from public.profiles
  where id = new.sender_id;

  select email into new.recipient_email
  from public.profiles
  where id = new.recipient_id;

  if new.sender_email is null then
    raise exception 'Sender profile not found.';
  end if;

  if new.recipient_email is null then
    raise exception 'Recipient profile not found.';
  end if;

  return new;
end;
$$;

create or replace function public.extract_round_id_from_storage_path(object_name text)
returns uuid
language plpgsql
stable
as $$
declare
  folders text[] := storage.foldername(object_name);
begin
  if coalesce(array_length(folders, 1), 0) < 3 or folders[1] <> 'rounds' then
    return null;
  end if;

  begin
    return folders[3]::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

create or replace function public.is_round_participant(round_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.rounds
    where id = round_id
      and (sender_id = auth.uid() or recipient_id = auth.uid())
  );
$$;

create or replace function public.can_upload_round_audio(object_name text)
returns boolean
language plpgsql
stable
as $$
declare
  folders text[] := storage.foldername(object_name);
begin
  if auth.uid() is null then
    return false;
  end if;

  if coalesce(array_length(folders, 1), 0) < 3 then
    return false;
  end if;

  if folders[1] <> 'rounds' or folders[2] <> auth.uid()::text then
    return false;
  end if;

  return public.extract_round_id_from_storage_path(object_name) is not null;
end;
$$;

create or replace function public.can_read_round_audio(object_name text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  round_id uuid := public.extract_round_id_from_storage_path(object_name);
begin
  if round_id is null then
    return false;
  end if;

  return public.is_round_participant(round_id);
end;
$$;

create or replace function public.request_friendship(recipient_email_input text)
returns public.friend_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text;
  normalized_email text := lower(btrim(recipient_email_input));
  recipient_profile public.profiles%rowtype;
  new_request public.friend_requests;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to send a friend request.';
  end if;

  if normalized_email is null or normalized_email = '' then
    raise exception 'Recipient email is required.';
  end if;

  select email into current_user_email
  from public.profiles
  where id = current_user_id;

  if current_user_email is null then
    raise exception 'No profile was found for the current user.';
  end if;

  select *
  into recipient_profile
  from public.profiles
  where email = normalized_email;

  if recipient_profile.id is null then
    raise exception 'No account exists for that email address yet.';
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
    recipient_id,
    recipient_email
  )
  values (
    current_user_id,
    current_user_email,
    recipient_profile.id,
    recipient_profile.email
  )
  returning * into new_request;

  return new_request;
end;
$$;

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
  second_user_id uuid;
  second_user_email text;
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
      second_user_id = existing_request.recipient_id;
      second_user_email = existing_request.recipient_email;
    else
      first_user_id = existing_request.recipient_id;
      first_user_email = existing_request.recipient_email;
      second_user_id = existing_request.requester_id;
      second_user_email = existing_request.requester_email;
    end if;

    insert into public.friendships (
      user_one_id,
      user_one_email,
      user_two_id,
      user_two_email
    )
    values (
      first_user_id,
      first_user_email,
      second_user_id,
      second_user_email
    )
    on conflict (user_one_id, user_two_id) do nothing;
  end if;

  return updated_request;
end;
$$;

insert into public.profiles (id, email, created_at, updated_at)
select
  id,
  lower(btrim(email)),
  coalesce(created_at, timezone('utc'::text, now())),
  timezone('utc'::text, now())
from auth.users
where email is not null
on conflict (id) do update
set
  email = excluded.email,
  updated_at = timezone('utc'::text, now());

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.sync_profile_from_auth_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_profile_from_auth_user();

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row
execute function public.touch_updated_at();

drop trigger if exists hydrate_round_participants on public.rounds;
create trigger hydrate_round_participants
before insert or update of sender_id, recipient_id on public.rounds
for each row
execute function public.hydrate_round_participants();

drop trigger if exists touch_rounds_updated_at on public.rounds;
create trigger touch_rounds_updated_at
before update on public.rounds
for each row
execute function public.touch_updated_at();

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select on public.friend_requests to authenticated;
grant select on public.friendships to authenticated;
grant select, insert, update on public.rounds to authenticated;

grant execute on function public.request_friendship(text) to authenticated;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.rounds enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "Users can read their related friend requests" on public.friend_requests;
create policy "Users can read their related friend requests"
on public.friend_requests
for select
to authenticated
using (requester_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "Users can read their friendships" on public.friendships;
create policy "Users can read their friendships"
on public.friendships
for select
to authenticated
using (user_one_id = auth.uid() or user_two_id = auth.uid());

drop policy if exists "Participants can read rounds" on public.rounds;
create policy "Participants can read rounds"
on public.rounds
for select
to authenticated
using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "Senders can create rounds for friends" on public.rounds;
create policy "Senders can create rounds for friends"
on public.rounds
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.are_friends(sender_id, recipient_id)
);

drop policy if exists "Recipients can update their rounds" on public.rounds;
create policy "Recipients can update their rounds"
on public.rounds
for update
to authenticated
using (recipient_id = auth.uid())
with check (
  recipient_id = auth.uid()
  and public.are_friends(sender_id, recipient_id)
);

create policy "Round participants can read audio objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'audio'
  and public.can_read_round_audio(name)
);

create policy "Authenticated users can upload round audio to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'audio'
  and public.can_upload_round_audio(name)
);
