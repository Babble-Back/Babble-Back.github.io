import type { Round } from '../features/rounds/types';
import type { ArchiveCompletedRoundSummary } from '../features/rounds/types';
import type { HomeThreadSummary } from '../features/rounds/types';
import type { RoundListenState } from '../features/rounds/types';
import type { RoundSummary } from '../features/rounds/types';
import type { RoundStarCount } from '../features/rounds/types';
import { scoreGuess } from '../features/rounds/utils';
import { computeDifficulty, normalizePackText, type WordDifficulty } from '../utils/difficulty';
import { sendClipSentPushNotification } from './push';
import { formatSupabaseError, supabase, supabaseConfigError } from './supabase';
import { createSignedAudioUrl, uploadAudio } from './storage/uploadAudio';

const ROUND_COLUMNS = [
  'id',
  'created_at',
  'sender_id',
  'sender_email',
  'sender_username',
  'recipient_id',
  'recipient_email',
  'recipient_username',
  'pack_id',
  'correct_phrase',
  'difficulty',
  'original_audio_path',
  'reversed_audio_path',
  'guess',
  'attempt_audio_path',
  'attempt_reversed_path',
  'score',
  'status',
].join(', ');

const ROUND_HOME_COLUMNS = [
  'id',
  'created_at',
  'sender_id',
  'recipient_id',
  'score',
  'status',
].join(', ');

interface RoundRow {
  id: string;
  created_at: string;
  sender_id: string;
  sender_email: string;
  sender_username: string;
  recipient_id: string;
  recipient_email: string;
  recipient_username: string;
  pack_id: string | null;
  correct_phrase: string;
  difficulty: WordDifficulty | null;
  original_audio_path: string;
  reversed_audio_path: string | null;
  guess: string | null;
  attempt_audio_path: string | null;
  attempt_reversed_path: string | null;
  score: number | null;
  status: Round['status'];
}

interface CreateRoundRecordInput {
  currentUserId: string;
  recipientId: string;
  packId: string | null;
  correctPhrase: string;
  difficulty: WordDifficulty;
  originalAudioBlob: Blob;
}

interface SaveRoundAttemptInput {
  currentUserId: string;
  roundId: string;
  attemptAudioBlob: Blob;
}

interface SubmitRoundGuessInput {
  roundId: string;
  guess: string;
  correctPhrase: string;
  difficulty: WordDifficulty;
}

interface ArchiveCompletedRoundInput {
  currentUserId: string;
  roundId: string;
}

interface ArchiveCompletedRoundRow {
  friendship_id: string;
  user_one_id: string;
  user_one_email: string;
  user_two_id: string;
  user_two_email: string;
  completed_round_count: number;
  total_star_score: number;
  average_star_score: number | null;
  next_sender_id: string | null;
  last_completed_at: string | null;
}

interface RoundListenStateRow {
  round_id: string;
  user_id: string;
  listen_count: number;
  paid_listen_count: number;
  free_limit: number;
  next_play_cost: number;
  current_balance: number;
  charged: boolean;
}

interface HomeThreadSummaryRow {
  friend_id: string;
  latest_round_id: string | null;
  latest_round_created_at: string | null;
  latest_round_sender_id: string | null;
  latest_round_recipient_id: string | null;
  latest_round_score: number | null;
  latest_round_status: Round['status'] | null;
  active_round_id: string | null;
  active_round_created_at: string | null;
  active_round_sender_id: string | null;
  active_round_recipient_id: string | null;
  active_round_score: number | null;
  active_round_status: Round['status'] | null;
  review_round_id: string | null;
  review_round_created_at: string | null;
  review_round_sender_id: string | null;
  review_round_recipient_id: string | null;
  review_round_score: number | null;
  review_round_status: Round['status'] | null;
  current_round_count: number | null;
  last_active_at: string | null;
}

interface HomeRoundSummaryRow {
  id: string;
  created_at: string;
  sender_id: string;
  recipient_id: string;
  score: number | null;
  status: Round['status'];
}

export const difficultyMultiplier: Record<WordDifficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

export const freeListenLimitByDifficulty: Record<WordDifficulty, number> = {
  easy: 2,
  medium: 3,
  hard: 4,
};

