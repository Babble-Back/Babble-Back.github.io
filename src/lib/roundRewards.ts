import type { RoundReward } from '../features/rounds/types';
import { supabase, supabaseConfigError } from './supabase';

interface RoundRewardRow {
  id: string;
  round_id: string;
  user_id: string;
  stars: number;
  difficulty: RoundReward['difficulty'];
  reward_amount: number;
  claimed: boolean;
  created_at: string;
  campaign_id: string | null;
  campaign_resource_type: string | null;
  campaign_reward_amount: number;
}

interface ClaimRoundRewardRow extends RoundRewardRow {
  claimed_now: boolean;
  current_balance: number;
  campaign_current_balance: number | null;
}

export interface ClaimRewardResult {
  claimedNow: boolean;
  currentBalance: number | null;
  bonusResourceCurrentBalance: number | null;
  reward: RoundReward;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function mapRoundRewardRow(row: RoundRewardRow): RoundReward {
  return {
    id: row.id,
    roundId: row.round_id,
    userId: row.user_id,
    stars: row.stars as RoundReward['stars'],
    difficulty: row.difficulty,
    rewardAmount: row.reward_amount,
    bonusResourceType: row.campaign_resource_type,
    bonusRewardAmount: row.campaign_reward_amount,
    claimed: row.claimed,
    createdAt: row.created_at,
    campaignId: row.campaign_id,
  };
}

export async function getRoundReward(userId: string, roundId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('round_rewards')
    .select(
      'id, round_id, user_id, stars, difficulty, reward_amount, claimed, created_at, campaign_id, campaign_resource_type, campaign_reward_amount',
    )
    .eq('user_id', userId)
    .eq('round_id', roundId)
    .maybeSingle<RoundRewardRow>();

  if (error) {
    throw new Error(`Unable to load the round reward: ${error.message}`);
  }

  return data ? mapRoundRewardRow(data) : null;
}

export async function claimReward(userId: string, roundId: string) {
  const reward = await getRoundReward(userId, roundId);

  if (!reward || reward.claimed) {
    return reward
      ? {
          claimedNow: false,
          currentBalance: null,
          bonusResourceCurrentBalance: null,
          reward,
        }
      : null;
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc('claim_round_reward', {
    claim_round_id: roundId,
  });

  if (error) {
    throw new Error(`Unable to claim the round reward: ${error.message}`);
  }

  const claimedRewardRow = (Array.isArray(data) ? data[0] : data) as ClaimRoundRewardRow | null;

  return {
    claimedNow: claimedRewardRow?.claimed_now ?? false,
    currentBalance: claimedRewardRow?.current_balance ?? null,
    bonusResourceCurrentBalance: claimedRewardRow?.campaign_current_balance ?? null,
    reward: claimedRewardRow ? mapRoundRewardRow(claimedRewardRow) : reward,
  };
}
