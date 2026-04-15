import { ctcScore, setCTCBlankTokenId } from './ctcScoring';
import { loadASR } from './model';
import {
  isAudioTooShort,
  isSilentAudio,
  normalizeAudio,
  TARGET_SAMPLE_RATE,
} from './preprocess';

const ZERO_SCORE_RESULT = {
  score: 0,
  stars: 0,
} as const;

function normalizePhraseText(text: string) {
  return text
    .trim()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/[^A-Za-z'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function getStars(score: number) {
  if (score > 0.03) {
    return 3;
  }

  if (score > 0.02) {
    return 2;
  }

  if (score > 0.01) {
    return 1;
  }

  return 0;
}

export async function warmASR() {
  await loadASR();
}

export async function warmASRScorer() {
  await warmASR();
}

export async function getLogits(audio: Float32Array) {
  const normalizedAudio = normalizeAudio(audio);
  const { processor, model } = await loadASR();
  const input = await processor(normalizedAudio);
  const output = (await model(input)) as {
    logits: {
      [index: number]: {
        data: ArrayLike<number>;
        dims: number[];
      };
    };
  };
  const logits = output.logits[0];
  const [timeSteps, vocabSize] = logits.dims;
  const rows = new Array<number[]>(timeSteps);

  for (let timeIndex = 0; timeIndex < timeSteps; timeIndex += 1) {
    const row = new Array<number>(vocabSize);
    const rowOffset = timeIndex * vocabSize;

    for (let vocabIndex = 0; vocabIndex < vocabSize; vocabIndex += 1) {
      row[vocabIndex] = Number(logits.data[rowOffset + vocabIndex] ?? 0);
    }

    rows[timeIndex] = row;
  }

  return rows;
}

export function logSoftmax(logits: number[][]): number[][] {
  return logits.map((row) => {
    let max = NEGATIVE_INFINITY;

    for (let index = 0; index < row.length; index += 1) {
      max = Math.max(max, row[index] ?? NEGATIVE_INFINITY);
    }

    let sum = 0;
    for (let index = 0; index < row.length; index += 1) {
      sum += Math.exp((row[index] ?? NEGATIVE_INFINITY) - max);
    }

    const logSum = Math.log(sum);
    const normalized = new Array<number>(row.length);

    for (let index = 0; index < row.length; index += 1) {
      normalized[index] = (row[index] ?? NEGATIVE_INFINITY) - max - logSum;
    }

    return normalized;
  });
}

export async function tokenizeText(text: string) {
  const normalizedText = normalizePhraseText(text);

  if (!normalizedText) {
    return [];
  }

  const { tokenizer } = await loadASR();

  setCTCBlankTokenId(
    typeof tokenizer.pad_token_id === 'number' ? tokenizer.pad_token_id : 0,
  );

  const tokens = tokenizer.encode(normalizedText, {
    add_special_tokens: false,
  });

  return tokens.filter((token) => Number.isInteger(token));
}

export async function scoreAudio(audio: Float32Array, phrase: string) {
  if (
    !audio.length ||
    isSilentAudio(audio) ||
    isAudioTooShort(audio, TARGET_SAMPLE_RATE)
  ) {
    return ZERO_SCORE_RESULT;
  }

  const tokens = await tokenizeText(phrase);

  if (!tokens.length) {
    return ZERO_SCORE_RESULT;
  }

  const logits = await getLogits(audio);
  const logProbs = logSoftmax(logits);
  const averageLogProbability = ctcScore(logProbs, tokens);

  if (!Number.isFinite(averageLogProbability)) {
    return ZERO_SCORE_RESULT;
  }

  const normalizedScore = Math.max(0, Math.min(1, Math.exp(averageLogProbability)));

  return {
    score: normalizedScore,
    stars: getStars(normalizedScore),
  };
}

const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;
