import { reverseAudioBlob } from '../../audio/utils/reverseAudioBlob';
import { preprocessAudioBlob } from '../../lib/asr/preprocess';
import {
  scoreWhisperPhraseAudio,
  type WhisperStepScore,
  warmWhisperScorer,
} from '../../lib/asr/whisperScoring';
import {
  getCampaignStars,
  normalizeCampaignWhisperScore,
} from './scoring';

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
  generatedSequence: string;
  generatedStepScores: WhisperStepScore[];
  generatedTokenIds: number[];
  normalizedCampaignScore: number;
  rawPhraseLogLikelihood: number;
  stars: number;
  targetPhrase: string;
  targetStepScores: WhisperStepScore[];
  targetTokenIds: number[];
  totalDecodeSteps: number;
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
    debug: DEV_MODE
      ? {
          generatedSequence: '',
          generatedStepScores: [],
          generatedTokenIds: [],
          normalizedCampaignScore: 0,
          rawPhraseLogLikelihood: Number.NEGATIVE_INFINITY,
          stars: 0,
          targetPhrase,
          targetStepScores: [],
          targetTokenIds: [],
          totalDecodeSteps: 0,
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
  targetPhrase,
}: {
  attemptBlob: Blob;
  targetPhrase: string;
}): Promise<CampaignAttemptScoreResult> {
  let reversedAttemptBlob: Blob | null = null;

  try {
    reversedAttemptBlob = await reverseAudioBlob(attemptBlob);
    const processedAttemptAudio = await preprocessAudioBlob(reversedAttemptBlob);
    const whisperScore = await scoreWhisperPhraseAudio(processedAttemptAudio, targetPhrase);
    const normalizedCampaignScore = normalizeCampaignWhisperScore({
      averageLogProb: whisperScore.averageLogProb,
      generatedAverageLogProb: whisperScore.generatedAverageLogProb,
    });
    const stars = getCampaignStars(normalizedCampaignScore);
    const shouldLogDebug = shouldLogCampaignWhisperScores();
    const debug = shouldLogDebug
      ? {
          generatedSequence: whisperScore.generatedText,
          generatedStepScores: whisperScore.generatedStepScores,
          generatedTokenIds: whisperScore.generatedSequenceTokenIds,
          normalizedCampaignScore,
          rawPhraseLogLikelihood: whisperScore.rawLogLikelihood,
          stars,
          targetPhrase,
          targetStepScores: whisperScore.targetStepScores,
          targetTokenIds: whisperScore.targetTokenIds,
          totalDecodeSteps: whisperScore.decodeSteps,
        }
      : null;

    if (debug) {
      console.info('[CampaignWhisperScore]', debug);
      console.table(
        debug.targetStepScores.map((stepScore) => ({
          step: stepScore.step,
          tokenId: stepScore.tokenId,
          tokenText: stepScore.tokenText,
          logProb: stepScore.logProb,
          probability: stepScore.probability,
          topCandidates: stepScore.topCandidates
            .map(
              (candidate) =>
                `${candidate.tokenId}:${candidate.tokenText} (${candidate.logProb.toFixed(3)})`,
            )
            .join(' | '),
        })),
      );
      console.table(
        debug.generatedStepScores.map((stepScore) => ({
          step: stepScore.step,
          tokenId: stepScore.tokenId,
          tokenText: stepScore.tokenText,
          logProb: stepScore.logProb,
          probability: stepScore.probability,
          topCandidates: stepScore.topCandidates
            .map(
              (candidate) =>
                `${candidate.tokenId}:${candidate.tokenText} (${candidate.logProb.toFixed(3)})`,
            )
            .join(' | '),
        })),
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
