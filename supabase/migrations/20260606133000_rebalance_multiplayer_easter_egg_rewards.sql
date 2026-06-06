create or replace function public.calculate_campaign_currency_reward_count(
  difficulty text,
  seed text
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized_difficulty text := lower(btrim(coalesce(difficulty, '')));
  roll_value double precision := public.seeded_reward_roll(seed);
begin
  case normalized_difficulty
    when 'easy' then
      return case
        when roll_value <= 0.37 then 0
        when roll_value <= 0.75 then 1
        when roll_value <= 0.92 then 2
        when roll_value <= 0.97 then 3
        when roll_value <= 0.99 then 4
        else 5
      end;
    when 'medium' then
      return case
        when roll_value <= 0.20 then 0
        when roll_value <= 0.35 then 1
        when roll_value <= 0.65 then 2
        when roll_value <= 0.85 then 3
        when roll_value <= 0.95 then 4
        else 5
      end;
    when 'hard' then
      return case
        when roll_value <= 0.10 then 1
        when roll_value <= 0.35 then 2
        when roll_value <= 0.65 then 3
        when roll_value <= 0.90 then 4
        else 5
      end;
    else
      return 0;
  end case;
end;
$$;
