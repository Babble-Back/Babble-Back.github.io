import type { WhisperPhraseScoreDetails } from '../../lib/asr/whisperScoring';
import {
  type CampaignPhraseLmPrior,
  type CampaignScoringConfig,
  DEFAULT_CAMPAIGN_SCORING_CONFIG,
  isCampaignPhraseLmPriorUsable,
  normalizeCampaignPhraseLmPrior,
} from './lmPrior';

const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

export interface CampaignCombinedScoreDebug {
  asrTokenCount: number;
  asrTokenIds: number[];
  asrTokenLogProbs: number[];
  asrTokenTexts: string[];
  combinedNumerator: number;
  finalScore: number;
  lmModelName: string | null;
  lmTokenCount: number;
  lmTokenIds: number[];
  lmTokenLogProbs: number[];
  lmTokenTexts: string[];
  lmWeight: number;
  logPAsr: number;
  logPLm: number;
  scoredText: string;
  textLen: number;
  tokenizerDifferenceExample: string;
  usedLmPriors: boolean;
  warnings: string[];
}

export interface CampaignCombinedScoreResult {
  averageLogProb: number;
  debug: CampaignCombinedScoreDebug;
  rawLogLikelihood: number;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function getStringLengthLikePython(text: string) {
  return Array.from(text).length;
}

function buildAsrTokenTexts(whisperScore: WhisperPhraseScoreDetails) {
  return whisperScore.targetStepScores.map((step) => step.tokenText ?? '');
}

function buildTokenizerDifferenceExample(scoredText: string, asrTokenCount: number, lmTokenCount: number) {
  return `Whole-string scoring keeps each tokenizer separate for "${scoredText}". Current token counts are informational only: ASR=${asrTokenCount}, LM=${lmTokenCount}. Example: even if ASR emitted 5 tokens and the LM emitted 4, the score still uses total logP_asr(text) and total logP_lm(text), divided once by len(text).`;
}

function buildWhisperOnlyResult(
  whisperScore: WhisperPhraseScoreDetails,
  scoredText: string,
  config: CampaignScoringConfig,
  warnings: string[],
): CampaignCombinedScoreResult {
  const textLen = getStringLengthLikePython(scoredText);
  const logPAsr = whisperScore.rawLogLikelihood;
  const logPLm = 0;
  const combinedNumerator = logPAsr;
  const finalScore =
    textLen > 0 && Number.isFinite(combinedNumerator)
      ? combinedNumerator / textLen
      : NEGATIVE_INFINITY;
  const asrTokenTexts = buildAsrTokenTexts(whisperScore);

  return {
    averageLogProb: finalScore,
    rawLogLikelihood: combinedNumerator,
    debug: {
      asrTokenCount: whisperScore.targetTokenIds.length,
      asrTokenIds: whisperScore.targetTokenIds,
      asrTokenLogProbs: whisperScore.targetStepScores.map((step) => step.logProb),
      asrTokenTexts,
      combinedNumerator,
      finalScore,
      lmModelName: null,
      lmTokenCount: 0,
      lmTokenIds: [],
      lmTokenLogProbs: [],
      lmTokenTexts: [],
      lmWeight: config.lmWeight,
      logPAsr,
      logPLm,
      scoredText,
      textLen,
      tokenizerDifferenceExample: buildTokenizerDifferenceExample(
        scoredText,
        whisperScore.targetTokenIds.length,
        0,
      ),
      usedLmPriors: false,
      warnings,
    },
  };
}

export function combineCampaignLmScore(
  whisperScore: WhisperPhraseScoreDetails,
  lmPriorInput: CampaignPhraseLmPrior | null | undefined,
  scoredText: string,
  configInput?: Partial<CampaignScoringConfig> | null,
): CampaignCombinedScoreResult {
  const config: CampaignScoringConfig = {
    ...DEFAULT_CAMPAIGN_SCORING_CONFIG,
    ...configInput,
  };
  const warnings: string[] = [];
  const textLen = getStringLengthLikePython(scoredText);

  if (textLen <= 0) {
    warnings.push('The scored text is empty, so the campaign score is undefined.');
    return buildWhisperOnlyResult(whisperScore, scoredText, config, warnings);
  }

  const asrTokenLogProbs = whisperScore.targetStepScores.map((step) => step.logProb);
  const asrTokenTexts = buildAsrTokenTexts(whisperScore);
  const logPAsr = whisperScore.rawLogLikelihood;
  const lmPrior = normalizeCampaignPhraseLmPrior(lmPriorInput);

  if (!Number.isFinite(logPAsr)) {
    warnings.push(
      'ASR did not produce a finite whole-string log probability for this text. Falling back to Whisper-only result handling.',
    );
    return buildWhisperOnlyResult(whisperScore, scoredText, config, warnings);
  }

  if (!isCampaignPhraseLmPriorUsable(lmPrior)) {
    warnings.push(
      'LM priors are missing, malformed, or not ready for this phrase. Using ASR-only whole-string scoring.',
    );
    return buildWhisperOnlyResult(whisperScore, scoredText, config, warnings);
  }

  // Tokenizer lengths are allowed to differ intentionally. We score the same
  // whole string under each model using each model's own tokenizer, then
  // combine the total log-probabilities without any token alignment.
  const logPLm = sum(lmPrior.tokenLogProbs);
  const combinedNumerator = logPAsr - config.lmWeight * logPLm;
  const finalScore = combinedNumerator / textLen;

  return {
    averageLogProb: finalScore,
    rawLogLikelihood: combinedNumerator,
    debug: {
      asrTokenCount: whisperScore.targetTokenIds.length,
      asrTokenIds: whisperScore.targetTokenIds,
      asrTokenLogProbs,
      asrTokenTexts,
      combinedNumerator,
      finalScore,
      lmModelName: lmPrior.modelName,
      lmTokenCount: lmPrior.tokenIds.length,
      lmTokenIds: lmPrior.tokenIds,
      lmTokenLogProbs: lmPrior.tokenLogProbs,
      lmTokenTexts: lmPrior.tokenTexts,
      lmWeight: config.lmWeight,
      logPAsr,
      logPLm,
      scoredText,
      textLen,
      tokenizerDifferenceExample: buildTokenizerDifferenceExample(
        scoredText,
        whisperScore.targetTokenIds.length,
        lmPrior.tokenIds.length,
      ),
      usedLmPriors: true,
      warnings,
    },
  };
}
