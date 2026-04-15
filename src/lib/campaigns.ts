import { supabase, supabaseConfigError } from './supabase';
import { clearWordPackUnlockCache } from './wordPacks';

const MAX_CACHE_AGE_MS = 1000 * 60 * 10;
const ACTIVE_CAMPAIGN_STATE_CACHE_PREFIX = 'active_campaign_state_cache:';
const CAMPAIGN_RETRY_COST = 5;

export type CampaignChallengeDifficulty = 'easy' | 'medium' | 'hard';
export type CampaignChallengeMode = 'normal' | 'reverse_only';

export interface Campaign {
  id: string;
  name: string | null;
  theme: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  config: Record<string, unknown>;
}

export interface CampaignChallenge {
  id: string;
  campaignId: string;
  challengeIndex: number;
  phrase: string;
  difficulty: CampaignChallengeDifficulty;
  mode: CampaignChallengeMode;
  createdAt: string;
}

export interface CampaignProgress {
  userId: string;
  campaignId: string;
  currentIndex: number;
  completedCount: number;
}

export interface CampaignAttemptState {
  userId: string;
  challengeId: string;
  attemptsToday: number;
  lastAttemptDate: string | null;
  freeAttemptAvailable: boolean;
  retryCost: number;
  currentBalance: number;
  charged: boolean;
}

export interface CampaignLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  completedCount: number;
  currentIndex: number;
  [key: string]: unknown;
}

export interface CampaignState {
  campaign: Campaign;
  challenges: CampaignChallenge[];
  assets: Record<string, string>;
  progress: CampaignProgress;
  attemptState: CampaignAttemptState | null;
  attempts: CampaignAttemptState[];
  unlockedPackIds: string[];
}

export interface CampaignCompletionResult {
  campaignId: string;
  challengeId: string;
  progress: CampaignProgress;
  unlockedPackIds: string[];
  newlyUnlockedPackIds: string[];
  campaignComplete: boolean;
  advanced: boolean;
  rewardAmount: number;
  currentBalance: number | null;
}

export interface CampaignAttemptRewardResult {
  challengeId: string;
  userId: string;
  rewardAmount: number;
  currentBalance: number | null;
}

interface CachedPayload<T> {
  timestamp: number;
  data: T;
}

interface CampaignRow {
  id: string;
  name: string | null;
  theme: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  config: Record<string, unknown> | null;
}

interface CampaignChallengeRow {
  id: string;
  campaign_id: string;
  challenge_index: number;
  phrase: string;
  difficulty: CampaignChallengeDifficulty;
  mode: CampaignChallengeMode;
  created_at: string;
}

interface CampaignAttemptRow {
  user_id?: string;
  result_user_id?: string;
  challenge_id?: string;
  result_challenge_id?: string;
  attempts_today?: number;
  result_attempts_today?: number;
  last_attempt_date?: string | null;
  result_last_attempt_date?: string | null;
  free_attempt_available?: boolean;
  result_free_attempt_available?: boolean;
  retry_cost?: number;
  result_retry_cost?: number;
  current_balance?: number;
  result_current_balance?: number;
  charged?: boolean;
  result_charged?: boolean;
}

interface CampaignProgressRow {
  user_id: string;
  campaign_id: string;
  current_index: number;
  completed_count: number;
}

interface CampaignLeaderboardRow {
  rank: number;
  user_id: string;
  username: string;
  completed_count: number;
  current_index: number;
}

interface ActiveCampaignStateRow {
  campaign: CampaignRow | null;
  challenges: CampaignChallengeRow[];
  assets: Array<{ key: string; value: string }>;
  progress: CampaignProgressRow | null;
  attempts: CampaignAttemptRow[];
  unlocked_pack_ids: string[];
}

interface CampaignCompletionRow {
  campaign_id?: string;
  result_campaign_id?: string;
  challenge_id?: string;
  result_challenge_id?: string;
  user_id?: string;
  result_user_id?: string;
  current_index?: number;
  result_current_index?: number;
  completed_count?: number;
  result_completed_count?: number;
  unlocked_pack_ids?: string[];
  result_unlocked_pack_ids?: string[];
  newly_unlocked_pack_ids?: string[];
  result_newly_unlocked_pack_ids?: string[];
  campaign_complete?: boolean;
  result_campaign_complete?: boolean;
  advanced?: boolean;
  result_advanced?: boolean;
  reward_amount?: number;
  result_reward_amount?: number;
  current_balance?: number;
  result_current_balance?: number;
}

