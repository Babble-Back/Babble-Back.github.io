import type { WordDifficulty } from '../../utils/difficulty';

const ONE_STAR_THRESHOLD = 0.24;
const TWO_STAR_THRESHOLD = 0.48;
const THREE_STAR_THRESHOLD = 0.72;
const MIN_LOG_PROBABILITY = -12;

export function getCampaignStars(score: number) {
  if (score >= THREE_STAR_THRESHOLD) {
    return 3;
  }

  if (score >= TWO_STAR_THRESHOLD) {
    return 2;
  }

  if (score >= ONE_STAR_THRESHOLD) {
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

export function normalizeCampaignWhisperScore({
  averageLogProb,
  generatedAverageLogProb,
}: {
  averageLogProb: number;
  generatedAverageLogProb: number | null;
}) {
  const phraseConfidence = probabilityFromAverageLogProb(averageLogProb);

  if (!(phraseConfidence > 0)) {
    return 0;
  }

  const greedyConfidence = probabilityFromAverageLogProb(generatedAverageLogProb);
  const relativeConfidence =
    greedyConfidence > 0
      ? clampScore(phraseConfidence / greedyConfidence)
      : phraseConfidence;

  return clampScore(phraseConfidence * 0.4 + relativeConfidence * 0.6);
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
