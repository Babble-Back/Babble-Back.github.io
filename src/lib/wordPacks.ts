import { normalizePackText, type WordDifficulty } from '../utils/difficulty';
import { supabase, supabaseConfigError } from './supabase';
export type { WordDifficulty } from '../utils/difficulty';

export interface WordPack {
  id: string;
  name: string;
  description: string | null;
  isFree: boolean;
  unlockTier?: WordDifficulty | null;
  isUnlocked?: boolean;
  maxUnlockedDifficulty?: WordDifficulty | null;
  createdAt: string;
}

export interface WordEntry {
  id: string;
  packId: string;
  text: string;
  syllables: number;
  charLength: number;
  difficulty: WordDifficulty;
  createdAt: string;
}

export interface WordPackWithWords extends WordPack {
  words: WordEntry[];
}

interface WordPackRow {
  id: string;
  name: string;
  description: string | null;
  is_free: boolean;
  unlock_tier: WordDifficulty | null;
  created_at: string;
}

interface WordRow {
  id: string;
  pack_id: string;
  text: string;
  syllables: number;
  char_length: number;
  difficulty: WordDifficulty;
  created_at: string;
}

export interface WordPackUnlock {
  userId: string;
  packId: string;
  sourceCampaignId: string | null;
  maxUnlockedDifficulty: WordDifficulty | null;
  unlockedAt: string;
}

interface WordPackUnlockRow {
  user_id: string;
  pack_id: string;
  source_campaign_id: string | null;
  max_unlocked_difficulty: WordDifficulty | null;
  unlocked_at: string;
}

interface LegacyWordPackUnlockRow {
  user_id: string;
  pack_id: string;
  source_campaign_id: string | null;
  unlocked_at: string;
}

interface CachedPayload<T> {
  timestamp: number;
  data: T;
}

const MAX_CACHE_AGE_MS = 1000 * 60 * 60 * 24;
const WORD_PACKS_CACHE_KEY = 'word_packs_cache';
const WORDS_CACHE_PREFIX = 'word_pack_words_cache:';
const WORD_PACK_UNLOCKS_CACHE_PREFIX = 'word_pack_unlocks_cache:';
const DIFFICULTY_ORDER: WordDifficulty[] = ['easy', 'medium', 'hard'];

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
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

export function clearWordPackUnlockCache(userId?: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUserId = userId?.trim();

  if (!normalizedUserId) {
    return;
  }

  window.localStorage.removeItem(`${WORD_PACK_UNLOCKS_CACHE_PREFIX}${normalizedUserId}`);
}

function mapWordPackRow(row: WordPackRow): WordPack {
  return {
    id: row.id,
    name: row.name.trim(),
    description: row.description?.trim() ?? null,
    isFree: row.is_free,
    unlockTier: row.unlock_tier,
    createdAt: row.created_at,
  };
}

function mapWordPackUnlockRow(row: WordPackUnlockRow): WordPackUnlock {
  return {
    userId: row.user_id,
    packId: row.pack_id,
    sourceCampaignId: row.source_campaign_id,
    maxUnlockedDifficulty: row.max_unlocked_difficulty,
    unlockedAt: row.unlocked_at,
  };
}

function mapWordRow(row: WordRow): WordEntry {
  return {
    id: row.id,
    packId: row.pack_id,
    text: normalizePackText(row.text),
    syllables: row.syllables,
    charLength: row.char_length,
    difficulty: row.difficulty,
    createdAt: row.created_at,
  };
}

function getDifficultyRank(difficulty: WordDifficulty | null | undefined) {
  if (!difficulty) {
    return 0;
  }

  return DIFFICULTY_ORDER.indexOf(difficulty) + 1;
}

function resolveUnlockDifficulty(difficulty: WordDifficulty | null | undefined) {
  return difficulty ?? 'hard';
}

function isMissingColumnError(message: string, columnName: string) {
  const normalizedMessage = message.toLowerCase();
  const normalizedColumnName = columnName.toLowerCase();

  return (
    normalizedMessage.includes(normalizedColumnName) &&
    normalizedMessage.includes('does not exist')
  );
}