export const extraListenCost = 5;

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function makeRoundId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `round-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isMissingStorageObjectError(message: string) {
  return /not found|does not exist|no such key|not exist/i.test(message);
}

function isMissingRpcSignatureError(message: string, functionName: string) {
  const normalizedMessage = message.toLowerCase();
  const normalizedFunctionName = functionName.toLowerCase();

  return (
    normalizedMessage.includes('could not find the function public.') &&
    normalizedMessage.includes(normalizedFunctionName)
  );
}

export function scoreToStars(score: number | null): RoundStarCount {
  if (score === null) {
    return 0;
  }

  if (score >= 10) {
    return 3;
  }

  if (score >= 8) {
    return 2;
  }

  if (score >= 5) {
    return 1;
  }

  return 0;
}

export function calculateCoinReward(score: number | null, difficulty: WordDifficulty) {
  return scoreToStars(score) * difficultyMultiplier[difficulty];
}

function mapRoundListenStateRow(row: RoundListenStateRow): RoundListenState {
  return {
    roundId: row.round_id,
    userId: row.user_id,
    listenCount: row.listen_count,
    paidListenCount: row.paid_listen_count,
    freeLimit: row.free_limit,
    nextPlayCost: row.next_play_cost,
    currentBalance: row.current_balance,
    charged: row.charged,
  };
}

async function mapRoundRow(
  row: RoundRow,
  options?: {
    includeAudioUrls?: boolean;
  },
): Promise<Round> {
  const shouldIncludeAudioUrls = options?.includeAudioUrls ?? true;
  const [originalAudioUrl, attemptAudioUrl] =
    shouldIncludeAudioUrls
      ? await Promise.all([
          createSignedAudioUrl(row.original_audio_path),
          createSignedAudioUrl(row.attempt_audio_path),
        ])
      : [null, null];

  return {
    id: row.id,
    createdAt: row.created_at,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    senderUsername: row.sender_username,
    recipientId: row.recipient_id,
    recipientEmail: row.recipient_email,
    recipientUsername: row.recipient_username,
    packId: row.pack_id,
    correctPhrase: row.correct_phrase,
    difficulty: row.difficulty ?? computeDifficulty(row.correct_phrase).difficulty,
    originalAudioBlob: null,
    originalAudioUrl,
    guess: row.guess ?? '',
    attemptAudioBlob: null,
    attemptAudioUrl,
    score: row.score,
    status: row.status,
  };
}

function mapHomeThreadRound(options: {
  createdAt: string | null;
  id: string | null;
  recipientId: string | null;
  score: number | null;
  senderId: string | null;
  status: Round['status'] | null;
}): RoundSummary | null {
  if (
    !options.id ||
    !options.createdAt ||
    !options.senderId ||
    !options.recipientId ||
    !options.status
  ) {
    return null;
  }

  return {
    id: options.id,
    createdAt: options.createdAt,
    senderId: options.senderId,
    recipientId: options.recipientId,
    score: options.score,
    status: options.status,
  };
}

function mapHomeThreadSummaryRow(row: HomeThreadSummaryRow): HomeThreadSummary {
  return {
    friendId: row.friend_id,
    latestRound: mapHomeThreadRound({
      createdAt: row.latest_round_created_at,
      id: row.latest_round_id,
      recipientId: row.latest_round_recipient_id,
      score: row.latest_round_score,
      senderId: row.latest_round_sender_id,
      status: row.latest_round_status,
    }),
    activeRound: mapHomeThreadRound({
      createdAt: row.active_round_created_at,
      id: row.active_round_id,
      recipientId: row.active_round_recipient_id,
      score: row.active_round_score,
      senderId: row.active_round_sender_id,
      status: row.active_round_status,
    }),
    reviewRound: mapHomeThreadRound({
      createdAt: row.review_round_created_at,
      id: row.review_round_id,
      recipientId: row.review_round_recipient_id,
      score: row.review_round_score,
      senderId: row.review_round_sender_id,
      status: row.review_round_status,
    }),
    currentRoundCount: row.current_round_count ?? 0,
    lastActiveAt: row.last_active_at,
  };
}

function mapFallbackHomeThreads(
  currentUserId: string,
  rows: HomeRoundSummaryRow[],
): HomeThreadSummary[] {
  const threadMap = new Map<string, HomeThreadSummary>();

  for (const row of rows) {
    const friendId = row.sender_id === currentUserId ? row.recipient_id : row.sender_id;
    const existingThread = threadMap.get(friendId);
    const roundSummary: RoundSummary = {
      id: row.id,
      createdAt: row.created_at,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      score: row.score,
      status: row.status,
    };

    if (!existingThread) {
      threadMap.set(friendId, {
        friendId,
        latestRound: roundSummary,
        activeRound: row.status !== 'complete' ? roundSummary : null,
        reviewRound:
          row.status === 'complete' && row.sender_id === currentUserId ? roundSummary : null,
        currentRoundCount: 1,
        lastActiveAt: row.created_at,
      });
      continue;
    }

    existingThread.currentRoundCount += 1;

    if (!existingThread.latestRound) {
      existingThread.latestRound = roundSummary;
    }

    if (!existingThread.activeRound && row.status !== 'complete') {
      existingThread.activeRound = roundSummary;
    }

    if (
      !existingThread.reviewRound &&
      row.status === 'complete' &&
      row.sender_id === currentUserId
    ) {
      existingThread.reviewRound = roundSummary;
    }
  }

  return [...threadMap.values()];
}

export async function listHomeThreads(currentUserId?: string | null): Promise<HomeThreadSummary[]> {
  const client = requireSupabase();
  let { data, error } = await client.rpc('list_home_threads');

  if (error && /list_home_threads/i.test(error.message)) {
    const resolvedCurrentUserId = currentUserId?.trim() || null;

    if (!resolvedCurrentUserId) {
      return [];
    }

    const fallbackResult = await client
      .from('rounds')
      .select(ROUND_HOME_COLUMNS)
      .order('created_at', { ascending: false });

    if (fallbackResult.error) {
      throw new Error(`Unable to load thread summaries: ${fallbackResult.error.message}`);
    }

    return mapFallbackHomeThreads(
      resolvedCurrentUserId,
      ((fallbackResult.data as unknown as HomeRoundSummaryRow[] | null) ?? []),
    );
  }

  if (error) {
    throw new Error(`Unable to load thread summaries: ${error.message}`);
  }

  return ((data as HomeThreadSummaryRow[] | null) ?? []).map(mapHomeThreadSummaryRow);
}

export async function getRoundDetails(roundId: string): Promise<Round | null> {
  const normalizedRoundId = roundId.trim();

  if (!normalizedRoundId) {
    return null;
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .eq('id', normalizedRoundId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load the round: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapRoundRow(data as unknown as RoundRow);
}

export async function createRoundRecord(
  input: CreateRoundRecordInput,
): Promise<Round> {
  const client = requireSupabase();
  const roundId = makeRoundId();
  const originalAudio = await uploadAudio(input.originalAudioBlob, {
    ownerId: input.currentUserId,
    roundId,
    label: 'original',
  });

  const { data, error } = await client
    .from('rounds')
    .insert({
      id: roundId,
      recipient_id: input.recipientId,
      pack_id: input.packId,
      correct_phrase: normalizePackText(input.correctPhrase),
      difficulty: input.difficulty,
      original_audio_path: originalAudio.path,
      reversed_audio_path: null,
      status: 'waiting_for_attempt',
    })
    .select(ROUND_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Unable to create round: ${error?.message || 'Unknown error.'}`);
  }

  const nextRound = {
    ...(await mapRoundRow(data as unknown as RoundRow)),
    originalAudioBlob: input.originalAudioBlob,
  };

  try {
    await sendClipSentPushNotification(input.recipientId);
  } catch (pushError) {
    console.warn('Unable to send push notification for the new clip. The round was created, but the recipient was not notified.', pushError);
  }

  return nextRound;
}

