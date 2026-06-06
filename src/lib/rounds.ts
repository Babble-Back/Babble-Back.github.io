import type { Round } from '../features/rounds/types';
import type { ArchiveCompletedRoundSummary } from '../features/rounds/types';
import type { HomeThreadSummary } from '../features/rounds/types';
import type { RoundGuessEvent } from '../features/rounds/types';
import type { RoundListenState } from '../features/rounds/types';
import type { RoundSummary } from '../features/rounds/types';
import type { RoundStarCount } from '../features/rounds/types';
import { scoreGuessByTrace } from '../features/rounds/utils';
import { computeDifficulty, normalizePackText, type WordDifficulty } from '../utils/difficulty';
import { sendAudioMessagePushNotification, sendClipSentPushNotification } from './push';
import { formatSupabaseError, supabase, supabaseConfigError } from './supabase';
import { createSignedAudioUrl, uploadAudio } from './storage/uploadAudio';

const ROUND_COLUMN_LIST = [
  'id',
  'created_at',
  'round_mode',
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
  'sender_reaction_message',
  'sender_reaction_updated_at',
  'guess',
  'guess_events',
  'guess_mistake_count',
  'attempt_audio_path',
  'attempt_reversed_path',
  'recipient_reaction_message',
  'recipient_reaction_updated_at',
  'chat_gave_up',
  'chat_collapsed_at',
  'chat_audio_expires_at',
  'sender_viewed_results_at',
  'recipient_viewed_results_at',
  'score',
  'status',
];

const CHAT_METADATA_COLUMNS = new Set([
  'round_mode',
  'chat_gave_up',
  'chat_collapsed_at',
  'chat_audio_expires_at',
  'sender_viewed_results_at',
  'recipient_viewed_results_at',
]);

const ROUND_COLUMNS = ROUND_COLUMN_LIST.join(', ');
const ROUND_COLUMNS_WITHOUT_CHAT_METADATA = ROUND_COLUMN_LIST
  .filter((column) => !CHAT_METADATA_COLUMNS.has(column))
  .join(', ');
const LEGACY_ROUND_COLUMNS = ROUND_COLUMNS_WITHOUT_CHAT_METADATA.replace(
  ', guess_events, guess_mistake_count',
  '',
);

const ROUND_HOME_COLUMNS = [
  'id',
  'created_at',
  'sender_id',
  'recipient_id',
  'score',
  'status',
].join(', ');
const ROUND_HOME_COLUMNS_WITH_MODE = [
  'id',
  'created_at',
  'round_mode',
  'sender_id',
  'recipient_id',
  'score',
  'status',
].join(', ');
const CHAT_HOME_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'round_mode',
  'sender_id',
  'recipient_id',
  'status',
  'sender_chat_read_at',
  'recipient_chat_read_at',
].join(', ');

interface RoundRow {
  id: string;
  created_at: string;
  round_mode?: Round['roundMode'] | null;
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
  sender_reaction_message: string | null;
  sender_reaction_updated_at: string | null;
  guess: string | null;
  guess_events: unknown;
  guess_mistake_count: number | null;
  attempt_audio_path: string | null;
  attempt_reversed_path: string | null;
  recipient_reaction_message: string | null;
  recipient_reaction_updated_at: string | null;
  chat_gave_up?: boolean | null;
  chat_collapsed_at?: string | null;
  chat_audio_expires_at?: string | null;
  sender_viewed_results_at?: string | null;
  recipient_viewed_results_at?: string | null;
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
  reactionMessage?: string | null;
}

interface CreateChatRoundRecordInput {
  currentUserId: string;
  recipientId: string;
  correctPhrase: string;
  originalAudioBlob: Blob;
}

interface SaveRoundAttemptInput {
  currentUserId: string;
  roundId: string;
  attemptAudioBlob: Blob;
  roundMode?: Round['roundMode'];
}

interface CompleteChatRoundInput {
  attemptAudioBlob?: Blob | null;
  currentUserId?: string;
  roundId: string;
  guess: string;
  guessEvents: RoundGuessEvent[];
  guessMistakeCount: number;
  gaveUp: boolean;
}

