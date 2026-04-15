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
  alignedTokenCount: number;
  alignmentMode: string;
  asrLogProbabilities: number[];
  averageLogProb: number;
  asrProbabilities: number[];
  combinedRawScore: number;
  finalScore: number;
  firstTokenAddAmount: number;
  lmLogProbabilities: number[];
  lmModelName: string | null;
  lmProbabilities: number[];
  lmTokenIds: number[];
  lmTokenTexts: string[];
  lmWeight: number;
  normalizedCampaignScore: number;
  perTokenCombinedLogLikelihoodRatio: number[];
  scoreCalculation: string;
  scoreFormula: string;
  rawCombinedLogLikelihood: number;
  rawWhisperLogLikelihood: number;
  stars: number;
  targetPhrase: string;
  targetStepScores: WhisperStepScore[];
  totalDecodeSteps: number;
  usedLmPriors: boolean;
  warnings: string[];
  whisperTokenIds: number[];
  whisperTokenTexts: string[];
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
): CampaignAttemptScoreResult {
  return {
    debug: shouldLogCampaignWhisperScores()
      ? {
          alignedTokenCount: 0,
          alignmentMode: 'whisper_only',
          asrLogProbabilities: [],
          averageLogProb: Number.NEGATIVE_INFINITY,
          asrProbabilities: [],
          combinedRawScore: Number.NEGATIVE_INFINITY,
          finalScore: 0,
          firstTokenAddAmount: 0,
          lmLogProbabilities: [],
          lmModelName: null,
          lmProbabilities: [],
          lmTokenIds: [],
          lmTokenTexts: [],
          lmWeight: 0,
          normalizedCampaignScore: 0,
          perTokenCombinedLogLikelihoodRatio: [],
          scoreCalculation: 'score = 0',
          scoreFormula:
            'score = mean(log(p_asr(token_i)) - lm_weight * log(p_lm(token_i)))',
          rawCombinedLogLikelihood: Number.NEGATIVE_INFINITY,
          rawWhisperLogLikelihood: Number.NEGATIVE_INFINITY,
          stars: 0,
          targetPhrase,
          targetStepScores: [],
          totalDecodeSteps: 0,
          usedLmPriors: false,
          warnings: [],
          whisperTokenIds: [],
          whisperTokenTexts: [],
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
  lmPrior,
  scoringConfig,
  targetPhrase,
}: {
  attemptBlob: Blob;
  lmPrior?: CampaignPhraseLmPrior | null;
  scoringConfig?: Partial<CampaignScoringConfig> | null;
  targetPhrase: string;
}): Promise<CampaignAttemptScoreResult> {
  let reversedAttemptBlob: Blob | null = null;

  try {
    reversedAttemptBlob = await reverseAudioBlob(attemptBlob);
    const processedAttemptAudio = await preprocessAudioBlob(reversedAttemptBlob);
    const whisperScore = await scoreWhisperPhraseAudio(processedAttemptAudio, targetPhrase);
    const combinedScore = combineCampaignLmScore(whisperScore, lmPrior, scoringConfig);
    const normalizedCampaignScore = normalizeCampaignLogScore(combinedScore.averageLogProb);
    const stars = getCampaignStars(normalizedCampaignScore);
    const shouldLogDebug = shouldLogCampaignWhisperScores();
    const debug = shouldLogDebug
      ? {
          alignedTokenCount: combinedScore.debug.alignedTokenCount,
          alignmentMode: combinedScore.debug.alignmentMode,
          asrLogProbabilities: combinedScore.debug.alignedTokens.map(
            (tokenScore) => tokenScore.asrLogProbability,
          ),
          averageLogProb: combinedScore.averageLogProb,
          asrProbabilities: combinedScore.debug.asrProbabilities,
          combinedRawScore: combinedScore.debug.combinedRawScore,
          finalScore: normalizedCampaignScore,
          firstTokenAddAmount: combinedScore.debug.firstTokenAddAmount,
          lmLogProbabilities: combinedScore.debug.alignedTokens.map(
            (tokenScore) => tokenScore.lmLogProbability,
          ),
          lmModelName: combinedScore.debug.lmModelName,
          lmProbabilities: combinedScore.debug.lmProbabilities,
          lmTokenIds: combinedScore.debug.lmTokenIds,
          lmTokenTexts: combinedScore.debug.lmTokenTexts,
          lmWeight: combinedScore.debug.lmWeight,
          normalizedCampaignScore,
          perTokenCombinedLogLikelihoodRatio:
            combinedScore.debug.perTokenCombinedLogLikelihoodRatio,
          scoreCalculation: `score = mean(${combinedScore.debug.alignedTokens
            .map(
              (tokenScore, index) =>
                `[${index}] ${tokenScore.asrLogProbability.toFixed(6)} - (${combinedScore.debug.lmWeight.toFixed(6)} * ${tokenScore.lmLogProbability.toFixed(6)}) = ${tokenScore.combinedLogLikelihoodRatio.toFixed(6)}`,
            )
            .join(', ')}) = ${combinedScore.averageLogProb.toFixed(6)}`,
          scoreFormula:
            'score = mean(log(p_asr(token_i)) - lm_weight * log(p_lm(token_i)))',
          rawCombinedLogLikelihood: combinedScore.rawLogLikelihood,
          rawWhisperLogLikelihood: whisperScore.rawLogLikelihood,
          stars,
          targetPhrase,
          targetStepScores: whisperScore.targetStepScores,
          totalDecodeSteps: whisperScore.decodeSteps,
          usedLmPriors: combinedScore.debug.usedLmPriors,
          warnings: combinedScore.debug.warnings,
          whisperTokenIds: combinedScore.debug.whisperTokenIds,
          whisperTokenTexts: combinedScore.debug.whisperTokenTexts,
        }
      : null;

    if (debug) {
      console.info('[CampaignWhisperScore]', debug);
      console.info('[CampaignWhisperScore][Formula]', debug.scoreFormula);
      console.info('[CampaignWhisperScore][Calculation]', debug.scoreCalculation);
      console.info('[CampaignWhisperScore][LMProbabilities]', debug.lmProbabilities);
      console.table(
        combinedScore.debug.alignedTokens.map((tokenScore, index) => {
          const stepScore = whisperScore.targetStepScores[tokenScore.whisperIndex];

          return {
            step: index,
            whisperIndex: tokenScore.whisperIndex,
            whisperTokenId: tokenScore.whisperTokenId,
            whisperTokenText: tokenScore.whisperTokenText,
            asrLogProbability: tokenScore.asrLogProbability,
            asrProbability: tokenScore.asrProbability,
            lmIndex: tokenScore.lmIndex,
            lmTokenId: tokenScore.lmTokenId,
            lmTokenText: tokenScore.lmTokenText,
            lmLogProbability: tokenScore.lmLogProbability,
            lmProbability: tokenScore.lmProbability,
            weightedLmLogProbability: debug.lmWeight * tokenScore.lmLogProbability,
            scoreCalculation: `${tokenScore.asrLogProbability.toFixed(6)} - (${debug.lmWeight.toFixed(6)} * ${tokenScore.lmLogProbability.toFixed(6)})`,
            combinedLogLikelihoodRatio: tokenScore.combinedLogLikelihoodRatio,
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
    }

    return {
      debug,
      reversedAttemptBlob,
      score: normalizedCampaignScore,
      stars,
    };
  } catch (error) {
    console.warn('[CampaignAttemptScoring]', error);
    return zeroScoreResult(targetPhrase, reversedAttemptBlob);
  }
}
