import {
  AutoModelForCausalLM,
  AutoTokenizer,
  Tensor,
  env,
} from '@huggingface/transformers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toCampaignPhraseScoringText } from '../src/features/campaign/lmPrior';

const DEFAULT_GPT2_MODEL_NAME = process.env.CAMPAIGN_LM_MODEL?.trim() || 'Xenova/gpt2';
const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

interface ChallengePhraseRow {
  id: string;
  phrase: string;
}

export interface CampaignChallengeLmColumns {
  lm_model_name: string | null;
  lm_ready: boolean;
  lm_token_count: number;
  lm_token_ids: number[];
  lm_token_log_probs: number[];
  lm_token_probs: number[];
  lm_token_texts: string[];
}

interface LoadedGpt2Lm {
  bosTokenId: number;
  model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;
  modelName: string;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
}

interface BackfillResult {
  failureCount: number;
  failures: Array<{ challengeId: string; message: string; phrase: string }>;
  successCount: number;
}

const gpt2LoadPromises = new Map<string, Promise<LoadedGpt2Lm>>();

function probabilityFromLogProb(logProb: number) {
  if (!Number.isFinite(logProb)) {
    return 0;
  }

  return Math.exp(logProb);
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logProbabilityForToken(logits: Float32Array, tokenId: number) {
  if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= logits.length) {
    return NEGATIVE_INFINITY;
  }

  let maxLogit = NEGATIVE_INFINITY;

  for (let index = 0; index < logits.length; index += 1) {
    maxLogit = Math.max(maxLogit, logits[index] ?? NEGATIVE_INFINITY);
  }

  if (!Number.isFinite(maxLogit)) {
    return NEGATIVE_INFINITY;
  }

  let sumExp = 0;
  for (let index = 0; index < logits.length; index += 1) {
    sumExp += Math.exp((logits[index] ?? NEGATIVE_INFINITY) - maxLogit);
  }

  if (!(sumExp > 0)) {
    return NEGATIVE_INFINITY;
  }

  return (logits[tokenId] ?? NEGATIVE_INFINITY) - maxLogit - Math.log(sumExp);
}

function extractLogitsRow(logitsTensor: Tensor, rowIndex: number) {
  const [batchSize, sequenceLength, vocabularySize] = logitsTensor.dims;

  if (batchSize !== 1 || sequenceLength <= rowIndex || vocabularySize <= 0) {
    return null;
  }

  const row = new Float32Array(vocabularySize);
  const data = logitsTensor.data as ArrayLike<number>;
  const rowOffset = rowIndex * vocabularySize;

  for (let vocabularyIndex = 0; vocabularyIndex < vocabularySize; vocabularyIndex += 1) {
    row[vocabularyIndex] = Number(data[rowOffset + vocabularyIndex] ?? 0);
  }

  return row;
}

function createInt64Tensor(values: number[]) {
  return new Tensor(
    'int64',
    BigInt64Array.from(values.map((value) => BigInt(Math.trunc(value)))),
    [1, values.length],
  );
}

async function loadGpt2Lm(modelName = DEFAULT_GPT2_MODEL_NAME): Promise<LoadedGpt2Lm> {
  const normalizedModelName = modelName.trim() || DEFAULT_GPT2_MODEL_NAME;
  const existingPromise = gpt2LoadPromises.get(normalizedModelName);

  if (existingPromise) {
    return existingPromise;
  }

  const nextPromise = (async () => {
      env.allowLocalModels = false;

      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(normalizedModelName),
        AutoModelForCausalLM.from_pretrained(normalizedModelName),
      ]);

      const tokenizerWithSpecialTokens = tokenizer as {
        bos_token_id?: number;
        eos_token_id?: number;
      };
      const bosTokenId =
        tokenizerWithSpecialTokens.bos_token_id ??
        tokenizerWithSpecialTokens.eos_token_id ??
        50256;

      return {
        bosTokenId,
        model,
        modelName: normalizedModelName,
        tokenizer,
      };
    })().catch((error) => {
      gpt2LoadPromises.delete(normalizedModelName);
      throw error;
    });

  gpt2LoadPromises.set(normalizedModelName, nextPromise);
  return nextPromise;
}

