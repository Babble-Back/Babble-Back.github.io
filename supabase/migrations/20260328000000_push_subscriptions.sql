create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  check (jsonb_typeof(subscription) = 'object')
);

create index if not exists push_subscriptions_user_id_idx
on public.push_subscriptions (user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
create policy "Users can read their own push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can create their own push subscriptions" on public.push_subscriptions;
create policy "Users can create their own push subscriptions"
on public.push_subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their own push subscriptions" on public.push_subscriptions;
create policy "Users can update their own push subscriptions"
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;
create policy "Users can delete their own push subscriptions"
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid());
