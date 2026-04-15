import {
  LogitsProcessor,
  LogitsProcessorList,
  type Tensor,
} from '@huggingface/transformers';
import {
  isAudioTooShort,
  isSilentAudio,
  TARGET_SAMPLE_RATE,
} from './preprocess';
import { loadWhisperModel } from './whisperModel';

const ZERO_SCORE = Number.NEGATIVE_INFINITY;
const MAX_GENERATED_TOKENS = 48;
const SCORE_LANGUAGE = 'en';
const SCORE_TASK = 'transcribe';
const DEBUG_TOP_CANDIDATES = 5;

export interface WhisperStepCandidate {
  logProb: number;
  probability: number;
  tokenId: number;
  tokenText: string;
}

export interface WhisperStepScore {
  logProb: number;
  probability: number;
  step: number;
  tokenId: number;
  tokenText: string;
  topCandidates: WhisperStepCandidate[];
}

export interface WhisperPhraseScoreDetails {
  averageLogProb: number;
  decodeSteps: number;
  rawLogLikelihood: number;
  targetTokenIds: number[];
  targetStepScores: WhisperStepScore[];
}

class CaptureLogitsProcessor extends LogitsProcessor {
  rows: Float32Array[] = [];

  _call(_inputIds: bigint[][], logits: Tensor) {
    const data = logits.data as ArrayLike<number>;

    if (logits.dims.length < 2 || logits.dims[0] < 1) {
      this.rows.push(Float32Array.from(data));
      return logits;
    }

    const rowSize = logits.dims[1] ?? data.length;
    const firstRow = new Float32Array(rowSize);

    for (let index = 0; index < rowSize; index += 1) {
      firstRow[index] = Number(data[index] ?? 0);
    }

    this.rows.push(firstRow);
    return logits;
  }
}

function buildGenerationConfig(maxNewTokens: number) {
  return {
    do_sample: false,
    language: SCORE_LANGUAGE,
    max_new_tokens: maxNewTokens,
    output_scores: true,
    return_dict_in_generate: true,
    return_timestamps: false,
    task: SCORE_TASK,
  };
}

function normalizePhraseText(text: string) {
  return text
    .trim()
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/\s+/g, ' ');
}

function toWhisperScoringText(text: string) {
  const normalized = normalizePhraseText(text);
  return normalized ? ` ${normalized}` : '';
}

function logProbabilityForToken(logits: Float32Array, tokenId: number) {
  if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= logits.length) {
    return ZERO_SCORE;
  }

  let maxLogit = ZERO_SCORE;

  for (let index = 0; index < logits.length; index += 1) {
    maxLogit = Math.max(maxLogit, logits[index] ?? ZERO_SCORE);
  }

  if (!Number.isFinite(maxLogit)) {
    return ZERO_SCORE;
  }

  let sumExp = 0;
  for (let index = 0; index < logits.length; index += 1) {
    sumExp += Math.exp((logits[index] ?? ZERO_SCORE) - maxLogit);
  }

  if (!(sumExp > 0)) {
    return ZERO_SCORE;
  }

  return (logits[tokenId] ?? ZERO_SCORE) - maxLogit - Math.log(sumExp);
}

function averageLogProbability(logProbs: number[]) {
  if (!logProbs.length) {
    return ZERO_SCORE;
  }

  let total = 0;

  for (const value of logProbs) {
    if (!Number.isFinite(value)) {
      return ZERO_SCORE;
    }

    total += value;
  }

  return total / logProbs.length;
}

function probabilityFromLogProb(logProb: number) {
  if (!Number.isFinite(logProb)) {
    return 0;
  }

  return Math.exp(logProb);
}

function getTopCandidateTokenIds(logits: Float32Array, limit: number) {
  const top: Array<{ logit: number; tokenId: number }> = [];

  for (let tokenId = 0; tokenId < logits.length; tokenId += 1) {
    const logit = logits[tokenId] ?? ZERO_SCORE;

    if (top.length < limit) {
      top.push({ logit, tokenId });
      top.sort((left, right) => right.logit - left.logit);
      continue;
    }

    const last = top[top.length - 1];
    if (!last || logit <= last.logit) {
      continue;
    }

    top[top.length - 1] = { logit, tokenId };
    top.sort((left, right) => right.logit - left.logit);
  }

  return top.map((entry) => entry.tokenId);
}

async function decodeTokenTexts(tokenIds: number[]) {
  if (!tokenIds.length) {
    return new Map<number, string>();
  }

  const { tokenizer } = await loadWhisperModel();
  const decoded = tokenizer.batch_decode(
    tokenIds.map((tokenId) => [tokenId]),
    { skip_special_tokens: false },
  );

  return new Map<number, string>(
    tokenIds.map((tokenId, index) => [tokenId, decoded[index] ?? '']),
  );
}

