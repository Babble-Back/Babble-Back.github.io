import type { FriendThreadStats } from '../rounds/types';

export interface Friend extends FriendThreadStats {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type FriendRequestDirection = 'incoming' | 'outgoing';

export interface FriendRequest {
  id: string;
  requesterId: string;
  requesterEmail: string;
  requesterUsername: string;
  recipientId: string;
  recipientEmail: string;
  recipientUsername: string;
  status: FriendRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  direction: FriendRequestDirection;
  otherUserId: string;
  otherUserUsername: string;
  otherUserEmail: string;
}
