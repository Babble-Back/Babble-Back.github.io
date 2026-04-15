create or replace function public.claim_round_reward(claim_round_id uuid)
returns table (
  id uuid,
  round_id uuid,
  user_id uuid,
  stars integer,
  difficulty text,
  reward_amount integer,
  claimed boolean,
  created_at timestamptz,
  claimed_now boolean,
  current_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  reward_row public.round_rewards%rowtype;
  inserted_transaction_id uuid;
  reward_claimed_now boolean := false;
  current_balance_value integer := 0;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to claim a round reward.';
  end if;

  if claim_round_id is null then
    raise exception 'A round id is required.';
  end if;

  select rr.*
  into reward_row
  from public.round_rewards as rr
  where rr.round_id = claim_round_id
    and rr.user_id = current_user_id
  for update;

  if reward_row.id is null then
    return;
  end if;

  if not reward_row.claimed then
    update public.round_rewards as rr
    set claimed = true
    where rr.id = reward_row.id
    returning rr.* into reward_row;

    insert into public.transactions as t (
      user_id,
      resource_type,
      amount,
      reason,
      metadata
    )
    values (
      current_user_id,
      'bb_coin',
      reward_row.reward_amount,
      'round_reward',
      jsonb_build_object(
        'round_id', reward_row.round_id,
        'stars', reward_row.stars,
        'difficulty', reward_row.difficulty
      )
    )
    on conflict do nothing
    returning t.id into inserted_transaction_id;

    if inserted_transaction_id is not null then
      perform public.increment_resource(current_user_id, 'bb_coin', reward_row.reward_amount);
    end if;

    reward_claimed_now := inserted_transaction_id is not null;
  end if;

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  return query
  select
    reward_row.id,
    reward_row.round_id,
    reward_row.user_id,
    reward_row.stars,
    reward_row.difficulty,
    reward_row.reward_amount,
    reward_row.claimed,
    reward_row.created_at,
    reward_claimed_now,
    current_balance_value;
end;
$$;

grant execute on function public.claim_round_reward(uuid) to authenticated;