async function buildStepScore(
  step: number,
  tokenId: number,
  logits: Float32Array,
): Promise<WhisperStepScore> {
  const topCandidateTokenIds = getTopCandidateTokenIds(logits, DEBUG_TOP_CANDIDATES);
  const tokenIdsToDecode = Array.from(new Set([tokenId, ...topCandidateTokenIds]));
  const tokenTexts = await decodeTokenTexts(tokenIdsToDecode);
  const logProb = logProbabilityForToken(logits, tokenId);

  return {
    logProb,
    probability: probabilityFromLogProb(logProb),
    step,
    tokenId,
    tokenText: tokenTexts.get(tokenId) ?? '',
    topCandidates: topCandidateTokenIds.map((candidateTokenId) => {
      const candidateLogProb = logProbabilityForToken(logits, candidateTokenId);

      return {
        logProb: candidateLogProb,
        probability: probabilityFromLogProb(candidateLogProb),
        tokenId: candidateTokenId,
        tokenText: tokenTexts.get(candidateTokenId) ?? '',
      };
    }),
  };
}

async function encodeInputFeatures(audio: Float32Array) {
  const { processor } = await loadWhisperModel();
  const output = (await (processor as {
    (input: Float32Array): Promise<{ input_features: Tensor }>;
  })(audio)) as { input_features: Tensor };

  return output.input_features;
}

async function getPromptTokenIds() {
  const { model } = await loadWhisperModel();
  const whisperModel = model as unknown as {
    _prepare_generation_config: (generationConfig: unknown, kwargs: unknown) => unknown;
    _retrieve_init_tokens: (generationConfig: unknown) => number[];
  };
  const generationConfig = whisperModel._prepare_generation_config(
    null,
    buildGenerationConfig(MAX_GENERATED_TOKENS),
  );

  return whisperModel._retrieve_init_tokens(generationConfig);
}

async function scoreTargetTokensWithGeneration(
  inputFeatures: Tensor,
  promptTokenIds: number[],
  targetTokenIds: number[],
) {
  const { model } = await loadWhisperModel();
  const stepLogProbs: number[] = [];
  const targetStepScores: WhisperStepScore[] = [];
  const decoderInputIds = [...promptTokenIds];

  for (let step = 0; step < targetTokenIds.length; step += 1) {
    const tokenId = targetTokenIds[step]!;
    const capture = new CaptureLogitsProcessor();
    const logitsProcessor = new LogitsProcessorList();
    logitsProcessor.push(capture);

    await model.generate({
      decoder_input_ids: decoderInputIds,
      inputs: inputFeatures,
      logits_processor: logitsProcessor,
      ...buildGenerationConfig(1),
    });

    const stepLogits = capture.rows[0];
    const tokenLogProb = stepLogits
      ? logProbabilityForToken(stepLogits, tokenId)
      : ZERO_SCORE;

    stepLogProbs.push(tokenLogProb);
    if (stepLogits) {
      targetStepScores.push(await buildStepScore(step, tokenId, stepLogits));
    }
    decoderInputIds.push(tokenId);
  }

  return {
    averageLogProb: averageLogProbability(stepLogProbs),
    rawLogLikelihood: stepLogProbs.reduce((total, value) => total + value, 0),
    targetStepScores,
  };
}

export async function warmWhisperScorer() {
  await loadWhisperModel();
}

export async function scoreWhisperPhraseAudio(
  audio: Float32Array,
  phrase: string,
): Promise<WhisperPhraseScoreDetails> {
  const scoringText = toWhisperScoringText(phrase);

  if (
    !audio.length ||
    !scoringText ||
    isSilentAudio(audio) ||
    isAudioTooShort(audio, TARGET_SAMPLE_RATE)
  ) {
    return {
      averageLogProb: ZERO_SCORE,
      decodeSteps: 0,
      rawLogLikelihood: ZERO_SCORE,
      targetTokenIds: [],
      targetStepScores: [],
    };
  }

  const [{ tokenizer }, inputFeatures, promptTokenIds] = await Promise.all([
    loadWhisperModel(),
    encodeInputFeatures(audio),
    getPromptTokenIds(),
  ]);
  const targetTokenIds = tokenizer.encode(scoringText, {
    add_special_tokens: false,
  });

  if (!targetTokenIds.length) {
    return {
      averageLogProb: ZERO_SCORE,
      decodeSteps: 0,
      rawLogLikelihood: ZERO_SCORE,
      targetTokenIds: [],
      targetStepScores: [],
    };
  }

  const targetScore = await scoreTargetTokensWithGeneration(
    inputFeatures,
    promptTokenIds,
    targetTokenIds,
  );

  return {
    averageLogProb: targetScore.averageLogProb,
    decodeSteps: targetScore.targetStepScores.length,
    rawLogLikelihood: targetScore.rawLogLikelihood,
    targetTokenIds,
    targetStepScores: targetScore.targetStepScores,
  };
}
