import { reverseAudioBlob } from '../../audio/utils/reverseAudioBlob';
import { preprocessAudioBlob } from '../../lib/asr/preprocess';
import {
  scoreWhisperPhraseAudio,
  type WhisperStepScore,
  warmWhisperScorer,
} from '../../lib/asr/whisperScoring';
import {
  getCampaignStars,
  normalizeCampaignLogScore,
} from './scoring';
import {
  type CampaignPhraseLmPrior,
  type CampaignScoringConfig,
  toCampaignPhraseScoringText,
} from './lmPrior';
import { combineCampaignLmScore } from './lmScoring';

const DEV_MODE = import.meta.env.DEV;
const SCORE_DEBUG_QUERY_KEY = 'campaignWhisperDebug';
const SCORE_DEBUG_STORAGE_KEY = 'campaign-whisper-debug';

function shouldLogCampaignWhisperScores() {
  if (DEV_MODE) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const queryOverride = searchParams.get(SCORE_DEBUG_QUERY_KEY);

  if (queryOverride === '1' || queryOverride === 'true') {
    return true;
  }

  try {
    const storageOverride = window.localStorage.getItem(SCORE_DEBUG_STORAGE_KEY);
    return storageOverride === '1' || storageOverride === 'true';
  } catch {
    return false;
  }
}

export interface CampaignAttemptScoreDebug {
  asrTokenCount: number;
  asrTokenIds: number[];
  asrTokenLogProbs: number[];
  asrTokenTexts: string[];
  averageLogProb: number;
  combinedNumerator: number;
  finalScore: number;
  lmModelName: string | null;
  lmWeight: number;
  lmTokenCount: number;
  lmTokenIds: number[];
  lmTokenLogProbs: number[];
  lmTokenTexts: string[];
  logPAsr: number;
  logPLm: number;
  normalizedCampaignScore: number;
  scoredText: string;
  scoreCalculation: string;
  scoreFormula: string;
  sampleLabel: string;
  textLen: number;
  tokenizerDifferenceExample: string;
  rawCombinedLogLikelihood: number;
  rawWhisperLogLikelihood: number;
  stars: number;
  targetPhrase: string;
  targetStepScores: WhisperStepScore[];
  totalDecodeSteps: number;
  usedLmPriors: boolean;
  warnings: string[];
}

export interface CampaignAttemptScoreResult {
  debug: CampaignAttemptScoreDebug | null;
  reversedAttemptBlob: Blob | null;
  score: number;
  stars: number;
}

function zeroScoreResult(
  targetPhrase: string,
  reversedAttemptBlob: Blob | null,
  sampleLabel: string,
): CampaignAttemptScoreResult {
  return {
    debug: shouldLogCampaignWhisperScores()
      ? {
          asrTokenCount: 0,
          asrTokenIds: [],
          asrTokenLogProbs: [],
          asrTokenTexts: [],
          averageLogProb: Number.NEGATIVE_INFINITY,
          combinedNumerator: Number.NEGATIVE_INFINITY,
          finalScore: Number.NEGATIVE_INFINITY,
          lmModelName: null,
          lmWeight: 0,
          lmTokenCount: 0,
          lmTokenIds: [],
          lmTokenLogProbs: [],
          lmTokenTexts: [],
          logPAsr: Number.NEGATIVE_INFINITY,
          logPLm: 0,
          normalizedCampaignScore: 0,
          scoredText: toCampaignPhraseScoringText(targetPhrase),
          scoreCalculation: 'score = (logP_asr - lm_weight * logP_lm) / len(text)',
          scoreFormula:
            'score(text) = (logP_asr(text) - lm_weight * logP_lm(text)) / len(text)',
          sampleLabel,
          textLen: Array.from(toCampaignPhraseScoringText(targetPhrase)).length,
          tokenizerDifferenceExample:
            'Tokenizer alignment is intentionally disabled; whole-string log-probabilities are combined directly.',
          rawCombinedLogLikelihood: Number.NEGATIVE_INFINITY,
          rawWhisperLogLikelihood: Number.NEGATIVE_INFINITY,
          stars: 0,
          targetPhrase,
          targetStepScores: [],
          totalDecodeSteps: 0,
          usedLmPriors: false,
          warnings: [],
        }
      : null,
    reversedAttemptBlob,
    score: 0,
    stars: 0,
  };
}

export async function warmCampaignAttemptScorer() {
  await warmWhisperScorer();
}

