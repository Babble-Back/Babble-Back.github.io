import type { WordDifficulty } from '../../utils/difficulty';

export function getCampaignStars(score: number) {
  if (score >= 0.9) {
    return 3;
  }

  if (score >= 0.75) {
    return 2;
  }

  if (score >= 0.6) {
    return 1;
  }

  return 0;
}

export function formatDifficultyLabel(difficulty: WordDifficulty) {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

export function buildBackwardPhraseExample(phrase: string) {
  return phrase
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map((word) => word.split('').reverse().join(''))
    .join(' ');
}
