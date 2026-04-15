insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio',
  'audio',
  true,
  52428800,
  array['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.rounds (
  id text primary key,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  player1_name text not null check (char_length(btrim(player1_name)) > 0),
  player2_name text not null check (char_length(btrim(player2_name)) > 0),
  correct_phrase text not null check (char_length(btrim(correct_phrase)) > 0),
  original_audio_path text not null,
  reversed_audio_path text not null,
  guess text,
  attempt_audio_path text,
  attempt_reversed_path text,
  score integer check (score is null or score between 0 and 10),
  status text not null default 'waiting_for_attempt' check (
    status in ('created', 'waiting_for_attempt', 'attempted', 'complete')
  )
);

create index if not exists rounds_created_at_idx on public.rounds (created_at desc);

create or replace function public.set_rounds_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_rounds_updated_at on public.rounds;

create trigger set_rounds_updated_at
before update on public.rounds
for each row
execute function public.set_rounds_updated_at();

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.rounds to anon, authenticated;

alter table public.rounds enable row level security;

drop policy if exists "Anyone can read rounds" on public.rounds;
create policy "Anyone can read rounds"
on public.rounds
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can create rounds" on public.rounds;
create policy "Anyone can create rounds"
on public.rounds
for insert
to anon, authenticated
with check (true);

drop policy if exists "Anyone can update rounds" on public.rounds;
create policy "Anyone can update rounds"
on public.rounds
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Anyone can read audio objects" on storage.objects;
create policy "Anyone can read audio objects"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'audio');

drop policy if exists "Anyone can insert audio objects" on storage.objects;
create policy "Anyone can insert audio objects"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'audio');

drop policy if exists "Anyone can update audio objects" on storage.objects;
create policy "Anyone can update audio objects"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'audio')
with check (bucket_id = 'audio');
