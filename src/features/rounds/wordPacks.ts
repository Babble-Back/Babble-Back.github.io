import {
  filterWordsByMaxUnlockedDifficulty,
  listWordPacksWithAccess,
  loadWordPackById,
  resolveWordPackId,
  type WordDifficulty,
  type WordCountsByDifficulty,
  type WordEntry,
  type WordPack,
  type WordPackWithWords,
} from '../../lib/wordPacks';
import { computeDifficulty, normalizePackText } from '../../utils/difficulty';

const LAST_PRESENTED_PHRASE_KEY = 'word_packs_last_presented_phrase';
const DIFFICULTY_ORDER: WordDifficulty[] = ['easy', 'medium', 'hard'];
const FALLBACK_CREATED_AT = '1970-01-01T00:00:00.000Z';
const FALLBACK_PACK_ID = 'fallback-pack';

export interface WordOption extends WordEntry {
  displayDifficulty: WordDifficulty;
}

export interface RoundSelectableWordPack extends WordPackWithWords {
  accessibleWords: WordEntry[];
  totalWordCounts: WordCountsByDifficulty;
  accessibleWordCounts: WordCountsByDifficulty;
}

export interface RoundWordPackLoadResult {
  packs: WordPack[];
  selectedPack: RoundSelectableWordPack;
  selectedPackId: string;
  source: 'remote' | 'fallback';
  error: string | null;
}

const FALLBACK_WORD_PACK: WordPackWithWords = {
  id: FALLBACK_PACK_ID,
  name: 'Offline Starter Pack',
  description: 'Small built-in fallback pack used when remote packs are unavailable.',
  isFree: true,
  isUnlocked: true,
  createdAt: FALLBACK_CREATED_AT,
  words: [
    'blue cup',
    'small bell',
    'soft drum',
    'quiet hallway',
    'paper airplane',
    'silver lantern',
    'midnight bicycle',
    'electric calendar',
    'whispering volcano',
    'backward meteor shower',
  ].map((text, index) => buildFallbackWord(text, index)),
};

function buildFallbackWord(text: string, index: number): WordEntry {
  const normalizedText = normalizePackText(text);
  const metrics = computeDifficulty(normalizedText);

  return {
    id: `fallback-word-${index}`,
    packId: FALLBACK_PACK_ID,
    text: normalizedText,
    syllables: metrics.syllables,
    charLength: metrics.charLength,
    difficulty: metrics.difficulty,
    createdAt: FALLBACK_CREATED_AT,
  };
}

function getFallbackPackSummary(): WordPack {
  return {
    id: FALLBACK_WORD_PACK.id,
    name: FALLBACK_WORD_PACK.name,
    description: FALLBACK_WORD_PACK.description,
    isFree: FALLBACK_WORD_PACK.isFree,
    isUnlocked: true,
    createdAt: FALLBACK_WORD_PACK.createdAt,
  };
}

function isPackUsableByDefault(pack: WordPack) {
  return pack.isFree || pack.isUnlocked !== false;
}

function getAccessibleWordsForPack(pack: WordPack, words: WordEntry[]) {
  return pack.isFree
    ? words
    : filterWordsByMaxUnlockedDifficulty(words, pack.maxUnlockedDifficulty);
}

function getDifficultyBuckets(words: WordEntry[]) {
  return words.reduce<Record<WordDifficulty, WordEntry[]>>(
    (buckets, word) => {
      buckets[word.difficulty].push(word);
      return buckets;
    },
    { easy: [], medium: [], hard: [] },
  );
}

function dedupeWords(words: WordEntry[]) {
  const dedupedWords: WordEntry[] = [];
  const seenTexts = new Set<string>();

  for (const word of words) {
    const normalizedText = normalizePackText(word.text);

    if (!normalizedText || seenTexts.has(normalizedText)) {
      continue;
    }

    const metrics = computeDifficulty(normalizedText);

    seenTexts.add(normalizedText);
    dedupedWords.push({
      ...word,
      text: normalizedText,
      syllables: Number.isFinite(word.syllables) ? word.syllables : metrics.syllables,
      charLength: Number.isFinite(word.charLength) ? word.charLength : metrics.charLength,
      difficulty: word.difficulty ?? metrics.difficulty,
    });
  }

  return dedupedWords;
}

function normalizeWordPack(pack: WordPackWithWords): WordPackWithWords {
  return {
    ...pack,
    name: pack.name.trim(),
    description: pack.description?.trim() ?? null,
    words: dedupeWords(pack.words),
  };
}

function buildRoundSelectablePack(
  pack: WordPackWithWords,
  accessibleWords: WordEntry[],
): RoundSelectableWordPack {
  const normalizedPack = normalizeWordPack(pack);
  const normalizedAccessibleWords = dedupeWords(accessibleWords);

  return {
    ...normalizedPack,
    accessibleWords: normalizedAccessibleWords,
    totalWordCounts: countWordsByDifficulty(normalizedPack.words),
    accessibleWordCounts: countWordsByDifficulty(normalizedAccessibleWords),
  };
}

