create or replace function public.complete_round_and_award_resources(
  round_id uuid,
  guess_input text,
  score_input integer,
  difficulty_input text
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  normalized_guess text := btrim(coalesce(guess_input, ''));
  normalized_difficulty text := lower(btrim(coalesce(difficulty_input, '')));
  stars integer;
  difficulty_multiplier integer;
  coins_awarded integer;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to complete a round.';
  end if;

  if round_id is null then
    raise exception 'A round id is required.';
  end if;

  if normalized_guess = '' then
    raise exception 'A guess is required.';
  end if;

  select r.*
  into round_row
  from public.rounds as r
  where r.id = complete_round_and_award_resources.round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if round_row.recipient_id <> current_user_id then
    raise exception 'Only the recipient can complete this round.';
  end if;

  if round_row.status = 'complete' then
    return round_row;
  end if;

  if round_row.status <> 'attempted' then
    raise exception 'Round cannot be completed before an attempt is saved.';
  end if;

  if round_row.attempt_audio_path is null or round_row.attempt_reversed_path is null then
    raise exception 'Round attempt not found.';
  end if;

  if score_input is null or score_input < 0 or score_input > 10 then
    raise exception 'Score must be between 0 and 10.';
  end if;

  if round_row.difficulty is not null and btrim(round_row.difficulty) <> '' then
    normalized_difficulty := round_row.difficulty;
  end if;

  if normalized_difficulty is null or normalized_difficulty = '' then
    raise exception 'A difficulty value is required to prepare the reward.';
  end if;

  if normalized_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'Invalid difficulty value.';
  end if;

  stars := public.score_to_stars(score_input);

  difficulty_multiplier := case normalized_difficulty
    when 'easy' then 1
    when 'medium' then 2
    when 'hard' then 3
  end;

  coins_awarded := stars * difficulty_multiplier;

  update public.rounds as r
  set
    guess = normalized_guess,
    score = score_input,
    status = 'complete',
    difficulty = normalized_difficulty
  where r.id = round_row.id
  returning r.* into round_row;

  insert into public.round_rewards (
    round_id,
    user_id,
    stars,
    difficulty,
    reward_amount
  )
  values
    (
      round_row.id,
      round_row.sender_id,
      stars,
      normalized_difficulty,
      coins_awarded
    ),
    (
      round_row.id,
      round_row.recipient_id,
      stars,
      normalized_difficulty,
      coins_awarded
    )
  on conflict on constraint round_rewards_round_id_user_id_key do nothing;

  return round_row;
end;
$$;

grant execute on function public.complete_round_and_award_resources(uuid, text, integer, text) to authenticated;
