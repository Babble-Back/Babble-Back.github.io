import type { ActiveCampaignHome, CampaignState, PublicCampaignDemoBase } from '../../lib/campaigns';

const PUBLIC_CAMPAIGN_DEMO_CACHE_KEY = 'public_campaign_demo_progress_v1';
const PUBLIC_CAMPAIGN_DEMO_USER_ID = 'public-demo';
const PUBLIC_CAMPAIGN_DEMO_ICON_FALLBACK = `${import.meta.env.BASE_URL}newIcon.png`;
const PUBLIC_CAMPAIGN_DEMO_LEVELS = [
  { difficulty: 'easy', mode: 'normal', phrase: 'egg' },
  { difficulty: 'easy', mode: 'normal', phrase: 'nests' },
  { difficulty: 'easy', mode: 'normal', phrase: 'chick' },
  { difficulty: 'easy', mode: 'normal', phrase: 'blooms' },
  { difficulty: 'easy', mode: 'normal', phrase: 'lily' },
] as const;

interface PublicCampaignDemoProgress {
  completedCount: number;
  currentIndex: number;
}

function clampProgressValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function loadStoredProgress(maxChallengeCount: number) {
  if (typeof window === 'undefined') {
    return {
      completedCount: 0,
      currentIndex: 1,
    } satisfies PublicCampaignDemoProgress;
  }

  try {
    const raw = window.localStorage.getItem(PUBLIC_CAMPAIGN_DEMO_CACHE_KEY);

    if (!raw) {
      return {
        completedCount: 0,
        currentIndex: 1,
      } satisfies PublicCampaignDemoProgress;
    }

    const parsed = JSON.parse(raw) as Partial<PublicCampaignDemoProgress> | null;
    const completedCount = clampProgressValue(parsed?.completedCount ?? 0, 0, maxChallengeCount);
    const currentIndex = clampProgressValue(
      parsed?.currentIndex ?? completedCount + 1,
      1,
      maxChallengeCount + 1,
    );

    return {
      completedCount: Math.min(completedCount, currentIndex - 1),
      currentIndex: Math.max(currentIndex, Math.min(maxChallengeCount + 1, completedCount + 1)),
    } satisfies PublicCampaignDemoProgress;
  } catch {
    return {
      completedCount: 0,
      currentIndex: 1,
    } satisfies PublicCampaignDemoProgress;
  }
}

function withChallengeIconFallback(assets: Record<string, string>) {
  if (typeof assets.challenge_icon === 'string' && assets.challenge_icon.trim()) {
    return assets;
  }

  return {
    ...assets,
    challenge_icon: PUBLIC_CAMPAIGN_DEMO_ICON_FALLBACK,
  };
}

function buildFallbackDemoBase(preview: ActiveCampaignHome | null): PublicCampaignDemoBase {
  const campaignId = preview?.campaignId ?? 'public-demo-campaign';
  const title = preview?.title ?? 'Current Campaign';

  return {
    campaign: {
      id: campaignId,
      name: title,
      theme: null,
      startDate: null,
      endDate: null,
      isActive: true,
      rewardPackId: null,
      config: {},
    },
    challenges: PUBLIC_CAMPAIGN_DEMO_LEVELS.map((level, index) => ({
      id: `public-demo-challenge-${index + 1}`,
      campaignId,
      challengeIndex: index + 1,
      phrase: level.phrase,
      difficulty: level.difficulty,
      mode: level.mode,
      createdAt: new Date(2026, 3, index + 1).toISOString(),
      lmTokenCount: 0,
      lmReady: false,
    })),
    assets: withChallengeIconFallback({
      banner_image: preview?.bannerImage ?? '',
      challenge_icon: preview?.challengeIcon ?? '',
      subtitle: preview?.subtitle ?? '',
      title,
    }),
  };
}

function buildDemoState(base: PublicCampaignDemoBase): CampaignState {
  const nextBase = {
    ...base,
    assets: withChallengeIconFallback(base.assets),
  };
  const maxChallengeCount = Math.max(1, nextBase.challenges.length);
  const progress = loadStoredProgress(maxChallengeCount);

  return {
    campaign: nextBase.campaign,
    challenges: nextBase.challenges,
    assets: nextBase.assets,
    progress: {
      userId: PUBLIC_CAMPAIGN_DEMO_USER_ID,
      campaignId: nextBase.campaign.id,
      currentIndex: progress.currentIndex,
      completedCount: progress.completedCount,
    },
    attemptState: null,
    attempts: [],
    unlockedPackIds: [],
  };
}

export function createPublicCampaignDemoState(preview: ActiveCampaignHome | null): CampaignState {
  return buildDemoState(buildFallbackDemoBase(preview));
}

export function createPublicCampaignDemoStateFromBase(base: PublicCampaignDemoBase): CampaignState {
  return buildDemoState(base);
}

export function persistPublicCampaignDemoState(state: CampaignState) {
  if (typeof window === 'undefined') {
    return;
  }

  const maxChallengeCount = Math.max(1, state.challenges.length);
  const nextProgress: PublicCampaignDemoProgress = {
    completedCount: clampProgressValue(state.progress.completedCount, 0, maxChallengeCount),
    currentIndex: clampProgressValue(state.progress.currentIndex, 1, maxChallengeCount + 1),
  };

  window.localStorage.setItem(PUBLIC_CAMPAIGN_DEMO_CACHE_KEY, JSON.stringify(nextProgress));
}

export function resetPublicCampaignDemoState(preview: ActiveCampaignHome | null) {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(PUBLIC_CAMPAIGN_DEMO_CACHE_KEY);
  }

  return createPublicCampaignDemoState(preview);
}

export function resetPublicCampaignDemoStateFromBase(base: PublicCampaignDemoBase) {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(PUBLIC_CAMPAIGN_DEMO_CACHE_KEY);
  }

  return createPublicCampaignDemoStateFromBase(base);
}