interface SubmitRoundGuessInput {
  roundId: string;
  correctPhrase: string;
  guess: string;
  guessEvents: RoundGuessEvent[];
  guessMistakeCount: number;
  difficulty: WordDifficulty;
}

interface SaveRoundReactionInput {
  roundId: string;
  message: string;
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
  chat_last_active_at?: string | null;
  chat_unread_count?: number | null;
  last_active_at: string | null;
}

interface HomeRoundSummaryRow {
  id: string;
  created_at: string;
  round_mode?: Round['roundMode'] | null;
  sender_id: string;
  recipient_id: string;
  score: number | null;
  status: Round['status'];
}

interface HomeChatSummaryRow {
  id: string;
  created_at: string;
  updated_at?: string | null;
  round_mode?: Round['roundMode'] | null;
  sender_id: string;
  recipient_id: string;
  status: Round['status'];
  sender_chat_read_at?: string | null;
  recipient_chat_read_at?: string | null;
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
export const maxRoundReactionLength = 500;
export const maxChatPhraseLength = 80;

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

function isMissingRoundGuessTraceColumnError(message: string) {
  return /guess_events|guess_mistake_count/i.test(message);
}

function isMissingRoundChatMetadataColumnError(message: string) {
  return /round_mode|chat_gave_up|chat_collapsed_at|chat_audio_expires_at|sender_viewed_results_at|recipient_viewed_results_at|sender_chat_read_at|recipient_chat_read_at/i.test(
    message,
  );
}

function normalizeChatPhrase(phrase: string) {
  const normalizedPhrase = phrase
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');

  if (!normalizedPhrase) {
    throw new Error('Type what you are going to say before recording.');
  }

  if (normalizedPhrase.length > maxChatPhraseLength) {
    throw new Error(`Keep chat phrases to ${maxChatPhraseLength} characters or fewer.`);
  }

  return normalizedPhrase;
}

function isChatAudioExpired(row: RoundRow) {
  if ((row.round_mode ?? 'reward') !== 'chat' || !row.chat_audio_expires_at) {
    return false;
  }

  const expiresAt = new Date(row.chat_audio_expires_at).getTime();

  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function normalizeRoundReactionMessage(message: string | null | undefined) {
  const normalizedMessage = (message ?? '').trim();

  if (!normalizedMessage) {
    return null;
  }

  if (normalizedMessage.length > maxRoundReactionLength) {
    throw new Error(`Reactions must be ${maxRoundReactionLength} characters or fewer.`);
  }

  return normalizedMessage;
}

function normalizeRoundGuessEvent(event: RoundGuessEvent): RoundGuessEvent {
  const value = Array.from(event.value ?? '')[0] ?? '';
  const expected = Array.from(event.expected ?? '')[0] ?? '';
  const index = Number.isFinite(event.index) ? Math.max(0, Math.floor(event.index)) : 0;
  const mistakeCount = Number.isFinite(event.mistakeCount)
    ? Math.max(0, Math.floor(event.mistakeCount))
    : 0;
  const elapsedMs = Number.isFinite(event.elapsedMs)
    ? Math.max(0, Math.round(event.elapsedMs))
    : 0;
  const attemptIndex = Number.isFinite(event.attemptIndex)
    ? Math.max(0, Math.floor(event.attemptIndex ?? 0))
    : null;

  const normalizedEvent: RoundGuessEvent = {
    index,
    value,
    expected,
    correct: Boolean(event.correct),
    mistakeCount,
    elapsedMs,
  };

  if (attemptIndex !== null) {
    normalizedEvent.attemptIndex = attemptIndex;
  }

  return normalizedEvent;
}

function normalizeRoundGuessEvents(events: readonly RoundGuessEvent[] | null | undefined) {
  return (events ?? []).slice(0, 1000).map(normalizeRoundGuessEvent);
}

function normalizeGuessMistakeCount(mistakeCount: number) {
  if (!Number.isFinite(mistakeCount)) {
    throw new Error('Unable to score the guess.');
  }

  return Math.max(0, Math.floor(mistakeCount));
}

function mapRoundGuessEvents(value: unknown): RoundGuessEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<RoundGuessEvent[]>((events, event) => {
    if (!event || typeof event !== 'object') {
      return events;
    }

    const rawEvent = event as Partial<RoundGuessEvent>;
    events.push(
      normalizeRoundGuessEvent({
        index: Number(rawEvent.index ?? 0),
        value: typeof rawEvent.value === 'string' ? rawEvent.value : '',
        expected: typeof rawEvent.expected === 'string' ? rawEvent.expected : '',
        correct: Boolean(rawEvent.correct),
        mistakeCount: Number(rawEvent.mistakeCount ?? 0),
        elapsedMs: Number(rawEvent.elapsedMs ?? 0),
        attemptIndex: Number(rawEvent.attemptIndex ?? 0),
      }),
    );

    return events;
  }, []);
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
  const shouldIncludeAudioUrls = (options?.includeAudioUrls ?? true) && !isChatAudioExpired(row);
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
    senderReactionMessage: row.sender_reaction_message,
    senderReactionUpdatedAt: row.sender_reaction_updated_at,
    guess: row.guess ?? '',
    guessEvents: mapRoundGuessEvents(row.guess_events),
    guessMistakeCount: row.guess_mistake_count ?? null,
    attemptAudioBlob: null,
    attemptAudioUrl,
    recipientReactionMessage: row.recipient_reaction_message,
    recipientReactionUpdatedAt: row.recipient_reaction_updated_at,
    roundMode: row.round_mode ?? 'reward',
    chatGaveUp: Boolean(row.chat_gave_up),
    chatCollapsedAt: row.chat_collapsed_at ?? null,
    chatAudioExpiresAt: row.chat_audio_expires_at ?? null,
    senderViewedResultsAt: row.sender_viewed_results_at ?? null,
    recipientViewedResultsAt: row.recipient_viewed_results_at ?? null,
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
    chatLastActiveAt: row.chat_last_active_at ?? null,
    chatUnreadCount: row.chat_unread_count ?? 0,
    lastActiveAt: row.last_active_at,
  };
}

