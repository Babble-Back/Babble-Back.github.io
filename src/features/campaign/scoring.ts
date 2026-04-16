import type { WordDifficulty } from '../../utils/difficulty';

const ONE_STAR_MIN_SCORE = -2;
const TWO_STAR_MIN_SCORE = -1.66;
const THREE_STAR_MIN_SCORE = -1.3;
const MIN_LOG_PROBABILITY = -12;

export function getCampaignStars(score: number) {
  if (score >= THREE_STAR_MIN_SCORE) {
    return 3;
  }

  if (score >= TWO_STAR_MIN_SCORE) {
    return 2;
  }

  if (score >= ONE_STAR_MIN_SCORE) {
    return 1;
  }

  return 0;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(1, score));
}

function probabilityFromAverageLogProb(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.exp(Math.max(MIN_LOG_PROBABILITY, Math.min(0, value)));
}

export function normalizeCampaignLogScore(averageLogProb: number) {
  return clampScore(probabilityFromAverageLogProb(averageLogProb));
}

export function normalizeCampaignWhisperScore(averageLogProb: number) {
  return normalizeCampaignLogScore(averageLogProb);
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
