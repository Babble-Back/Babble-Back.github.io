import { supabase, supabaseConfigError } from './supabase';

export type FriendMatchLeaderboardKey =
  | 'best_team_coins'
  | 'best_event_team'
  | 'best_speaker'
  | 'best_babbler'
  | 'best_three_star_streak';

export interface FriendMatchLeaderboardEntry {
  leaderboardKey: FriendMatchLeaderboardKey;
  rank: number;
  primaryUserId: string;
  primaryUsername: string;
  secondaryUserId: string | null;
  secondaryUsername: string | null;
  metricValue: number;
  sampleSize: number;
}

interface FriendMatchLeaderboardRow {
  leaderboard_key: FriendMatchLeaderboardKey;
  rank: number;
  primary_user_id: string;
  primary_username: string;
  secondary_user_id: string | null;
  secondary_username: string | null;
  metric_value: number | string;
  sample_size: number;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function coerceNumber(value: number | string) {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(numericValue) ? numericValue : 0;
}

export async function listMonthlyFriendMatchLeaderboards(input: {
  limit?: number;
  periodEnd: string;
  periodStart: string;
}): Promise<FriendMatchLeaderboardEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('list_monthly_friend_match_leaderboards', {
    leaderboard_limit: input.limit ?? 5,
    period_end_input: input.periodEnd,
    period_start_input: input.periodStart,
  });

  if (error) {
    throw new Error(`Unable to load the monthly leaderboards: ${error.message}`);
  }

  return ((Array.isArray(data) ? data : []) as FriendMatchLeaderboardRow[]).map((row) => ({
    leaderboardKey: row.leaderboard_key,
    rank: row.rank,
    primaryUserId: row.primary_user_id,
    primaryUsername: row.primary_username,
    secondaryUserId: row.secondary_user_id,
    secondaryUsername: row.secondary_username,
    metricValue: coerceNumber(row.metric_value),
    sampleSize: row.sample_size ?? 0,
  }));
}