interface CampaignAttemptRewardRow {
  challenge_id?: string;
  result_challenge_id?: string;
  user_id?: string;
  result_user_id?: string;
  reward_amount?: number;
  result_reward_amount?: number;
  current_balance?: number;
  result_current_balance?: number;
}

interface SupabaseRpcErrorLike {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function isMissingRpcFunctionError(message: string, functionName: string) {
  const normalizedMessage = message.toLowerCase();
  const normalizedFunctionName = functionName.toLowerCase();

  return (
    normalizedMessage.includes('could not find the function public.') &&
    normalizedMessage.includes(normalizedFunctionName)
  );
}

function buildMissingCampaignMigrationError(message: string) {
  return `Campaign RPCs are not available on the connected Supabase project yet. Apply the latest campaign migrations with \`supabase db push\`. Original error: ${message}`;
}

function formatSupabaseRpcError(
  functionName: string,
  fallbackPrefix: string,
  error: SupabaseRpcErrorLike,
) {
  const message = error.message?.trim() || fallbackPrefix;
  const details = error.details?.trim();
  const hint = error.hint?.trim();
  const code = error.code?.trim();
  const parts = [message];

  if (details && details !== message) {
    parts.push(`Details: ${details}`);
  }

  if (hint) {
    parts.push(`Hint: ${hint}`);
  }

  if (
    functionName === 'consume_campaign_attempt' &&
    /need 10 bb coins/i.test(message)
  ) {
    parts.push(
      'The connected Supabase project is still using the older campaign retry RPC. Apply the latest campaign migrations with `supabase db push`.',
    );
  }

  if (
    functionName === 'consume_campaign_attempt' &&
    /need 5 bb coins/i.test(message)
  ) {
    parts.push(
      'This means the backend believes your free tries are already used for today and the next retry is paid.',
    );
  }

  if (code) {
    parts.push(`Code: ${code}`);
  }

  return parts.join(' ');
}

function readCachedPayload<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CachedPayload<T>;

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.timestamp !== 'number' ||
      Date.now() - parsed.timestamp > MAX_CACHE_AGE_MS
    ) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedPayload<T>(key: string, data: T) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload: CachedPayload<T> = {
    timestamp: Date.now(),
    data,
  };

  window.localStorage.setItem(key, JSON.stringify(payload));
}

function clearActiveCampaignStateCache(userId?: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUserId = userId?.trim();

  if (!normalizedUserId) {
    return;
  }

  window.localStorage.removeItem(`${ACTIVE_CAMPAIGN_STATE_CACHE_PREFIX}${normalizedUserId}`);
}

function buildEmptyCampaignState(userId: string): CampaignState {
  return {
    campaign: {
      id: '',
      name: null,
      theme: null,
      startDate: null,
      endDate: null,
      isActive: false,
      config: {},
    },
    challenges: [],
    assets: {},
    progress: {
      userId,
      campaignId: '',
      currentIndex: 1,
      completedCount: 0,
    },
    attemptState: null,
    attempts: [],
    unlockedPackIds: [],
  };
}

function mapCampaignRow(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name?.trim() ?? null,
    theme: row.theme?.trim() ?? null,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active,
    config: row.config ?? {},
  };
}

function mapChallengeRow(row: CampaignChallengeRow): CampaignChallenge {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    challengeIndex: row.challenge_index,
    phrase: row.phrase.trim(),
    difficulty: row.difficulty,
    mode: row.mode,
    createdAt: row.created_at,
  };
}

function mapAttemptRow(row: CampaignAttemptRow): CampaignAttemptState {
  return {
    userId: row.user_id ?? row.result_user_id ?? '',
    challengeId: row.challenge_id ?? row.result_challenge_id ?? '',
    attemptsToday: row.attempts_today ?? row.result_attempts_today ?? 0,
    lastAttemptDate: row.last_attempt_date ?? row.result_last_attempt_date ?? null,
    freeAttemptAvailable:
      row.free_attempt_available ?? row.result_free_attempt_available ?? false,
    retryCost: row.retry_cost ?? row.result_retry_cost ?? CAMPAIGN_RETRY_COST,
    currentBalance: row.current_balance ?? row.result_current_balance ?? 0,
    charged: row.charged ?? row.result_charged ?? false,
  };
}

