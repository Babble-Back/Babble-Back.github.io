import { syllable } from 'syllable';

export type WordDifficulty = 'easy' | 'medium' | 'hard';

export interface ComputedDifficulty {
  difficulty: WordDifficulty;
  syllables: number;
  charLength: number;
  score: number;
}

export function normalizePackText(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function cleanPackTexts(texts: readonly string[]) {
  const cleanedTexts: string[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    const normalizedText = normalizePackText(text);

    if (!normalizedText || seen.has(normalizedText)) {
      continue;
    }

    seen.add(normalizedText);
    cleanedTexts.push(normalizedText);
  }

  return cleanedTexts;
}

export function computeDifficulty(text: string): ComputedDifficulty {
  const normalizedText = normalizePackText(text);
  const syllables = syllable(normalizedText);
  const charLength = normalizedText.length;
  const score = syllables + charLength * 0.15;

  if (score <= 3.5) {
    return { difficulty: 'easy', syllables, charLength, score };
  }

  if (score <= 7) {
    return { difficulty: 'medium', syllables, charLength, score };
  }

  return { difficulty: 'hard', syllables, charLength, score };
}
