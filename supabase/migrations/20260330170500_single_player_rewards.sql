create unique index if not exists transactions_single_player_reward_unique_idx
on public.transactions (
  user_id,
  resource_type,
  reason,
  (metadata->>'reward_key')
)
where reason = 'single_player_reward'
  and metadata ? 'reward_key';

create or replace function public.award_single_player_reward(
  reward_key uuid,
  stars_input integer,
  difficulty_input text,
  phrase_input text,
  transcript_input text,
  similarity_input numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_difficulty text := lower(btrim(coalesce(difficulty_input, '')));
  normalized_phrase text := lower(btrim(coalesce(phrase_input, '')));
  normalized_transcript text := lower(btrim(coalesce(transcript_input, '')));
  normalized_similarity numeric := greatest(0, least(coalesce(similarity_input, 0), 1));
  difficulty_multiplier integer;
  coins_awarded integer;
  inserted_transaction_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to award a single-player reward.';
  end if;

  if reward_key is null then
    raise exception 'A reward key is required.';
  end if;

  if stars_input is null or stars_input < 0 or stars_input > 3 then
    raise exception 'Stars must be between 0 and 3.';
  end if;

  if normalized_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'Invalid difficulty value.';
  end if;

  if normalized_phrase = '' then
    raise exception 'A phrase is required.';
  end if;

  difficulty_multiplier := case normalized_difficulty
    when 'easy' then 1
    when 'medium' then 2
    when 'hard' then 3
  end;

  coins_awarded := stars_input * difficulty_multiplier;

  insert into public.transactions (
    user_id,
    resource_type,
    amount,
    reason,
    metadata
  )
  values (
    current_user_id,
    'bb_coin',
    coins_awarded,
    'single_player_reward',
    jsonb_build_object(
      'reward_key', reward_key,
      'stars', stars_input,
      'difficulty', normalized_difficulty,
      'phrase', normalized_phrase,
      'transcript', normalized_transcript,
      'similarity', normalized_similarity
    )
  )
  on conflict do nothing
  returning id into inserted_transaction_id;

  if inserted_transaction_id is not null and coins_awarded > 0 then
    perform public.increment_resource(current_user_id, 'bb_coin', coins_awarded);
  end if;

  return coins_awarded;
end;
$$;

grant execute on function public.award_single_player_reward(uuid, integer, text, text, text, numeric) to authenticated;