export async function computePhraseLmPrior(
  phrase: string,
  options?: {
    modelName?: string;
  },
): Promise<CampaignChallengeLmColumns> {
  const scoringText = toCampaignPhraseScoringText(phrase);

  if (!scoringText) {
    return {
      lm_model_name: options?.modelName?.trim() || DEFAULT_GPT2_MODEL_NAME,
      lm_ready: false,
      lm_token_count: 0,
      lm_token_ids: [],
      lm_token_log_probs: [],
      lm_token_probs: [],
      lm_token_texts: [],
    };
  }

  const { bosTokenId, model, modelName, tokenizer } = await loadGpt2Lm(options?.modelName);
  const tokenIds = tokenizer.encode(scoringText, { add_special_tokens: false });

  if (!tokenIds.length) {
    return {
      lm_model_name: modelName,
      lm_ready: false,
      lm_token_count: 0,
      lm_token_ids: [],
      lm_token_log_probs: [],
      lm_token_probs: [],
      lm_token_texts: [],
    };
  }

  const inputIds = [bosTokenId, ...tokenIds];
  const attentionMask = Array.from({ length: inputIds.length }, () => 1);
  const outputs = await model({
    attention_mask: createInt64Tensor(attentionMask),
    input_ids: createInt64Tensor(inputIds),
  });
  const logits = outputs.logits;
  const tokenLogProbs = tokenIds.map((tokenId, index) => {
    const logitsRow = extractLogitsRow(logits, index);
    return logitsRow ? logProbabilityForToken(logitsRow, tokenId) : NEGATIVE_INFINITY;
  });
  const tokenProbs = tokenLogProbs.map(probabilityFromLogProb);
  const tokenTexts = tokenizer.batch_decode(
    tokenIds.map((tokenId) => [tokenId]),
    {
      clean_up_tokenization_spaces: false,
      skip_special_tokens: false,
    },
  );

  return {
    lm_model_name: modelName,
    lm_ready: tokenLogProbs.every((value) => Number.isFinite(value)),
    lm_token_count: tokenIds.length,
    lm_token_ids: tokenIds,
    lm_token_log_probs: tokenLogProbs,
    lm_token_probs: tokenProbs,
    lm_token_texts: tokenTexts,
  };
}

export async function withCampaignChallengeLmPriors<T extends { phrase: string }>(
  challengeRows: T[],
  options?: {
    modelName?: string;
  },
): Promise<Array<T & CampaignChallengeLmColumns>> {
  const nextRows: Array<T & CampaignChallengeLmColumns> = [];

  for (const challengeRow of challengeRows) {
    const lmPrior = await computePhraseLmPrior(challengeRow.phrase, options);
    nextRows.push({
      ...challengeRow,
      ...lmPrior,
    });
  }

  return nextRows;
}

export async function backfillCampaignLmPriorsForChallenges(
  client: SupabaseClient,
  challengeRows: ChallengePhraseRow[],
  options?: {
    modelName?: string;
  },
): Promise<BackfillResult> {
  const failures: BackfillResult['failures'] = [];
  let successCount = 0;

  for (const challengeRow of challengeRows) {
    try {
      const lmPrior = await computePhraseLmPrior(challengeRow.phrase, options);
      const { error } = await client
        .from('campaign_challenges')
        .update(lmPrior)
        .eq('id', challengeRow.id);

      if (error) {
        throw error;
      }

      successCount += 1;
    } catch (error) {
      failures.push({
        challengeId: challengeRow.id,
        message: formatUnknownError(error),
        phrase: challengeRow.phrase,
      });
    }
  }

  return {
    failureCount: failures.length,
    failures,
    successCount,
  };
}