export async function scoreCampaignAttempt({
  attemptBlob,
  debugLabel,
  lmPrior,
  reverseBeforeScoring = true,
  scoringConfig,
  targetPhrase,
}: {
  attemptBlob: Blob;
  debugLabel?: string;
  lmPrior?: CampaignPhraseLmPrior | null;
  reverseBeforeScoring?: boolean;
  scoringConfig?: Partial<CampaignScoringConfig> | null;
  targetPhrase: string;
}): Promise<CampaignAttemptScoreResult> {
  const sampleLabel = debugLabel?.trim() || 'Attempt sample';
  let reversedAttemptBlob: Blob | null = null;

  try {
    const scoredText = toCampaignPhraseScoringText(targetPhrase);
    reversedAttemptBlob = reverseBeforeScoring
      ? await reverseAudioBlob(attemptBlob)
      : attemptBlob;
    const processedAttemptAudio = await preprocessAudioBlob(reversedAttemptBlob);
    const whisperScore = await scoreWhisperPhraseAudio(processedAttemptAudio, targetPhrase);
    const combinedScore = combineCampaignLmScore(whisperScore, lmPrior, scoredText, scoringConfig);
    const normalizedCampaignScore = normalizeCampaignLogScore(combinedScore.averageLogProb);
    const stars = getCampaignStars(combinedScore.debug.finalScore);
    const shouldLogDebug = shouldLogCampaignWhisperScores();
    const debug = shouldLogDebug
      ? {
          asrTokenCount: combinedScore.debug.asrTokenCount,
          asrTokenIds: combinedScore.debug.asrTokenIds,
          asrTokenLogProbs: combinedScore.debug.asrTokenLogProbs,
          asrTokenTexts: combinedScore.debug.asrTokenTexts,
          averageLogProb: combinedScore.averageLogProb,
          combinedNumerator: combinedScore.debug.combinedNumerator,
          finalScore: combinedScore.debug.finalScore,
          lmModelName: combinedScore.debug.lmModelName,
          lmWeight: combinedScore.debug.lmWeight,
          lmTokenCount: combinedScore.debug.lmTokenCount,
          lmTokenIds: combinedScore.debug.lmTokenIds,
          lmTokenLogProbs: combinedScore.debug.lmTokenLogProbs,
          lmTokenTexts: combinedScore.debug.lmTokenTexts,
          logPAsr: combinedScore.debug.logPAsr,
          logPLm: combinedScore.debug.logPLm,
          normalizedCampaignScore,
          scoredText: combinedScore.debug.scoredText,
          scoreCalculation: `score = (${combinedScore.debug.logPAsr.toFixed(6)} - (${combinedScore.debug.lmWeight.toFixed(6)} * ${combinedScore.debug.logPLm.toFixed(6)})) / ${combinedScore.debug.textLen} = ${combinedScore.averageLogProb.toFixed(6)}`,
          scoreFormula:
            'score(text) = (logP_asr(text) - lm_weight * logP_lm(text)) / len(text)',
          sampleLabel,
          textLen: combinedScore.debug.textLen,
          tokenizerDifferenceExample: combinedScore.debug.tokenizerDifferenceExample,
          rawCombinedLogLikelihood: combinedScore.rawLogLikelihood,
          rawWhisperLogLikelihood: whisperScore.rawLogLikelihood,
          stars,
          targetPhrase,
          targetStepScores: whisperScore.targetStepScores,
          totalDecodeSteps: whisperScore.decodeSteps,
          usedLmPriors: combinedScore.debug.usedLmPriors,
          warnings: combinedScore.debug.warnings,
        }
      : null;

    if (debug) {
      console.groupCollapsed(`[CampaignWhisperScore][${sampleLabel}]`);
      console.info('[CampaignWhisperScore][Summary]', debug);
      console.info('[CampaignWhisperScore][Formula]', debug.scoreFormula);
      console.info('[CampaignWhisperScore][Calculation]', debug.scoreCalculation);
      console.info('[CampaignWhisperScore][TokenizerDifference]', debug.tokenizerDifferenceExample);
      console.table(
        debug.asrTokenIds.map((tokenId, index) => {
          const stepScore = whisperScore.targetStepScores[index];

          return {
            step: index,
            tokenId,
            tokenText: debug.asrTokenTexts[index] ?? '',
            logProbability: debug.asrTokenLogProbs[index] ?? Number.NEGATIVE_INFINITY,
            topCandidates: stepScore
              ? stepScore.topCandidates
                  .map(
                    (candidate) =>
                      `${candidate.tokenId}:${candidate.tokenText} (${candidate.logProb.toFixed(3)})`,
                  )
                  .join(' | ')
              : '',
          };
        }),
      );
      console.table(
        debug.lmTokenIds.map((tokenId, index) => ({
          step: index,
          tokenId,
          tokenText: debug.lmTokenTexts[index] ?? '',
          logProbability: debug.lmTokenLogProbs[index] ?? Number.NEGATIVE_INFINITY,
        })),
      );
      console.groupEnd();
    }

    return {
      debug,
      reversedAttemptBlob,
      score: normalizedCampaignScore,
      stars,
    };
  } catch (error) {
    console.warn(`[CampaignAttemptScoring][${sampleLabel}]`, error);
    return zeroScoreResult(targetPhrase, reversedAttemptBlob, sampleLabel);
  }
}
