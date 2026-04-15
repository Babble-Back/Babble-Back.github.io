create extension if not exists pgcrypto;

create table if not exists public.word_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  description text,
  is_free boolean not null default true,
  created_at timestamp not null default now()
);

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.word_packs (id) on delete cascade,
  text text not null,
  syllables int not null,
  char_length int not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  created_at timestamp not null default now(),
  check (char_length(btrim(text)) > 0)
);

create index if not exists idx_words_pack_id on public.words (pack_id);

create or replace function public.normalize_word_text()
returns trigger
language plpgsql
as $$
begin
  new.text = lower(btrim(new.text));
  return new;
end;
$$;

drop trigger if exists normalize_word_text on public.words;
create trigger normalize_word_text
before insert or update of text on public.words
for each row
execute function public.normalize_word_text();

grant usage on schema public to authenticated, service_role;
grant select on public.word_packs to authenticated;
grant select on public.words to authenticated;
grant all on public.word_packs to service_role;
grant all on public.words to service_role;

alter table public.word_packs enable row level security;
alter table public.words enable row level security;

drop policy if exists "Authenticated users can read word packs" on public.word_packs;
create policy "Authenticated users can read word packs"
on public.word_packs
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read words" on public.words;
create policy "Authenticated users can read words"
on public.words
for select
to authenticated
using (true);

drop policy if exists "Service role can manage word packs" on public.word_packs;
create policy "Service role can manage word packs"
on public.word_packs
for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role can manage words" on public.words;
create policy "Service role can manage words"
on public.words
for all
to service_role
using (true)
with check (true);