function mapProgressRow(row: CampaignProgressRow): CampaignProgress {
  return {
    userId: row.user_id,
    campaignId: row.campaign_id,
    currentIndex: row.current_index,
    completedCount: row.completed_count,
  };
}

function mapCompletionRow(row: CampaignCompletionRow): CampaignCompletionResult {
  const campaignId = row.campaign_id ?? row.result_campaign_id ?? '';
  const challengeId = row.challenge_id ?? row.result_challenge_id ?? '';
  const userId = row.user_id ?? row.result_user_id ?? '';
  const currentIndex = row.current_index ?? row.result_current_index ?? 1;
  const completedCount = row.completed_count ?? row.result_completed_count ?? 0;
  const rewardAmount = row.reward_amount ?? row.result_reward_amount ?? 0;
  const currentBalance = row.current_balance ?? row.result_current_balance ?? null;

  return {
    campaignId,
    challengeId,
    progress: {
      userId,
      campaignId,
      currentIndex,
      completedCount,
    },
    unlockedPackIds: row.unlocked_pack_ids ?? row.result_unlocked_pack_ids ?? [],
    newlyUnlockedPackIds:
      row.newly_unlocked_pack_ids ?? row.result_newly_unlocked_pack_ids ?? [],
    campaignComplete: row.campaign_complete ?? row.result_campaign_complete ?? false,
    advanced: row.advanced ?? row.result_advanced ?? false,
    rewardAmount,
    currentBalance,
  };
}

function mapAttemptRewardRow(row: CampaignAttemptRewardRow): CampaignAttemptRewardResult {
  return {
    challengeId: row.challenge_id ?? row.result_challenge_id ?? '',
    userId: row.user_id ?? row.result_user_id ?? '',
    rewardAmount: row.reward_amount ?? row.result_reward_amount ?? 0,
    currentBalance: row.current_balance ?? row.result_current_balance ?? null,
  };
}

async function getCurrentUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw new Error(`Unable to read the current user: ${error.message}`);
  }

  return data.user?.id ?? null;
}

async function resolveCampaignUserId(currentUserId?: string | null) {
  const resolvedUserId = currentUserId?.trim() ?? '';
  const authUserId = await getCurrentUserId();

  if (!authUserId) {
    throw new Error('A signed-in user is required to load campaign state.');
  }

  if (resolvedUserId && resolvedUserId !== authUserId) {
    throw new Error('You can only load your own campaign state.');
  }

  return authUserId;
}

