alter table public.rounds
add column if not exists sender_reaction_message text;

alter table public.rounds
add column if not exists sender_reaction_updated_at timestamptz;

alter table public.rounds
add column if not exists recipient_reaction_message text;

alter table public.rounds
add column if not exists recipient_reaction_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rounds_sender_reaction_message_length'
      and conrelid = 'public.rounds'::regclass
  ) then
    alter table public.rounds
    add constraint rounds_sender_reaction_message_length
    check (sender_reaction_message is null or char_length(sender_reaction_message) <= 500);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'rounds_recipient_reaction_message_length'
      and conrelid = 'public.rounds'::regclass
  ) then
    alter table public.rounds
    add constraint rounds_recipient_reaction_message_length
    check (recipient_reaction_message is null or char_length(recipient_reaction_message) <= 500);
  end if;
end;
$$;

create or replace function public.touch_round_reaction_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.sender_reaction_message is not null and new.sender_reaction_updated_at is null then
      new.sender_reaction_updated_at = timezone('utc'::text, now());
    end if;

    if new.recipient_reaction_message is not null and new.recipient_reaction_updated_at is null then
      new.recipient_reaction_updated_at = timezone('utc'::text, now());
    end if;

    return new;
  end if;

  if new.sender_reaction_message is distinct from old.sender_reaction_message then
    new.sender_reaction_updated_at = case
      when new.sender_reaction_message is null then null
      else timezone('utc'::text, now())
    end;
  end if;

  if new.recipient_reaction_message is distinct from old.recipient_reaction_message then
    new.recipient_reaction_updated_at = case
      when new.recipient_reaction_message is null then null
      else timezone('utc'::text, now())
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists touch_round_reaction_timestamps on public.rounds;
create trigger touch_round_reaction_timestamps
before insert or update on public.rounds
for each row
execute function public.touch_round_reaction_timestamps();

create or replace function public.set_round_reaction(
  reaction_round_id uuid,
  reaction_message_input text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  normalized_message text := nullif(btrim(coalesce(reaction_message_input, '')), '');
begin
  if current_user_id is null then
    raise exception 'You must be logged in to react to a round.';
  end if;

  if reaction_round_id is null then
    raise exception 'A round id is required.';
  end if;

  if normalized_message is not null and char_length(normalized_message) > 500 then
    raise exception 'Reactions must be 500 characters or fewer.';
  end if;

  select r.*
  into round_row
  from public.rounds as r
  where r.id = reaction_round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if round_row.sender_id = current_user_id then
    update public.rounds as r
    set sender_reaction_message = normalized_message
    where r.id = round_row.id
    returning r.* into round_row;

    return round_row;
  end if;

  if round_row.recipient_id = current_user_id then
    if round_row.status <> 'complete' then
      raise exception 'You can react after the reward is revealed.';
    end if;

    update public.rounds as r
    set recipient_reaction_message = normalized_message
    where r.id = round_row.id
    returning r.* into round_row;

    return round_row;
  end if;

  raise exception 'Only round participants can react to this round.';
end;
$$;

grant execute on function public.set_round_reaction(uuid, text) to authenticated;