export function getAllowedDifficulties(
  maxUnlockedDifficulty?: WordDifficulty | null,
): WordDifficulty[] {
  const difficultyRank = getDifficultyRank(maxUnlockedDifficulty);

  if (difficultyRank <= 0) {
    return [];
  }

  return DIFFICULTY_ORDER.filter((difficulty) => getDifficultyRank(difficulty) <= difficultyRank);
}

export function filterWordsByMaxUnlockedDifficulty(
  words: WordEntry[],
  maxUnlockedDifficulty?: WordDifficulty | null,
) {
  const allowedDifficulties = new Set(getAllowedDifficulties(maxUnlockedDifficulty));

  if (!allowedDifficulties.size) {
    return [];
  }

  return words.filter((word) => allowedDifficulties.has(word.difficulty));
}

export function resolveWordPackId(
  packs: WordPack[],
  requestedPackId?: string | null,
  options?: {
    isPackSelectable?: (pack: WordPack) => boolean;
  },
) {
  const normalizedRequestedPackId = requestedPackId?.trim();
  const isPackSelectable = options?.isPackSelectable ?? (() => true);

  if (normalizedRequestedPackId) {
    const matchingPack = packs.find(
      (pack) => pack.id === normalizedRequestedPackId && isPackSelectable(pack),
    );
    if (matchingPack) {
      return matchingPack.id;
    }
  }

  return packs.find((pack) => isPackSelectable(pack))?.id ?? packs[0]?.id ?? null;
}

