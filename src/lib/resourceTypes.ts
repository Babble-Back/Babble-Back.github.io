export const RESOURCE_TYPES = {
  BB_COIN: 'bb_coin',
} as const;

export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];
