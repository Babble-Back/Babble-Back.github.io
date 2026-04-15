create or replace function public.consume_round_listen(listen_round_id uuid)
returns table (
  round_id uuid,
  user_id uuid,
  listen_count integer,
  paid_listen_count integer,
  free_limit integer,
  next_play_cost integer,
  current_balance integer,
  charged boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.rounds%rowtype;
  listen_count_value integer := 0;
  next_listen_count_value integer := 0;
  free_limit_value integer := 2;
  current_balance_value integer := 0;
  charged_now boolean := false;
  replay_cost integer := 5;
  inserted_transaction_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to play this clip.';
  end if;

  if listen_round_id is null then
    raise exception 'A round id is required.';
  end if;

  select r.*
  into round_row
  from public.rounds as r
  where r.id = listen_round_id
  for update;

  if round_row.id is null then
    raise exception 'Round not found.';
  end if;

  if round_row.recipient_id <> current_user_id then
    raise exception 'Only the recipient can play this clip.';
  end if;

  if round_row.status <> 'waiting_for_attempt' then
    raise exception 'This clip can only be replayed before the imitation is saved.';
  end if;

  free_limit_value := case coalesce(round_row.difficulty, 'easy')
    when 'easy' then 2
    when 'medium' then 3
    when 'hard' then 4
    else 2
  end;

  insert into public.round_listen_usage (
    round_id,
    user_id,
    listen_count
  )
  values (
    round_row.id,
    current_user_id,
    0
  )
  on conflict on constraint round_listen_usage_pkey do nothing;

  select rlu.listen_count
  into listen_count_value
  from public.round_listen_usage as rlu
  where rlu.round_id = round_row.id
    and rlu.user_id = current_user_id
  for update;

  listen_count_value := coalesce(listen_count_value, 0);
  next_listen_count_value := listen_count_value + 1;

  if next_listen_count_value > free_limit_value then
    select ur.amount
    into current_balance_value
    from public.user_resources as ur
    where ur.user_id = current_user_id
      and ur.resource_type = 'bb_coin'
    for update;

    current_balance_value := coalesce(current_balance_value, 0);

    if current_balance_value < replay_cost then
      raise exception 'You need 5 BB Coins for another replay.';
    end if;

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
      -replay_cost,
      'round_extra_listen',
      jsonb_build_object(
        'round_id', round_row.id,
        'listen_count', next_listen_count_value,
        'free_limit', free_limit_value
      )
    )
    returning t.id into inserted_transaction_id;

    if inserted_transaction_id is null then
      raise exception 'Unable to charge the replay cost.';
    end if;

    perform public.increment_resource(current_user_id, 'bb_coin', -replay_cost);
    charged_now := true;
  end if;

  update public.round_listen_usage as rlu
  set
    listen_count = next_listen_count_value,
    updated_at = now()
  where rlu.round_id = round_row.id
    and rlu.user_id = current_user_id;

  select ur.amount
  into current_balance_value
  from public.user_resources as ur
  where ur.user_id = current_user_id
    and ur.resource_type = 'bb_coin';

  current_balance_value := coalesce(current_balance_value, 0);

  return query
  select
    round_row.id,
    current_user_id,
    next_listen_count_value,
    greatest(next_listen_count_value - free_limit_value, 0),
    free_limit_value,
    replay_cost,
    current_balance_value,
    charged_now;
end;
$$;

revoke all on function public.consume_round_listen(uuid) from public;
grant execute on function public.consume_round_listen(uuid) to authenticated;
