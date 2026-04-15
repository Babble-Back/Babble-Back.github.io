export interface CampaignPhraseLmPrior {
  modelName: string | null;
  ready: boolean;
  tokenCount: number;
  tokenIds: number[];
  tokenLogProbs: number[];
  tokenProbs: number[];
  tokenTexts: string[];
}

export interface CampaignScoringConfig {
  firstTokenAddAmount: number;
  lmWeight: number;
  probabilityEpsilon: number;
}

export const DEFAULT_CAMPAIGN_SCORING_CONFIG: CampaignScoringConfig = {
  firstTokenAddAmount: 0.35,
  lmWeight: 0.2,
  probabilityEpsilon: 1e-6,
};

function asFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asNonNegativeFiniteNumber(
  value: unknown,
  fallback: number,
  options?: {
    min?: number;
  },
) {
  const parsed = asFiniteNumber(value);

  if (parsed === null) {
    return fallback;
  }

  const min = options?.min ?? 0;
  return Math.max(min, parsed);
}

function asIntegerArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asFiniteNumber(entry))
    .filter((entry): entry is number => entry !== null)
    .map((entry) => Math.trunc(entry));
}

function asNumberArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asFiniteNumber(entry))
    .filter((entry): entry is number => entry !== null);
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeTokenCount(
  tokenCount: number,
  tokenIds: number[],
  tokenTexts: string[],
  tokenProbs: number[],
  tokenLogProbs: number[],
) {
  return Math.max(
    0,
    Math.trunc(tokenCount),
    tokenIds.length,
    tokenTexts.length,
    tokenProbs.length,
    tokenLogProbs.length,
  );
}

export function normalizeCampaignPhraseText(text: string) {
  return text
    .trim()
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/\s+/g, ' ');
}

export function toCampaignPhraseScoringText(text: string) {
  const normalized = normalizeCampaignPhraseText(text);
  return normalized ? ` ${normalized}` : '';
}

export function normalizeCampaignPhraseLmPrior(
  prior: Partial<CampaignPhraseLmPrior> | null | undefined,
): CampaignPhraseLmPrior | null {
  if (!prior) {
    return null;
  }

  const tokenIds = asIntegerArray(prior.tokenIds);
  const tokenTexts = asStringArray(prior.tokenTexts);
  const tokenProbs = asNumberArray(prior.tokenProbs);
  const tokenLogProbs = asNumberArray(prior.tokenLogProbs);
  const tokenCount = normalizeTokenCount(
    asNonNegativeFiniteNumber(prior.tokenCount, 0),
    tokenIds,
    tokenTexts,
    tokenProbs,
    tokenLogProbs,
  );

  return {
    modelName:
      typeof prior.modelName === 'string' && prior.modelName.trim() ? prior.modelName.trim() : null,
    ready: Boolean(prior.ready),
    tokenCount,
    tokenIds,
    tokenLogProbs,
    tokenProbs,
    tokenTexts,
  };
}

export function readCampaignPhraseLmPrior(value: unknown): CampaignPhraseLmPrior | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return normalizeCampaignPhraseLmPrior({
    modelName:
      typeof record.modelName === 'string' && record.modelName.trim()
        ? record.modelName
        : null,
    ready: typeof record.ready === 'boolean' ? record.ready : false,
    tokenCount: asNonNegativeFiniteNumber(record.tokenCount, 0),
    tokenIds: asIntegerArray(record.tokenIds),
    tokenTexts: asStringArray(record.tokenTexts),
    tokenProbs: asNumberArray(record.tokenProbs),
    tokenLogProbs: asNumberArray(record.tokenLogProbs),
  });
}

export function isCampaignPhraseLmPriorUsable(
  prior: CampaignPhraseLmPrior | null | undefined,
): prior is CampaignPhraseLmPrior {
  if (!prior?.ready) {
    return false;
  }

  return (
    prior.tokenCount > 0 &&
    prior.tokenIds.length > 0 &&
    prior.tokenProbs.length > 0 &&
    prior.tokenLogProbs.length > 0
  );
}

export function readCampaignScoringConfig(
  config: Record<string, unknown> | null | undefined,
): CampaignScoringConfig {
  const scoring = asRecord(config?.scoring);

  return {
    firstTokenAddAmount: asNonNegativeFiniteNumber(
      scoring?.first_token_add_amount,
      DEFAULT_CAMPAIGN_SCORING_CONFIG.firstTokenAddAmount,
    ),
    lmWeight: asNonNegativeFiniteNumber(
      scoring?.lm_weight,
      DEFAULT_CAMPAIGN_SCORING_CONFIG.lmWeight,
    ),
    probabilityEpsilon: asNonNegativeFiniteNumber(
      scoring?.probability_epsilon,
      DEFAULT_CAMPAIGN_SCORING_CONFIG.probabilityEpsilon,
      { min: Number.MIN_VALUE },
    ),
  };
}
