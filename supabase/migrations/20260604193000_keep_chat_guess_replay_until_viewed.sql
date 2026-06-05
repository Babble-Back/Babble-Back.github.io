create or replace function public.mark_chat_thread_read(chat_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be logged in to mark chat messages as read.';
  end if;

  if chat_friend_id is null then
    return;
  end if;

  update public.rounds as r
  set
    sender_chat_read_at = case
      when current_user_id = r.sender_id then timezone('utc'::text, now())
      else r.sender_chat_read_at
    end,
    recipient_chat_read_at = case
      when current_user_id = r.recipient_id then timezone('utc'::text, now())
      else r.recipient_chat_read_at
    end
  where r.round_mode = 'chat'
    and (
      (r.sender_id = current_user_id and r.recipient_id = chat_friend_id)
      or (r.sender_id = chat_friend_id and r.recipient_id = current_user_id)
    );
end;
$$;

grant execute on function public.mark_chat_thread_read(uuid) to authenticated;
