import type {
  WhisperPhraseScoreDetails,
  WhisperStepScore,
} from '../../lib/asr/whisperScoring';
import {
  type CampaignPhraseLmPrior,
  type CampaignScoringConfig,
  DEFAULT_CAMPAIGN_SCORING_CONFIG,
  isCampaignPhraseLmPriorUsable,
  normalizeCampaignPhraseLmPrior,
} from './lmPrior';

export interface CampaignAlignedTokenScore {
  asrLogProbability: number;
  asrProbability: number;
  combinedLogLikelihoodRatio: number;
  index: number;
  lmIndex: number | null;
  lmLogProbability: number;
  lmMatched: boolean;
  lmProbability: number;
  lmTokenId: number | null;
  lmTokenText: string;
  whisperIndex: number;
  whisperTokenId: number;
  whisperTokenText: string;
}

export interface CampaignCombinedScoreDebug {
  alignedTokenCount: number;
  alignmentMode: 'exact' | 'offset_trim' | 'min_length_fallback' | 'whisper_only';
  alignedTokens: CampaignAlignedTokenScore[];
  asrProbabilities: number[];
  combinedRawScore: number;
  firstTokenAddAmount: number;
  lmModelName: string | null;
  lmProbabilities: number[];
  lmTokenIds: number[];
  lmTokenTexts: string[];
  lmWeight: number;
  perTokenCombinedLogLikelihoodRatio: number[];
  usedLmPriors: boolean;
  warnings: string[];
  whisperTokenIds: number[];
  whisperTokenTexts: string[];
}

export interface CampaignCombinedScoreResult {
  averageLogProb: number;
  debug: CampaignCombinedScoreDebug;
  rawLogLikelihood: number;
}

interface AlignmentSpan {
  lmStart: number;
  matchedCount: number;
  mode: 'exact' | 'offset_trim';
  whisperStart: number;
}