export async function saveRoundAttempt(
  input: SaveRoundAttemptInput,
): Promise<Round> {
  const client = requireSupabase();
  const attemptAudio = await uploadAudio(input.attemptAudioBlob, {
    ownerId: input.currentUserId,
    roundId: input.roundId,
    label: 'attempt',
  });

  const { data, error } = await client
    .from('rounds')
    .update({
      attempt_audio_path: attemptAudio.path,
      attempt_reversed_path: null,
      status: 'attempted',
    })
    .eq('id', input.roundId)
    .select(ROUND_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Unable to save the attempt: ${error?.message || 'Unknown error.'}`);
  }

  return {
    ...(await mapRoundRow(data as unknown as RoundRow)),
    attemptAudioBlob: input.attemptAudioBlob,
  };
}

export async function submitRoundGuess(
  input: SubmitRoundGuessInput,
): Promise<Round> {
  const client = requireSupabase();
  const guess = input.guess.trim();
  const score = scoreGuess(guess, input.correctPhrase);
  const { data, error } = await client.rpc('complete_round_and_award_resources', {
    round_id: input.roundId,
    guess_input: guess,
    score_input: score,
    difficulty_input: input.difficulty,
  });

  if (error || !data) {
    throw new Error(
      `Unable to submit the guess: ${
        error ? formatSupabaseError(error, 'Unknown Supabase error.') : 'Unknown error.'
      }`,
    );
  }

  return mapRoundRow(data as unknown as RoundRow);
}

export async function markRoundResultsViewed(roundId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('mark_round_results_viewed', {
    view_round_id: roundId,
  });

  if (error) {
    throw new Error(
      `Unable to mark the round results as viewed: ${formatSupabaseError(
        error,
        'Unknown Supabase error.',
      )}`,
    );
  }
}

export async function getRoundListenState(roundId: string): Promise<RoundListenState> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_round_listen_state', {
    listen_round_id: roundId,
  });

  if (error) {
    throw new Error(
      `Unable to load the round listen state: ${formatSupabaseError(
        error,
        'Unknown Supabase error.',
      )}`,
    );
  }

  const listenStateRow = (Array.isArray(data) ? data[0] : data) as RoundListenStateRow | null;

  if (!listenStateRow) {
    throw new Error('Unable to load the round listen state.');
  }

  return mapRoundListenStateRow(listenStateRow);
}

export async function consumeRoundListen(roundId: string): Promise<RoundListenState> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('consume_round_listen', {
    listen_round_id: roundId,
  });

  if (error) {
    throw new Error(
      `Unable to authorize round playback: ${formatSupabaseError(
        error,
        'Unknown Supabase error.',
      )}`,
    );
  }

  const listenStateRow = (Array.isArray(data) ? data[0] : data) as RoundListenStateRow | null;

  if (!listenStateRow) {
    throw new Error('Unable to authorize round playback.');
  }

  return mapRoundListenStateRow(listenStateRow);
}

export async function archiveCompletedRound(
  input: ArchiveCompletedRoundInput,
): Promise<ArchiveCompletedRoundSummary> {
  const client = requireSupabase();
  const { data: roundData, error: roundError } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .eq('id', input.roundId)
    .single();

  if (roundError || !roundData) {
    throw new Error(`Unable to load the round to archive: ${roundError?.message || 'Unknown error.'}`);
  }

  const round = roundData as unknown as RoundRow;
  if (round.sender_id !== input.currentUserId) {
    throw new Error('Only the original sender can archive this round.');
  }

  if (round.status !== 'complete') {
    throw new Error('Only completed rounds can be archived.');
  }

  const storagePaths = Array.from(
    new Set(
      [
        round.original_audio_path,
        round.reversed_audio_path,
        round.attempt_audio_path,
        round.attempt_reversed_path,
      ].filter((path): path is string => Boolean(path)),
    ),
  );

  let { data, error } = await client.rpc('archive_completed_round', {
    archive_round_id: input.roundId,
  });

  if (error && isMissingRpcSignatureError(error.message, 'archive_completed_round')) {
    const fallbackResult = await client.rpc('archive_completed_round', {
      round_id: input.roundId,
    });

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    throw new Error(
      `Unable to archive the completed round: ${formatSupabaseError(
        error,
        'Unknown Supabase error.',
      )}`,
    );
  }

  const archivedRow = ((data as ArchiveCompletedRoundRow[] | null) ?? [])[0];
  if (!archivedRow) {
    throw new Error('The completed round could not be archived.');
  }

  if (storagePaths.length > 0) {
    const { error: deleteError } = await client.storage.from('audio').remove(storagePaths);

    if (deleteError && !isMissingStorageObjectError(deleteError.message)) {
      console.warn('Unable to remove archived audio after archiving the round.', deleteError);
    }
  }

  return {
    roundId: input.roundId,
    friendshipId: archivedRow.friendship_id,
    friendId: round.recipient_id,
    senderId: round.sender_id,
    recipientId: round.recipient_id,
    completedRoundCount: archivedRow.completed_round_count,
    averageStars: archivedRow.average_star_score,
    nextSenderId: archivedRow.next_sender_id,
    lastCompletedAt: archivedRow.last_completed_at,
  };
}