function getLatestIsoDate(left: string | null | undefined, right: string | null | undefined) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function getChatEventAt(row: HomeChatSummaryRow) {
  return row.status === 'waiting_for_attempt'
    ? row.created_at
    : (row.updated_at ?? row.created_at);
}

function isFallbackChatUnreadForUser(row: HomeChatSummaryRow, currentUserId: string) {
  if ((row.round_mode ?? 'reward') !== 'chat') {
    return false;
  }

  if (row.sender_id === currentUserId) {
    if (row.status !== 'attempted' && row.status !== 'complete') {
      return false;
    }

    const eventAt = getChatEventAt(row);
    return !row.sender_chat_read_at || new Date(row.sender_chat_read_at).getTime() < new Date(eventAt).getTime();
  }

  if (row.recipient_id === currentUserId) {
    if (row.status !== 'waiting_for_attempt') {
      return false;
    }

    return (
      !row.recipient_chat_read_at ||
      new Date(row.recipient_chat_read_at).getTime() < new Date(row.created_at).getTime()
    );
  }

  return false;
}

function mapFallbackHomeThreads(
  currentUserId: string,
  rows: HomeRoundSummaryRow[],
  chatRows: HomeChatSummaryRow[] = [],
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
        chatLastActiveAt: null,
        chatUnreadCount: 0,
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

  for (const row of chatRows) {
    if ((row.round_mode ?? 'reward') !== 'chat') {
      continue;
    }

    const friendId = row.sender_id === currentUserId ? row.recipient_id : row.sender_id;
    const eventAt = getChatEventAt(row);
    const existingThread = threadMap.get(friendId);
    const thread =
      existingThread ??
      {
        friendId,
        latestRound: null,
        activeRound: null,
        reviewRound: null,
        currentRoundCount: 0,
        chatLastActiveAt: null,
        chatUnreadCount: 0,
        lastActiveAt: null,
      };

    thread.chatLastActiveAt = getLatestIsoDate(thread.chatLastActiveAt, eventAt);
    thread.lastActiveAt = getLatestIsoDate(thread.lastActiveAt, eventAt);

    if (isFallbackChatUnreadForUser(row, currentUserId)) {
      thread.chatUnreadCount += 1;
    }

    if (!existingThread) {
      threadMap.set(friendId, thread);
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

    let fallbackResult = await client
      .from('rounds')
      .select(ROUND_HOME_COLUMNS_WITH_MODE)
      .eq('round_mode', 'reward')
      .order('created_at', { ascending: false });

    if (fallbackResult.error && isMissingRoundChatMetadataColumnError(fallbackResult.error.message)) {
      fallbackResult = await client
        .from('rounds')
        .select(ROUND_HOME_COLUMNS)
        .order('created_at', { ascending: false });
    }

    if (fallbackResult.error) {
      throw new Error(`Unable to load thread summaries: ${fallbackResult.error.message}`);
    }

    const fallbackRows = ((fallbackResult.data as unknown as HomeRoundSummaryRow[] | null) ?? [])
      .filter((row) => (row.round_mode ?? 'reward') === 'reward');
    let fallbackChatRows: HomeChatSummaryRow[] = [];

    const chatFallbackResult = await client
      .from('rounds')
      .select(CHAT_HOME_COLUMNS)
      .eq('round_mode', 'chat')
      .order('updated_at', { ascending: false });

    if (!chatFallbackResult.error) {
      fallbackChatRows = (chatFallbackResult.data as unknown as HomeChatSummaryRow[] | null) ?? [];
    } else if (!isMissingRoundChatMetadataColumnError(chatFallbackResult.error.message)) {
      throw new Error(`Unable to load chat thread summaries: ${chatFallbackResult.error.message}`);
    }

    return mapFallbackHomeThreads(
      resolvedCurrentUserId,
      fallbackRows,
      fallbackChatRows,
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
  let { data, error } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .eq('id', normalizedRoundId)
    .maybeSingle();

  if (error && isMissingRoundChatMetadataColumnError(error.message)) {
    const fallbackResult = await client
      .from('rounds')
      .select(ROUND_COLUMNS_WITHOUT_CHAT_METADATA)
      .eq('id', normalizedRoundId)
      .maybeSingle();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error && isMissingRoundGuessTraceColumnError(error.message)) {
    const fallbackResult = await client
      .from('rounds')
      .select(LEGACY_ROUND_COLUMNS)
      .eq('id', normalizedRoundId)
      .maybeSingle();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    throw new Error(`Unable to load the round: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapRoundRow(data as unknown as RoundRow);
}

export async function listFriendChatRounds(input: {
  currentUserId: string;
  friendId: string;
  limit?: number;
}): Promise<Round[]> {
  const currentUserId = input.currentUserId.trim();
  const friendId = input.friendId.trim();

  if (!currentUserId || !friendId) {
    return [];
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .eq('round_mode', 'chat')
    .or(
      `and(sender_id.eq.${currentUserId},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${currentUserId})`,
    )
    .order('created_at', { ascending: true })
    .limit(input.limit ?? 50);

  if (error) {
    if (isMissingRoundChatMetadataColumnError(error.message)) {
      return [];
    }

    throw new Error(`Unable to load chat history: ${error.message}`);
  }

  return Promise.all(
    ((data as unknown as RoundRow[] | null) ?? []).map((row) => mapRoundRow(row)),
  );
}

export async function createRoundRecord(
  input: CreateRoundRecordInput,
): Promise<Round> {
  const client = requireSupabase();
  const roundId = makeRoundId();
  const senderReactionMessage = normalizeRoundReactionMessage(input.reactionMessage);
  const originalAudio = await uploadAudio(input.originalAudioBlob, {
    ownerId: input.currentUserId,
    roundId,
    label: 'original',
  });

  let { data, error } = await client
    .from('rounds')
    .insert({
      id: roundId,
      recipient_id: input.recipientId,
      pack_id: input.packId,
      correct_phrase: normalizePackText(input.correctPhrase),
      difficulty: input.difficulty,
      original_audio_path: originalAudio.path,
      reversed_audio_path: null,
      sender_reaction_message: senderReactionMessage,
      status: 'waiting_for_attempt',
    })
    .select(ROUND_COLUMNS)
    .single();

  if (error && isMissingRoundChatMetadataColumnError(error.message)) {
    const fallbackResult = await client
      .from('rounds')
      .insert({
        id: roundId,
        recipient_id: input.recipientId,
        pack_id: input.packId,
        correct_phrase: normalizePackText(input.correctPhrase),
        difficulty: input.difficulty,
        original_audio_path: originalAudio.path,
        reversed_audio_path: null,
        sender_reaction_message: senderReactionMessage,
        status: 'waiting_for_attempt',
      })
      .select(ROUND_COLUMNS_WITHOUT_CHAT_METADATA)
      .single();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error && isMissingRoundGuessTraceColumnError(error.message)) {
    const fallbackResult = await client
      .from('rounds')
      .insert({
        id: roundId,
        recipient_id: input.recipientId,
        pack_id: input.packId,
        correct_phrase: normalizePackText(input.correctPhrase),
        difficulty: input.difficulty,
        original_audio_path: originalAudio.path,
        reversed_audio_path: null,
        sender_reaction_message: senderReactionMessage,
        status: 'waiting_for_attempt',
      })
      .select(LEGACY_ROUND_COLUMNS)
      .single();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

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

export async function createChatRoundRecord(
  input: CreateChatRoundRecordInput,
): Promise<Round> {
  const client = requireSupabase();
  const roundId = makeRoundId();
  const correctPhrase = normalizeChatPhrase(input.correctPhrase);
  const difficulty = computeDifficulty(correctPhrase).difficulty;
  const sentAt = new Date().toISOString();
  const originalAudio = await uploadAudio(input.originalAudioBlob, {
    ownerId: input.currentUserId,
    roundId,
    label: 'chat-original',
  });

  const { data, error } = await client
    .from('rounds')
    .insert({
      id: roundId,
      round_mode: 'chat',
      recipient_id: input.recipientId,
      pack_id: null,
      correct_phrase: correctPhrase,
      difficulty,
      original_audio_path: originalAudio.path,
      reversed_audio_path: null,
      guess: null,
      guess_events: [],
      guess_mistake_count: 0,
      chat_gave_up: false,
      sender_chat_read_at: sentAt,
      score: null,
      status: 'waiting_for_attempt',
    })
    .select(ROUND_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to send the chat recording: ${
        error ? formatSupabaseError(error, 'Unknown Supabase error.') : 'Unknown error.'
      }`,
    );
  }

  const nextRound = {
    ...(await mapRoundRow(data as unknown as RoundRow)),
    originalAudioBlob: input.originalAudioBlob,
  };

  try {
    await sendAudioMessagePushNotification(input.recipientId);
  } catch (pushError) {
    console.warn(
      'Unable to send push notification for the new chat recording. The round was created, but the recipient was not notified.',
      pushError,
    );
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
  const attemptReadAt = new Date().toISOString();
  const updatePayload = {
    attempt_audio_path: attemptAudio.path,
    attempt_reversed_path: null,
    ...(input.roundMode === 'chat'
      ? {
          recipient_chat_read_at: attemptReadAt,
          sender_chat_read_at: null,
        }
      : {}),
    status: 'attempted',
  };

  let { data, error } = await client
    .from('rounds')
    .update(updatePayload)
    .eq('id', input.roundId)
    .select(ROUND_COLUMNS)
    .single();

  if (error && isMissingRoundChatMetadataColumnError(error.message)) {
    const fallbackResult = await client
      .from('rounds')
      .update(updatePayload)
      .eq('id', input.roundId)
      .select(ROUND_COLUMNS_WITHOUT_CHAT_METADATA)
      .single();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error && isMissingRoundGuessTraceColumnError(error.message)) {
    const fallbackResult = await client
      .from('rounds')
      .update(updatePayload)
      .eq('id', input.roundId)
      .select(LEGACY_ROUND_COLUMNS)
      .single();

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error || !data) {
    throw new Error(`Unable to save the attempt: ${error?.message || 'Unknown error.'}`);
  }

  const savedRound = {
    ...(await mapRoundRow(data as unknown as RoundRow)),
    attemptAudioBlob: input.attemptAudioBlob,
  };

  if (input.roundMode === 'chat' && savedRound.senderId !== input.currentUserId) {
    try {
      await sendAudioMessagePushNotification(savedRound.senderId);
    } catch (pushError) {
      console.warn(
        'Unable to send push notification for the chat reply. The attempt was saved, but the sender was not notified.',
        pushError,
      );
    }
  }

  return savedRound;
}

export async function saveChatRoundAttempt(input: SaveRoundAttemptInput): Promise<Round> {
  return saveRoundAttempt({ ...input, roundMode: 'chat' });
}

export async function submitRoundGuess(
  input: SubmitRoundGuessInput,
): Promise<Round> {
  const client = requireSupabase();
  const guess = input.guess.trim();
  const guessMistakeCount = normalizeGuessMistakeCount(input.guessMistakeCount);
  const guessEvents = normalizeRoundGuessEvents(input.guessEvents);
  const score = scoreGuessByTrace(input.correctPhrase, guessEvents, guessMistakeCount);
  let { data, error } = await client.rpc('complete_round_and_award_resources', {
    round_id: input.roundId,
    guess_input: guess,
    guess_events_input: guessEvents,
    guess_mistake_count_input: guessMistakeCount,
    score_input: score,
    difficulty_input: input.difficulty,
  });

  if (error && isMissingRpcSignatureError(error.message, 'complete_round_and_award_resources')) {
    const fallbackResult = await client.rpc('complete_round_and_award_resources', {
      round_id: input.roundId,
      guess_input: guess,
      score_input: score,
      difficulty_input: input.difficulty,
    });

    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error || !data) {
    throw new Error(
      `Unable to submit the guess: ${
        error ? formatSupabaseError(error, 'Unknown Supabase error.') : 'Unknown error.'
      }`,
    );
  }

  return mapRoundRow(data as unknown as RoundRow);
}

export async function completeChatRound(input: CompleteChatRoundInput): Promise<Round> {
  const client = requireSupabase();
  const guessEvents = normalizeRoundGuessEvents(input.guessEvents);
  const guessMistakeCount = normalizeGuessMistakeCount(input.guessMistakeCount);
  const attemptAudio =
    input.attemptAudioBlob && input.currentUserId
      ? await uploadAudio(input.attemptAudioBlob, {
          ownerId: input.currentUserId,
          roundId: input.roundId,
          label: 'attempt',
        })
      : null;
  const { data, error } = await client.rpc('complete_chat_round', {
    attempt_audio_path_input: attemptAudio?.path ?? null,
    chat_round_id: input.roundId,
    gave_up_input: input.gaveUp,
    guess_events_input: guessEvents,
    guess_input: input.guess.trim(),
    guess_mistake_count_input: guessMistakeCount,
  });

  if (error || !data) {
    throw new Error(
      `Unable to finish the chat round: ${
        error ? formatSupabaseError(error, 'Unknown Supabase error.') : 'Unknown error.'
      }`,
    );
  }

  return mapRoundRow(data as unknown as RoundRow);
}

export async function saveRoundReaction(
  input: SaveRoundReactionInput,
): Promise<Round> {
  const client = requireSupabase();
  const reactionMessage = normalizeRoundReactionMessage(input.message);
  const { data, error } = await client.rpc('set_round_reaction', {
    reaction_message_input: reactionMessage,
    reaction_round_id: input.roundId,
  });

  if (error || !data) {
    throw new Error(
      `Unable to save the reaction: ${
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

export async function markChatThreadRead(friendId: string): Promise<void> {
  const normalizedFriendId = friendId.trim();

  if (!normalizedFriendId) {
    return;
  }

  const client = requireSupabase();
  const { error } = await client.rpc('mark_chat_thread_read', {
    chat_friend_id: normalizedFriendId,
  });

  if (error) {
    throw new Error(
      `Unable to mark the chat thread as read: ${formatSupabaseError(
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
  let { data: roundData, error: roundError } = await client
    .from('rounds')
    .select(ROUND_COLUMNS)
    .eq('id', input.roundId)
    .single();

  if (roundError && isMissingRoundChatMetadataColumnError(roundError.message)) {
    const fallbackResult = await client
      .from('rounds')
      .select(ROUND_COLUMNS_WITHOUT_CHAT_METADATA)
      .eq('id', input.roundId)
      .single();

    roundData = fallbackResult.data;
    roundError = fallbackResult.error;
  }

  if (roundError && isMissingRoundGuessTraceColumnError(roundError.message)) {
    const fallbackResult = await client
      .from('rounds')
      .select(LEGACY_ROUND_COLUMNS)
      .eq('id', input.roundId)
      .single();

    roundData = fallbackResult.data;
    roundError = fallbackResult.error;
  }

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
