import type { Round } from '../features/rounds/types';
import type { ArchiveCompletedRoundSummary } from '../features/rounds/types';
import type { RoundListenState } from '../features/rounds/types';
import type { RoundStarCount } from '../features/rounds/types';
import { scoreGuess } from '../features/rounds/utils';
import { computeDifficulty, normalizePackText, type WordDifficulty } from '../utils/difficulty';
import { sendClipSentPushNotification } from './push';
import { supabase, supabaseConfigError } from './supabase';
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

interface RoundRow {
  id: string;
  created_at: string;
  sender_id: string;
  sender_email: string;
  sender_username: string;
  recipient_id: string;
  recipient_email: string;
  recipient_username: string;
  correct_phrase: string;
  difficulty: WordDifficulty | null;
  original_audio_path: string;
  reversed_audio_path: string;
  guess: string | null;
  attempt_audio_path: string | null;
  attempt_reversed_path: string | null;
  score: number | null;
  status: Round['status'];
}

interface CreateRoundRecordInput {
  currentUserId: string;
  recipientId: string;
  correctPhrase: string;
  difficulty: WordDifficulty;
  originalAudioBlob: Blob;
  reversedAudioBlob: Blob;
}

interface SaveRoundAttemptInput {
  currentUserId: string;
  roundId: string;
  attemptAudioBlob: Blob;
  attemptReversedBlob: Blob;
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

async function mapRoundRow(row: RoundRow): Promise<Round> {
  const [originalAudioUrl, reversedAudioUrl, attemptAudioUrl, attemptReversedUrl] =
    await Promise.all([
      createSignedAudioUrl(row.original_audio_path),
      createSignedAudioUrl(row.reversed_audio_path),
      createSignedAudioUrl(row.attempt_audio_path),
      createSignedAudioUrl(row.attempt_reversed_path),
    ]);

  return {
    id: row.id,
    createdAt: row.created_at,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    senderUsername: row.sender_username,
    recipientId: row.recipient_id,
    recipientEmail: row.recipient_email,
    recipientUsername: row.recipient_username,
    correctPhrase: row.correct_phrase,
    difficulty: row.difficulty ?? computeDifficulty(row.correct_phrase).difficulty,
    originalAudioBlob: null,
    reversedAudioBlob: null,
    originalAudioUrl,
    reversedAudioUrl,
    guess: row.guess ?? '',
    attemptAudioBlob: null,
    attemptReversedBlob: null,
    attemptAudioUrl,
    attemptReversedUrl,
    score: row.score,
    status: row.status,
  };
}

export async function listRounds(): Promise<Round[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Unable to load rounds: ${error.message}`);
  }

  return Promise.all(((data as unknown as RoundRow[] | null) ?? []).map(mapRoundRow));
}

export async function createRoundRecord(
  input: CreateRoundRecordInput,
): Promise<Round> {
  const client = requireSupabase();
  const roundId = makeRoundId();
  const [originalAudio, reversedAudio] = await Promise.all([
    uploadAudio(input.originalAudioBlob, {
      ownerId: input.currentUserId,
      roundId,
      label: 'original',
    }),
    uploadAudio(input.reversedAudioBlob, {
      ownerId: input.currentUserId,
      roundId,
      label: 'reversed',
    }),
  ]);

  const { data, error } = await client
    .from('rounds')
    .insert({
      id: roundId,
      recipient_id: input.recipientId,
      correct_phrase: normalizePackText(input.correctPhrase),
      difficulty: input.difficulty,
      original_audio_path: originalAudio.path,
      reversed_audio_path: reversedAudio.path,
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
    reversedAudioBlob: input.reversedAudioBlob,
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
  const [attemptAudio, attemptReversedAudio] = await Promise.all([
    uploadAudio(input.attemptAudioBlob, {
      ownerId: input.currentUserId,
      roundId: input.roundId,
      label: 'attempt',
    }),
    uploadAudio(input.attemptReversedBlob, {
      ownerId: input.currentUserId,
      roundId: input.roundId,
      label: 'attempt-reversed',
    }),
  ]);

  const { data, error } = await client
    .from('rounds')
    .update({
      attempt_audio_path: attemptAudio.path,
      attempt_reversed_path: attemptReversedAudio.path,
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
    attemptReversedBlob: input.attemptReversedBlob,
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
    throw new Error(`Unable to submit the guess: ${error?.message || 'Unknown error.'}`);
  }

  return mapRoundRow(data as unknown as RoundRow);
}

export async function markRoundResultsViewed(roundId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('mark_round_results_viewed', {
    view_round_id: roundId,
  });

  if (error) {
    throw new Error(`Unable to mark the round results as viewed: ${error.message}`);
  }
}

export async function getRoundListenState(roundId: string): Promise<RoundListenState> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_round_listen_state', {
    listen_round_id: roundId,
  });

  if (error) {
    throw new Error(`Unable to load the round listen state: ${error.message}`);
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
    throw new Error(`Unable to authorize round playback: ${error.message}`);
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

  const { data, error } = await client.rpc('archive_completed_round', {
    round_id: input.roundId,
  });

  if (error) {
    throw new Error(`Unable to archive the completed round: ${error.message}`);
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