function clampProbability(value: number, epsilon: number) {
  if (!Number.isFinite(value)) {
    return epsilon;
  }

  return Math.max(epsilon, Math.min(1, value));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function stepTokenText(step: WhisperStepScore) {
  return step.tokenText ?? '';
}

function buildWhisperTokenTexts(whisperScore: WhisperPhraseScoreDetails) {
  return whisperScore.targetTokenIds.map((tokenId, index) => {
    const step = whisperScore.targetStepScores[index];
    return step ? stepTokenText(step) : '';
  });
}

function tokenMatches(
  whisperScore: WhisperStepScore | undefined,
  whisperTokenId: number,
  whisperTokenText: string,
  lmTokenId: number,
  lmTokenText: string,
) {
  if (whisperScore && whisperScore.tokenId === lmTokenId) {
    return true;
  }

  if (whisperTokenId === lmTokenId) {
    return true;
  }

  return whisperTokenText === lmTokenText;
}

function findAlignmentSpan(
  whisperScore: WhisperPhraseScoreDetails,
  whisperTokenTexts: string[],
  lmPrior: CampaignPhraseLmPrior,
): AlignmentSpan | null {
  const whisperLength = whisperScore.targetTokenIds.length;
  const lmLength = lmPrior.tokenIds.length;
  let bestMatch: AlignmentSpan | null = null;

  for (let whisperStart = 0; whisperStart < whisperLength; whisperStart += 1) {
    for (let lmStart = 0; lmStart < lmLength; lmStart += 1) {
      const maxLength = Math.min(whisperLength - whisperStart, lmLength - lmStart);
      let matchedCount = 0;

      for (let offset = 0; offset < maxLength; offset += 1) {
        const whisperIndex = whisperStart + offset;
        const lmIndex = lmStart + offset;
        const whisperStep = whisperScore.targetStepScores[whisperIndex];

        if (
          !tokenMatches(
            whisperStep,
            whisperScore.targetTokenIds[whisperIndex] ?? -1,
            whisperTokenTexts[whisperIndex] ?? '',
            lmPrior.tokenIds[lmIndex] ?? -1,
            lmPrior.tokenTexts[lmIndex] ?? '',
          )
        ) {
          break;
        }

        matchedCount += 1;
      }

      if (matchedCount <= 0) {
        continue;
      }

      const mode =
        whisperStart === 0 && lmStart === 0 && matchedCount === Math.min(whisperLength, lmLength)
          ? 'exact'
          : 'offset_trim';
      const nextMatch: AlignmentSpan = {
        whisperStart,
        lmStart,
        matchedCount,
        mode,
      };

      if (
        !bestMatch ||
        nextMatch.matchedCount > bestMatch.matchedCount ||
        (nextMatch.matchedCount === bestMatch.matchedCount &&
          nextMatch.whisperStart + nextMatch.lmStart < bestMatch.whisperStart + bestMatch.lmStart)
      ) {
        bestMatch = nextMatch;
      }
    }
  }

  return bestMatch;
}

function combineWhisperOnly(
  whisperScore: WhisperPhraseScoreDetails,
  config: CampaignScoringConfig,
  warnings: string[],
): CampaignCombinedScoreResult {
  const whisperTokenTexts = buildWhisperTokenTexts(whisperScore);
  const asrProbabilities = whisperScore.targetStepScores.map((step) => step.probability);
  const combinedRatios = whisperScore.targetStepScores.map((step, index) => {
    const baseLogProb = Math.log(clampProbability(step.probability, config.probabilityEpsilon));
    return index === 0 ? baseLogProb + config.firstTokenAddAmount : baseLogProb;
  });

  return {
    averageLogProb: whisperScore.averageLogProb,
    rawLogLikelihood: whisperScore.rawLogLikelihood,
    debug: {
      alignedTokenCount: whisperScore.targetStepScores.length,
      alignmentMode: 'whisper_only',
      alignedTokens: whisperScore.targetStepScores.map((step, index) => ({
        asrLogProbability: combinedRatios[index] ?? Math.log(config.probabilityEpsilon),
        asrProbability: asrProbabilities[index] ?? 0,
        combinedLogLikelihoodRatio:
          combinedRatios[index] ?? Math.log(config.probabilityEpsilon),
        index,
        lmIndex: null,
        lmLogProbability: 0,
        lmMatched: false,
        lmProbability: 1,
        lmTokenId: null,
        lmTokenText: '',
        whisperIndex: index,
        whisperTokenId: step.tokenId,
        whisperTokenText: step.tokenText,
      })),
      asrProbabilities,
      combinedRawScore: whisperScore.averageLogProb,
      firstTokenAddAmount: config.firstTokenAddAmount,
      lmModelName: null,
      lmProbabilities: [],
      lmTokenIds: [],
      lmTokenTexts: [],
      lmWeight: config.lmWeight,
      perTokenCombinedLogLikelihoodRatio: combinedRatios,
      usedLmPriors: false,
      warnings,
      whisperTokenIds: whisperScore.targetTokenIds,
      whisperTokenTexts,
    },
  };
}

export function combineCampaignLmScore(
  whisperScore: WhisperPhraseScoreDetails,
  lmPriorInput: CampaignPhraseLmPrior | null | undefined,
  configInput?: Partial<CampaignScoringConfig> | null,
): CampaignCombinedScoreResult {
  const config: CampaignScoringConfig = {
    ...DEFAULT_CAMPAIGN_SCORING_CONFIG,
    ...configInput,
  };
  const warnings: string[] = [];
  const whisperTokenTexts = buildWhisperTokenTexts(whisperScore);

  if (
    !whisperScore.targetStepScores.length ||
    whisperScore.targetStepScores.length !== whisperScore.targetTokenIds.length
  ) {
    warnings.push(
      'Whisper token probabilities are incomplete for this phrase. Falling back to Whisper-only scoring.',
    );
    return combineWhisperOnly(whisperScore, config, warnings);
  }

  const lmPrior = normalizeCampaignPhraseLmPrior(lmPriorInput);

  if (!isCampaignPhraseLmPriorUsable(lmPrior)) {
    warnings.push(
      'LM priors are missing, malformed, or not ready for this phrase. Falling back to Whisper-only scoring.',
    );
    return combineWhisperOnly(whisperScore, config, warnings);
  }

  const alignmentSpan = findAlignmentSpan(whisperScore, whisperTokenTexts, lmPrior);
  const whisperLength = whisperScore.targetStepScores.length;
  const defaultWhisperStart = 0;
  const defaultLmStart = 0;
  const whisperStart = alignmentSpan?.whisperStart ?? defaultWhisperStart;
  const lmStart = alignmentSpan?.lmStart ?? defaultLmStart;
  const matchedCount = alignmentSpan?.matchedCount ?? 0;
  const alignedWhisperLength = whisperLength - whisperStart;
  const availableLmLength = Math.max(0, lmPrior.tokenIds.length - lmStart);
  const fallbackLength = Math.min(alignedWhisperLength, availableLmLength);
  const alignedLength = matchedCount > 0 ? matchedCount : fallbackLength;
  const alignmentMode = alignmentSpan?.mode ?? 'min_length_fallback';
  const shouldNeutralPadLm =
    alignedWhisperLength > alignedLength && alignedLength >= availableLmLength;
  const scoredLength = shouldNeutralPadLm ? alignedWhisperLength : alignedLength;

  if (!alignmentSpan) {
    warnings.push(
      'Unable to find an exact Whisper/GPT-2 token alignment. Falling back to positional min-length alignment.',
    );
  }

  if (scoredLength <= 0) {
    warnings.push('Aligned token count is zero. Falling back to Whisper-only scoring.');
    return combineWhisperOnly(whisperScore, config, warnings);
  }

  if (whisperStart > 0 || lmStart > 0) {
    warnings.push(
      `Trimmed alignment to Whisper offset ${whisperStart} and LM offset ${lmStart} to skip non-matching prefix tokens.`,
    );
  }

  const alignedTokenScores: CampaignAlignedTokenScore[] = [];
  const asrProbabilities: number[] = [];
  const lmProbabilities: number[] = [];
  const combinedRatios: number[] = [];

  for (let index = 0; index < scoredLength; index += 1) {
    const whisperIndex = whisperStart + index;
    const lmIndex = lmStart + index;
    const whisperStep = whisperScore.targetStepScores[whisperIndex];
    const hasLmToken = index < alignedLength;
    const whisperProbability = clampProbability(
      whisperStep?.probability ?? 0,
      config.probabilityEpsilon,
    );
    const lmProbability = clampProbability(
      hasLmToken ? (lmPrior.tokenProbs[lmIndex] ?? 1) : 1,
      config.probabilityEpsilon,
    );
    const whisperLogProbability = Math.log(whisperProbability);
    const adjustedWhisperLogProbability =
      index === 0
        ? whisperLogProbability + config.firstTokenAddAmount
        : whisperLogProbability;
    const lmLogProbability = hasLmToken
      ? Number.isFinite(lmPrior.tokenLogProbs[lmIndex] ?? NaN)
        ? (lmPrior.tokenLogProbs[lmIndex] as number)
        : Math.log(lmProbability)
      : 0;
    const combinedLogLikelihoodRatio =
      adjustedWhisperLogProbability - config.lmWeight * lmLogProbability;

    asrProbabilities.push(whisperProbability);
    lmProbabilities.push(lmProbability);
    combinedRatios.push(combinedLogLikelihoodRatio);
    alignedTokenScores.push({
      asrLogProbability: adjustedWhisperLogProbability,
      asrProbability: whisperProbability,
      combinedLogLikelihoodRatio,
      index,
      lmIndex: hasLmToken ? lmIndex : null,
      lmLogProbability,
      lmMatched: tokenMatches(
        whisperStep,
        whisperScore.targetTokenIds[whisperIndex] ?? -1,
        whisperTokenTexts[whisperIndex] ?? '',
        hasLmToken ? (lmPrior.tokenIds[lmIndex] ?? -1) : -1,
        hasLmToken ? (lmPrior.tokenTexts[lmIndex] ?? '') : '',
      ),
      lmProbability,
      lmTokenId: hasLmToken ? (lmPrior.tokenIds[lmIndex] ?? null) : null,
      lmTokenText: hasLmToken ? (lmPrior.tokenTexts[lmIndex] ?? '') : '',
      whisperIndex,
      whisperTokenId: whisperScore.targetTokenIds[whisperIndex] ?? -1,
      whisperTokenText: whisperTokenTexts[whisperIndex] ?? '',
    });
  }

  if (shouldNeutralPadLm) {
    warnings.push(
      `LM priors ended ${alignedWhisperLength - alignedLength} token(s) early, so the remaining Whisper tokens were padded with neutral LM probability 1.0.`,
    );
  } else if (alignedWhisperLength > alignedLength) {
    warnings.push(
      `Whisper produced ${alignedWhisperLength - alignedLength} extra text tokens beyond the aligned span.`,
    );
  }

  if (availableLmLength > alignedLength) {
    warnings.push(
      `LM priors contain ${availableLmLength - alignedLength} extra tokens beyond the aligned span.`,
    );
  }

  const rawLogLikelihood = sum(combinedRatios);
  const averageLogProb = rawLogLikelihood / scoredLength;

  return {
    averageLogProb,
    rawLogLikelihood,
    debug: {
      alignedTokenCount: scoredLength,
      alignmentMode,
      alignedTokens: alignedTokenScores,
      asrProbabilities,
      combinedRawScore: averageLogProb,
      firstTokenAddAmount: config.firstTokenAddAmount,
      lmModelName: lmPrior.modelName,
      lmProbabilities,
      lmTokenIds: lmPrior.tokenIds,
      lmTokenTexts: lmPrior.tokenTexts,
      lmWeight: config.lmWeight,
      perTokenCombinedLogLikelihoodRatio: combinedRatios,
      usedLmPriors: true,
      warnings,
      whisperTokenIds: whisperScore.targetTokenIds,
      whisperTokenTexts,
    },
  };
}