export async function listWordPacks(options?: {
  useCache?: boolean;
}): Promise<WordPack[]> {
  const useCache = options?.useCache ?? true;

  if (useCache) {
    const cachedPacks = readCachedPayload<WordPack[]>(WORD_PACKS_CACHE_KEY);
    if (cachedPacks && cachedPacks.length > 0) {
      return cachedPacks;
    }
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('word_packs')
    .select('id, name, description, is_free, unlock_tier, created_at')
    .order('created_at', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Unable to load word packs: ${error.message}`);
  }

  const packs = ((data as WordPackRow[] | null) ?? []).map(mapWordPackRow);

  if (useCache && packs.length > 0) {
    writeCachedPayload(WORD_PACKS_CACHE_KEY, packs);
  }

  return packs;
}

async function getCurrentUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw new Error(`Unable to read the current user: ${error.message}`);
  }

  return data.user?.id ?? null;
}

export async function listWordPackUnlocks(options?: {
  useCache?: boolean;
}): Promise<WordPackUnlock[]> {
  const useCache = options?.useCache ?? true;
  const currentUserId = await getCurrentUserId();

  if (!currentUserId) {
    return [];
  }

  const cacheKey = `${WORD_PACK_UNLOCKS_CACHE_PREFIX}${currentUserId}`;

  if (useCache) {
    const cachedUnlocks = readCachedPayload<WordPackUnlock[]>(cacheKey);
    if (cachedUnlocks && cachedUnlocks.length > 0) {
      return cachedUnlocks;
    }
  }

  const client = requireSupabase();
  let { data, error } = await client
    .from('user_word_pack_unlocks')
    .select('user_id, pack_id, source_campaign_id, max_unlocked_difficulty, unlocked_at')
    .eq('user_id', currentUserId)
    .order('unlocked_at', { ascending: false });

  if (error && isMissingColumnError(error.message, 'max_unlocked_difficulty')) {
    const fallbackResult = await client
      .from('user_word_pack_unlocks')
      .select('user_id, pack_id, source_campaign_id, unlocked_at')
      .eq('user_id', currentUserId)
      .order('unlocked_at', { ascending: false });

    data = ((fallbackResult.data as LegacyWordPackUnlockRow[] | null) ?? []).map((row) => ({
      ...row,
      max_unlocked_difficulty: 'hard' as const,
    }));
    error = fallbackResult.error;
  }

  if (error) {
    throw new Error(`Unable to load campaign pack unlocks: ${error.message}`);
  }

  const unlocks = ((data as WordPackUnlockRow[] | null) ?? []).map(mapWordPackUnlockRow);

  if (useCache && unlocks.length > 0) {
    writeCachedPayload(cacheKey, unlocks);
  }

  return unlocks;
}

export async function listWordPacksWithAccess(options?: {
  useCache?: boolean;
}): Promise<WordPack[]> {
  const [packs, unlocks] = await Promise.all([
    listWordPacks(options),
    listWordPackUnlocks(options),
  ]);

  if (!packs.length) {
    return packs;
  }

  if (!unlocks.length) {
    return packs.map((pack) => ({
      ...pack,
      isUnlocked: pack.isFree,
      maxUnlockedDifficulty: pack.isFree ? 'hard' : null,
    }));
  }

  const maxUnlockedDifficultyByPackId = new Map<string, WordDifficulty>();

  for (const unlock of unlocks) {
    const nextDifficulty = resolveUnlockDifficulty(unlock.maxUnlockedDifficulty);
    const currentDifficulty = maxUnlockedDifficultyByPackId.get(unlock.packId) ?? null;

    if (getDifficultyRank(nextDifficulty) > getDifficultyRank(currentDifficulty)) {
      maxUnlockedDifficultyByPackId.set(unlock.packId, nextDifficulty);
    }
  }

  return packs.map((pack) => ({
    ...pack,
    isUnlocked: pack.isFree || maxUnlockedDifficultyByPackId.has(pack.id),
    maxUnlockedDifficulty: pack.isFree ? 'hard' : maxUnlockedDifficultyByPackId.get(pack.id) ?? null,
  }));
}

export async function listWordsByPackId(
  packId: string,
  options?: {
    useCache?: boolean;
  },
): Promise<WordEntry[]> {
  const normalizedPackId = packId.trim();
  if (!normalizedPackId) {
    return [];
  }

  const useCache = options?.useCache ?? true;
  const cacheKey = `${WORDS_CACHE_PREFIX}${normalizedPackId}`;

  if (useCache) {
    const cachedWords = readCachedPayload<WordEntry[]>(cacheKey);
    if (cachedWords && cachedWords.length > 0) {
      return cachedWords;
    }
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('words')
    .select('id, pack_id, text, syllables, char_length, difficulty, created_at')
    .eq('pack_id', normalizedPackId)
    .order('created_at', { ascending: true })
    .order('char_length', { ascending: true })
    .order('text', { ascending: true });

  if (error) {
    throw new Error(`Unable to load words for that pack: ${error.message}`);
  }

  const words = ((data as WordRow[] | null) ?? []).map(mapWordRow);

  if (useCache && words.length > 0) {
    writeCachedPayload(cacheKey, words);
  }

  return words;
}

export async function loadWordPackById(
  packId: string,
  options?: {
    useCache?: boolean;
  },
): Promise<WordPackWithWords | null> {
  const normalizedPackId = packId.trim();
  if (!normalizedPackId) {
    return null;
  }

  const packs = await listWordPacks(options);
  const pack = packs.find((entry) => entry.id === normalizedPackId);

  if (!pack) {
    return null;
  }

  const words = await listWordsByPackId(normalizedPackId, options);

  return {
    ...pack,
    words,
  };
}

export async function loadSelectedWordPack(
  requestedPackId?: string | null,
  options?: {
    useCache?: boolean;
  },
): Promise<WordPackWithWords | null> {
  const packs = await listWordPacks(options);
  const selectedPackId = resolveWordPackId(packs, requestedPackId);

  if (!selectedPackId) {
    return null;
  }

  const selectedPack = packs.find((pack) => pack.id === selectedPackId);
  const words = await listWordsByPackId(selectedPackId, options);

  if (!selectedPack) {
    return null;
  }

  return {
    ...selectedPack,
    words,
  };
}