export async function loadActiveCampaignState(
  currentUserId?: string | null,
): Promise<CampaignState> {
  const userId = await resolveCampaignUserId(currentUserId);
  const cacheKey = `${ACTIVE_CAMPAIGN_STATE_CACHE_PREFIX}${userId}`;
  const cachedState = readCachedPayload<CampaignState>(cacheKey);

  if (cachedState) {
    return cachedState;
  }

  const client = requireSupabase();
  let { data, error } = await client.rpc('get_active_campaign_state', {
    request_user_id: userId,
  });

  if (error && isMissingRpcFunctionError(error.message, 'get_active_campaign_state')) {
    const fallbackResult = await client.rpc('get_active_campaign_state');
    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    throw new Error(
      isMissingRpcFunctionError(error.message, 'get_active_campaign_state')
        ? buildMissingCampaignMigrationError(error.message)
        : formatSupabaseRpcError(
            'get_active_campaign_state',
            'Unable to load the active campaign state.',
            error,
          ),
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as ActiveCampaignStateRow | null;

  if (!row) {
    const emptyState = buildEmptyCampaignState(userId);

    writeCachedPayload(cacheKey, emptyState);
    return emptyState;
  }

  const campaign = row.campaign
    ? mapCampaignRow(row.campaign)
    : buildEmptyCampaignState(userId).campaign;
  const progress = row.progress ? mapProgressRow(row.progress) : {
    userId,
    campaignId: campaign.id,
    currentIndex: 1,
    completedCount: 0,
  };
  const challenges = row.challenges.map(mapChallengeRow);
  const attempts = row.attempts.map(mapAttemptRow);
  const currentChallengeId =
    challenges.find((challenge) => challenge.challengeIndex === progress.currentIndex)?.id ?? null;
  const attemptState =
    currentChallengeId === null
      ? null
      : attempts.find((attempt) => attempt.challengeId === currentChallengeId) ?? null;

  const state: CampaignState = {
    campaign,
    challenges,
    assets: row.assets.reduce<Record<string, string>>((accumulator, asset) => {
      accumulator[asset.key] = asset.value;
      return accumulator;
    }, {}),
    progress,
    attemptState,
    attempts,
    unlockedPackIds: row.unlocked_pack_ids,
  };

  writeCachedPayload(cacheKey, state);
  return state;
}

export async function consumeCampaignAttempt(
  challengeId: string,
): Promise<CampaignAttemptState> {
  const normalizedChallengeId = challengeId.trim();

  if (!normalizedChallengeId) {
    throw new Error('A challenge id is required to consume a campaign attempt.');
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc('consume_campaign_attempt', {
    consume_challenge_id: normalizedChallengeId,
  });

  if (error) {
    throw new Error(
      isMissingRpcFunctionError(error.message, 'consume_campaign_attempt')
        ? buildMissingCampaignMigrationError(error.message)
        : formatSupabaseRpcError(
            'consume_campaign_attempt',
            'Unable to consume the campaign attempt.',
            error,
          ),
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as CampaignAttemptRow | null;

  if (!row) {
    throw new Error('Unable to consume the campaign attempt.');
  }

  clearActiveCampaignStateCache(await getCurrentUserId());

  return mapAttemptRow(row);
}

export async function completeCampaignChallenge(input: {
  challengeId: string;
  stars: number;
  score: number;
}): Promise<CampaignCompletionResult> {
  const normalizedChallengeId = input.challengeId.trim();

  if (!normalizedChallengeId) {
    throw new Error('A challenge id is required to complete a campaign challenge.');
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc('complete_campaign_challenge', {
    complete_challenge_id: normalizedChallengeId,
    stars_input: input.stars,
    transcript_input: '',
    score_input: input.score,
  });

  if (error) {
    throw new Error(
      isMissingRpcFunctionError(error.message, 'complete_campaign_challenge')
        ? buildMissingCampaignMigrationError(error.message)
        : formatSupabaseRpcError(
            'complete_campaign_challenge',
            'Unable to complete the campaign challenge.',
            error,
          ),
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as CampaignCompletionRow | null;

  if (!row) {
    throw new Error('Unable to complete the campaign challenge.');
  }

  const currentUserId = await getCurrentUserId();
  clearActiveCampaignStateCache(currentUserId);
  clearWordPackUnlockCache(currentUserId);

  return mapCompletionRow(row);
}

export async function awardCampaignAttemptReward(input: {
  challengeId: string;
  stars: number;
  score: number;
}): Promise<CampaignAttemptRewardResult> {
  const normalizedChallengeId = input.challengeId.trim();

  if (!normalizedChallengeId) {
    throw new Error('A challenge id is required to award a campaign attempt reward.');
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc('award_campaign_attempt_reward', {
    reward_challenge_id: normalizedChallengeId,
    stars_input: input.stars,
    transcript_input: '',
    score_input: input.score,
  });

  if (error) {
    throw new Error(
      isMissingRpcFunctionError(error.message, 'award_campaign_attempt_reward')
        ? buildMissingCampaignMigrationError(error.message)
        : formatSupabaseRpcError(
            'award_campaign_attempt_reward',
            'Unable to award the campaign attempt reward.',
            error,
          ),
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as CampaignAttemptRewardRow | null;

  if (!row) {
    throw new Error('Unable to award the campaign attempt reward.');
  }

  return mapAttemptRewardRow(row);
}

export async function listCampaignLeaderboard(
  campaignId: string,
  options?: {
    friendsOnly?: boolean;
  },
): Promise<CampaignLeaderboardEntry[]> {
  const normalizedCampaignId = campaignId.trim();

  if (!normalizedCampaignId) {
    return [];
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc('list_campaign_leaderboard', {
    campaign_id: normalizedCampaignId,
    friends_only: options?.friendsOnly ?? false,
  });

  if (error) {
    throw new Error(
      isMissingRpcFunctionError(error.message, 'list_campaign_leaderboard')
        ? buildMissingCampaignMigrationError(error.message)
        : formatSupabaseRpcError(
            'list_campaign_leaderboard',
            'Unable to load the campaign leaderboard.',
            error,
          ),
    );
  }

  return ((Array.isArray(data) ? data : []) as CampaignLeaderboardRow[]).map((row) => ({
    rank: row.rank,
    userId: row.user_id,
    username: row.username,
    completedCount: row.completed_count,
    currentIndex: row.current_index,
  }));
}
