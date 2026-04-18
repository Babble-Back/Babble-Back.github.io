import type { WordDifficulty } from '../../utils/difficulty';

export type RoundStatus = 'waiting_for_attempt' | 'attempted' | 'complete';
export type RoundStarCount = 0 | 1 | 2 | 3;

export interface RewardSequenceReward {
  id: string;
  stars: RoundStarCount;
  difficulty: WordDifficulty;
  rewardAmount: number;
  bonusResourceType?: string | null;
  bonusRewardAmount?: number;
}

export interface FriendThreadStats {
  completedRoundCount: number;
  averageStars?: number | null;
  nextSenderId: string | null;
  lastCompletedAt: string | null;
}

export interface ArchiveCompletedRoundSummary extends FriendThreadStats {
  roundId: string;
  friendshipId: string;
  friendId: string;
  senderId: string;
  recipientId: string;
}

export interface RoundReward extends RewardSequenceReward {
  roundId: string;
  userId: string;
  claimed: boolean;
  createdAt: string;
  campaignId: string | null;
  bonusResourceType: string | null;
  bonusRewardAmount: number;
}

export interface RoundListenState {
  roundId: string;
  userId: string;
  listenCount: number;
  paidListenCount: number;
  freeLimit: number;
  nextPlayCost: number;
  currentBalance: number;
  charged: boolean;
}

export interface Round {
  id: string;
  createdAt: string;
  senderId: string;
  senderEmail: string;
  senderUsername: string;
  recipientId: string;
  recipientEmail: string;
  recipientUsername: string;
  packId: string | null;
  correctPhrase: string;
  difficulty: WordDifficulty;
  originalAudioBlob: Blob | null;
  originalAudioUrl: string | null;
  guess: string;
  attemptAudioBlob: Blob | null;
  attemptAudioUrl: string | null;
  score: number | null;
  status: RoundStatus;
}

export interface RoundSummary {
  id: string;
  createdAt: string;
  senderId: string;
  recipientId: string;
  score: number | null;
  status: RoundStatus;
}

export interface HomeThreadSummary {
  friendId: string;
  latestRound: RoundSummary | null;
  activeRound: RoundSummary | null;
  reviewRound: RoundSummary | null;
  currentRoundCount: number;
  lastActiveAt: string | null;
}
