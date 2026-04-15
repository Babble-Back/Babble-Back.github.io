import type { FriendRequest } from '../features/social/types';
import type { Friend } from '../features/social/types';
import { supabase, supabaseConfigError } from './supabase';

interface FriendshipRow {
  id: string;
  user_one_id: string;
  user_one_email: string;
  user_one_username: string;
  user_two_id: string;
  user_two_email: string;
  user_two_username: string;
  created_at: string;
  completed_round_count: number;
  total_star_score: number;
  next_sender_id: string | null;
  last_completed_at: string | null;
}

interface FriendRequestRow {
  id: string;
  requester_id: string;
  requester_email: string;
  requester_username: string;
  recipient_id: string;
  recipient_email: string;
  recipient_username: string;
  status: FriendRequest['status'];
  created_at: string;
  responded_at: string | null;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

export async function listFriends(currentUserId: string): Promise<Friend[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('friendships')
    .select(
      'id, user_one_id, user_one_email, user_one_username, user_two_id, user_two_email, user_two_username, created_at, completed_round_count, total_star_score, next_sender_id, last_completed_at',
    )
    .or(`user_one_id.eq.${currentUserId},user_two_id.eq.${currentUserId}`)
    .order('last_completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Unable to load friends: ${error.message}`);
  }

  return ((data as FriendshipRow[] | null) ?? []).map((row) =>
    row.user_one_id === currentUserId
      ? {
          id: row.user_two_id,
          username: row.user_two_username,
          email: row.user_two_email,
          createdAt: row.created_at,
          completedRoundCount: row.completed_round_count,
          averageStars:
            row.completed_round_count > 0
              ? row.total_star_score / row.completed_round_count
              : null,
          nextSenderId: row.next_sender_id,
          lastCompletedAt: row.last_completed_at,
        }
      : {
          id: row.user_one_id,
          username: row.user_one_username,
          email: row.user_one_email,
          createdAt: row.created_at,
          completedRoundCount: row.completed_round_count,
          averageStars:
            row.completed_round_count > 0
              ? row.total_star_score / row.completed_round_count
              : null,
          nextSenderId: row.next_sender_id,
          lastCompletedAt: row.last_completed_at,
        },
  );
}

export async function listFriendRequests(
  currentUserId: string,
): Promise<FriendRequest[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('friend_requests')
    .select(
      'id, requester_id, requester_email, requester_username, recipient_id, recipient_email, recipient_username, status, created_at, responded_at',
    )
    .eq('status', 'pending')
    .or(`requester_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Unable to load friend requests: ${error.message}`);
  }

  return ((data as FriendRequestRow[] | null) ?? []).map((row) => {
    const isIncoming = row.recipient_id === currentUserId;

    return {
      id: row.id,
      requesterId: row.requester_id,
      requesterEmail: row.requester_email,
      requesterUsername: row.requester_username,
      recipientId: row.recipient_id,
      recipientEmail: row.recipient_email,
      recipientUsername: row.recipient_username,
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at,
      direction: isIncoming ? 'incoming' : 'outgoing',
      otherUserId: isIncoming ? row.requester_id : row.recipient_id,
      otherUserUsername: isIncoming ? row.requester_username : row.recipient_username,
      otherUserEmail: isIncoming ? row.requester_email : row.recipient_email,
    };
  });
}

export async function sendFriendRequestByUsername(recipientIdentifier: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('request_friendship', {
    recipient_identifier_input: recipientIdentifier.trim().toLowerCase(),
  });

  if (error) {
    throw new Error(`Unable to send the friend request: ${error.message}`);
  }
}

export async function respondToFriendRequest(requestId: string, accept: boolean) {
  const client = requireSupabase();
  const { error } = await client.rpc('respond_to_friend_request', {
    friend_request_id: requestId,
    accept_request: accept,
  });

  if (error) {
    throw new Error(
      `Unable to ${accept ? 'accept' : 'reject'} the friend request: ${error.message}`,
    );
  }
}