function randomItem<T>(items: T[]) {
  if (!items.length) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function pickWordForDifficulty(
  targetDifficulty: WordDifficulty,
  buckets: Record<WordDifficulty, WordEntry[]>,
  usedTexts: Set<string>,
  blockedText: string | null,
) {
  const bucket = buckets[targetDifficulty].filter(
    (word) => !usedTexts.has(word.text) && word.text !== blockedText,
  );

  if (bucket.length > 0) {
    return randomItem(bucket);
  }

  const relaxedBucket = buckets[targetDifficulty].filter((word) => !usedTexts.has(word.text));
  return randomItem(relaxedBucket);
}

function hasLocalStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readLastPresentedPhrase() {
  if (!hasLocalStorage()) {
    return null;
  }

  const phrase = window.localStorage.getItem(LAST_PRESENTED_PHRASE_KEY);
  return phrase ? normalizePackText(phrase) : null;
}

export function rememberPresentedPhrase(phrase: string) {
  if (!hasLocalStorage()) {
    return;
  }

  window.localStorage.setItem(
    LAST_PRESENTED_PHRASE_KEY,
    normalizePackText(phrase),
  );
}

export function getDefaultPackId(packs: WordPack[]) {
  return (
    packs.find(isPackUsableByDefault)?.id ??
    packs[0]?.id ??
    FALLBACK_WORD_PACK.id
  );
}

function countWordsByDifficulty(words: WordEntry[]): WordCountsByDifficulty {
  return words.reduce<WordCountsByDifficulty>(
    (counts, word) => {
      counts[word.difficulty] += 1;
      return counts;
    },
    { easy: 0, medium: 0, hard: 0 },
  );
}

export function getWordPackOptions(packs: WordPack[]) {
  return packs.map((pack) => ({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    isFree: pack.isFree,
    isUnlocked: pack.isUnlocked !== false,
    maxUnlockedDifficulty: pack.maxUnlockedDifficulty ?? null,
    unlockTier: pack.unlockTier ?? null,
  }));
}

export async function loadRoundWordPacks(
  requestedPackId?: string | null,
): Promise<RoundWordPackLoadResult> {
  try {
    const packs = await listWordPacksWithAccess();

    if (!packs.length) {
      throw new Error('No word packs are available yet.');
    }

    const normalizedRequestedPackId = requestedPackId?.trim() ?? '';
    const requestedPack = normalizedRequestedPackId
      ? packs.find((pack) => pack.id === normalizedRequestedPackId) ?? null
      : null;
    const defaultPackId = resolveWordPackId(packs, null, {
      isPackSelectable: isPackUsableByDefault,
    });
    const candidatePackIds = [
      ...(requestedPack ? [requestedPack.id] : []),
      ...(defaultPackId ? [defaultPackId] : []),
      ...packs.map((pack) => pack.id),
    ].filter((packId, index, allPackIds) => allPackIds.indexOf(packId) === index);

    let firstSelectedPackWithWords: {
      pack: RoundSelectableWordPack;
      packId: string;
    } | null = null;

    for (const candidatePackId of candidatePackIds) {
      const selectedPackBase = packs.find((pack) => pack.id === candidatePackId);
      const selectedPack = await loadWordPackById(candidatePackId);

      if (!selectedPack || !selectedPackBase) {
        continue;
      }

      const normalizedPack = normalizeWordPack({
        ...selectedPack,
        isUnlocked: selectedPackBase.isUnlocked !== false,
        maxUnlockedDifficulty: selectedPackBase.maxUnlockedDifficulty ?? null,
      });
      const roundSelectablePack = buildRoundSelectablePack(
        normalizedPack,
        getAccessibleWordsForPack(selectedPackBase, normalizedPack.words),
      );

      if (requestedPack && selectedPackBase.id === requestedPack.id) {
        return {
          packs,
          selectedPack: roundSelectablePack,
          selectedPackId: selectedPackBase.id,
          source: 'remote',
          error:
            roundSelectablePack.accessibleWords.length === 0 &&
            selectedPackBase.isUnlocked !== false
              ? 'The selected pack has no usable words.'
              : null,
        };
      }

      if (!firstSelectedPackWithWords && roundSelectablePack.accessibleWords.length > 0) {
        firstSelectedPackWithWords = {
          pack: roundSelectablePack,
          packId: selectedPackBase.id,
        };
      }
    }

    if (!firstSelectedPackWithWords) {
      throw new Error('No word pack could be selected.');
    }

    return {
      packs,
      selectedPack: firstSelectedPackWithWords.pack,
      selectedPackId: firstSelectedPackWithWords.packId,
      source: 'remote',
      error: null,
    };
  } catch (error) {
    return {
      packs: [getFallbackPackSummary()],
      selectedPack: buildRoundSelectablePack(FALLBACK_WORD_PACK, FALLBACK_WORD_PACK.words),
      selectedPackId: FALLBACK_WORD_PACK.id,
      source: 'fallback',
      error:
        error instanceof Error
          ? `Unable to load the selected pack. Using the offline starter pack instead. ${error.message}`
          : 'Unable to load word packs. Using the offline starter pack instead.',
    };
  }
}

export function getThreeOptions(
  words: WordEntry[],
  previousPhrase?: string | null,
) {
  const blockedText =
    previousPhrase === undefined
      ? readLastPresentedPhrase()
      : previousPhrase
        ? normalizePackText(previousPhrase)
        : null;
  const candidateWords = dedupeWords(words);

  if (!candidateWords.length) {
    return [] as WordOption[];
  }

  const buckets = getDifficultyBuckets(candidateWords);
  const usedTexts = new Set<string>();

  return DIFFICULTY_ORDER.flatMap((difficulty) => {
    const pickedWord = pickWordForDifficulty(difficulty, buckets, usedTexts, blockedText);

    if (!pickedWord) {
      return [];
    }

    usedTexts.add(pickedWord.text);

    return [
      {
        ...pickedWord,
        displayDifficulty: difficulty,
      } satisfies WordOption,
    ];
  });
}
