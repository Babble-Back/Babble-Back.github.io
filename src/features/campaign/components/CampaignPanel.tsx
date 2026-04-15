import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { StarRating } from '../../../components/StarRating';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { WaveformLoader } from '../../../components/WaveformLoader';
import { RoundRewardSequence } from '../../rounds/components/RoundRewardSequence';
import type { RewardSequenceReward } from '../../rounds/types';
import {
  awardCampaignAttemptReward,
  completeCampaignChallenge,
  consumeCampaignAttempt,
  listCampaignLeaderboard,
  loadActiveCampaignState,
} from '../../../lib/campaigns';
import { preprocessAudioBlob } from '../../../lib/asr/preprocess';
import { scoreAudio, warmASRScorer } from '../../../lib/asr/scoring';
import { useCoins } from '../../resources/ResourceProvider';
import { buildBackwardPhraseExample, formatDifficultyLabel } from '../scoring';

interface CampaignPanelProps {
  currentUserId: string;
}

type CampaignStage =
  | 'overview'
  | 'briefing'
  | 'recording-original'
  | 'guide'
  | 'recording-attempt'
  | 'attempt-ready'
  | 'processing'
  | 'result'
  | 'reward';

type CampaignState = NonNullable<Awaited<ReturnType<typeof loadActiveCampaignState>>>;
type CampaignChallenge = CampaignState['challenges'][number];
type CampaignAttemptState = CampaignState['attempts'][number];

interface CampaignRewardReveal extends RewardSequenceReward {
  currentBalance: number;
  advanced: boolean;
}

const FLOATING_EGGS = [
  { top: '5%', left: '4%', size: 36, delay: '0s' },
  { top: '12%', left: '80%', size: 54, delay: '1.2s' },
  { top: '28%', left: '12%', size: 44, delay: '2.1s' },
  { top: '35%', left: '88%', size: 34, delay: '0.6s' },
  { top: '52%', left: '6%', size: 48, delay: '1.8s' },
  { top: '62%', left: '84%', size: 40, delay: '2.8s' },
  { top: '76%', left: '18%', size: 30, delay: '0.9s' },
  { top: '84%', left: '74%', size: 52, delay: '2.3s' },
] as const;

const CAMPAIGN_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
};
const CAMPAIGN_FREE_TRIES_PER_DAY = 2;
const DEFAULT_CAMPAIGN_RETRY_COST = 5;

function LeaderboardIcon() {
  return (
    <svg aria-hidden="true" className="campaign-side-action-svg" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 18V9m6 9V6m6 12v-5M4 20h16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function getAssetValue(state: CampaignState | null, key: string) {
  const assets = (
    state as { assets?: Record<string, string> | Array<{ key: string; value: string }> } | null
  )?.assets;

  if (!assets) {
    return null;
  }

  if (Array.isArray(assets)) {
    return assets.find((entry) => entry.key === key)?.value ?? null;
  }

  return assets[key] ?? null;
}

function isToday(value: string | null | undefined) {
  return Boolean(value && value.slice(0, 10) === new Date().toISOString().slice(0, 10));
}

function getRetryCost(attemptState: unknown) {
  const retryCost = Number(
    (attemptState as { retryCost?: unknown } | null)?.retryCost ?? DEFAULT_CAMPAIGN_RETRY_COST,
  );
  return Number.isFinite(retryCost) ? retryCost : DEFAULT_CAMPAIGN_RETRY_COST;
}

function getAttemptsUsedToday(attemptState: unknown) {
  const attemptsToday = Number(
    (attemptState as { attemptsToday?: unknown } | null)?.attemptsToday ?? 0,
  );
  const lastAttemptDate = (attemptState as { lastAttemptDate?: unknown } | null)?.lastAttemptDate;

  if (!Number.isFinite(attemptsToday) || typeof lastAttemptDate !== 'string' || !isToday(lastAttemptDate)) {
    return 0;
  }

  return Math.max(0, Math.floor(attemptsToday));
}

function getFreeTriesRemaining(attemptState: unknown) {
  return Math.max(0, CAMPAIGN_FREE_TRIES_PER_DAY - getAttemptsUsedToday(attemptState));
}

function requiresRetryCharge(attemptState: unknown) {
  return getFreeTriesRemaining(attemptState) === 0;
}

function hasEnoughCoinsForRetry(attemptState: CampaignAttemptState | null, fallbackCoins: number) {
  if (!requiresRetryCharge(attemptState)) {
    return true;
  }

  const retryCost = getRetryCost(attemptState);
  const currentBalance = attemptState?.currentBalance ?? fallbackCoins;
  return currentBalance >= retryCost;
}

function getChallengeState(index: number, currentIndex: number, completedCount: number) {
  if (index <= completedCount) {
    return 'completed';
  }

  if (index === currentIndex) {
    return 'current';
  }

  return 'locked';
}


function formatThemeName(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCampaignTitle(state: CampaignState | null) {
  const themeName = formatThemeName(state?.campaign.theme);

  if (themeName) {
    return `${themeName} Campaign`;
  }

  const rawTitle = getAssetValue(state, 'title') ?? state?.campaign.name ?? 'Monthly Campaign';
  const trimmedTitle = rawTitle.trim();
  const campaignMatch = trimmedTitle.match(/^(.*?\bcampaign)\b/i);

  return campaignMatch?.[1]?.trim() || trimmedTitle || 'Monthly Campaign';
}

function buildRoadWindow(challenges: CampaignChallenge[], currentIndex: number) {
  const currentChallenge =
    challenges.find((challenge) => challenge.challengeIndex === currentIndex) ?? null;

  if (!currentChallenge) {
    return challenges.slice(-4).reverse();
  }

  return challenges
    .filter(
      (challenge) =>
        challenge.challengeIndex >= currentIndex && challenge.challengeIndex < currentIndex + 4,
    )
    .reverse();
}

function getRoadNodeTop(index: number, total: number) {
  if (total <= 1) {
    return '78%';
  }

  const start = 10;
  const end = 78;
  const step = (end - start) / (total - 1);
  return `${start + index * step}%`;
}

function RetryCostBadge({ cost }: { cost: number }) {
  return (
    <span aria-label={`${cost} BB Coins`} className="campaign-retry-cost-badge" role="img">
      <img alt="" aria-hidden="true" src={`${import.meta.env.BASE_URL}bbcoin.png`} />
      <strong>{cost}</strong>
    </span>
  );
}

function CampaignActionLabel({
  label,
  retryCost,
}: {
  label: string;
  retryCost?: number | null;
}) {
  return (
    <span className="campaign-action-button-content">
      <span>{label}</span>
      {typeof retryCost === 'number' ? <RetryCostBadge cost={retryCost} /> : null}
    </span>
  );
}

export function CampaignPanel({ currentUserId }: CampaignPanelProps) {
  const originalRecorder = useAudioRecorder({
    audioConstraints: CAMPAIGN_AUDIO_CONSTRAINTS,
    preparedStreamIdleMs: 0,
  });
  const attemptRecorder = useAudioRecorder({
    audioConstraints: CAMPAIGN_AUDIO_CONSTRAINTS,
    preparedStreamIdleMs: 0,
  });
  const { coins, refreshCoins, setCoinBalance, setCoinPreview } = useCoins();
  const [campaignState, setCampaignState] = useState<CampaignState | null>(null);
  const [stage, setStage] = useState<CampaignStage>('overview');
  const [stageChallengeId, setStageChallengeId] = useState<string | null>(null);
  const [isLoadingCampaign, setIsLoadingCampaign] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [originalRecording, setOriginalRecording] = useState<Blob | null>(null);
  const [guideRecording, setGuideRecording] = useState<Blob | null>(null);
  const [attemptRecording, setAttemptRecording] = useState<Blob | null>(null);
  const [reversedAttemptRecording, setReversedAttemptRecording] = useState<Blob | null>(null);
  const [stars, setStars] = useState(0);
  const [campaignReward, setCampaignReward] = useState<CampaignRewardReveal | null>(null);
  const [isAnimatingReward, setIsAnimatingReward] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardFriendsOnly, setLeaderboardFriendsOnly] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<Array<Record<string, unknown>>>([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [asrWarmError, setAsrWarmError] = useState<string | null>(null);
  const [isStartingAttempt, setIsStartingAttempt] = useState(false);
  const [activeAttemptCharge, setActiveAttemptCharge] = useState<{
    charged: boolean;
    cost: number;
  } | null>(null);
  const rewardBaseCoinsRef = useRef(0);

  const resetFlow = useCallback(() => {
    setStage('overview');
    setStageChallengeId(null);
    setOriginalRecording(null);
    setGuideRecording(null);
    setAttemptRecording(null);
    setReversedAttemptRecording(null);
    setStars(0);
    setCampaignReward(null);
    setIsAnimatingReward(false);
    setActiveAttemptCharge(null);
    setIsStartingAttempt(false);
    setError(null);
    setInfo(null);
    setCoinPreview(null);
    originalRecorder.clearRecording();
    attemptRecorder.clearRecording();
  }, [attemptRecorder, originalRecorder, setCoinPreview]);

  const refreshCampaign = useCallback(async (options?: { clearError?: boolean }) => {
    const shouldClearError = options?.clearError ?? true;
    setIsLoadingCampaign(true);

    if (shouldClearError) {
      setError(null);
    }

    try {
      const nextState = (await loadActiveCampaignState(currentUserId)) as CampaignState | null;
      setCampaignState(nextState);
      return nextState;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to load the active campaign.',
      );
      return null;
    } finally {
      setIsLoadingCampaign(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void refreshCampaign();
  }, [refreshCampaign]);

  useEffect(() => () => {
    setCoinPreview(null);
  }, [setCoinPreview]);

  useEffect(() => {
    if (error) {
      console.error('[CampaignPanel]', error);
    }
  }, [error]);

  useEffect(() => {
    if (asrWarmError) {
      console.error('[CampaignPanel][ASR]', asrWarmError);
    }
  }, [asrWarmError]);

  useEffect(() => {
    if (leaderboardError) {
      console.error('[CampaignPanel][Leaderboard]', leaderboardError);
    }
  }, [leaderboardError]);

  useEffect(() => {
    let cancelled = false;

    const warmAsr = async () => {
      try {
        await warmASRScorer();
      } catch (caughtError) {
        if (!cancelled) {
          setAsrWarmError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to warm the browser speech scorer.',
          );
        }
      }
    };

    void warmAsr();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!campaignState?.challenges.length) {
      setStage('overview');
      return;
    }

    const activeChallengeExists = campaignState.challenges.some(
      (challenge) => challenge.challengeIndex === campaignState.progress.currentIndex,
    );

    if (!activeChallengeExists && stage !== 'overview') {
      setStage('overview');
    }
  }, [campaignState, stage]);

  useEffect(() => {
    if (
      !originalRecorder.audioBlob ||
      originalRecorder.isRecording ||
      stage !== 'recording-original'
    ) {
      return;
    }

    let cancelled = false;

    const buildGuide = async () => {
      try {
        const nextGuide = await reverseAudioBlob(originalRecorder.audioBlob as Blob);

        if (cancelled) {
          return;
        }

        setOriginalRecording(originalRecorder.audioBlob);
        setGuideRecording(nextGuide);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to reverse the guide recording.',
          );
        }
      }
    };

    void buildGuide();

    return () => {
      cancelled = true;
    };
  }, [originalRecorder.audioBlob, originalRecorder.isRecording, stage]);

  useEffect(() => {
    if (
      !attemptRecorder.audioBlob ||
      attemptRecorder.isRecording ||
      (stage !== 'recording-attempt' && stage !== 'attempt-ready')
    ) {
      return;
    }

    setAttemptRecording(attemptRecorder.audioBlob);
    if (stage === 'recording-attempt') {
      setStage('attempt-ready');
    }
  }, [attemptRecorder.audioBlob, attemptRecorder.isRecording, stage]);

  const challenges = campaignState?.challenges ?? [];
  const currentIndex = campaignState?.progress.currentIndex ?? 1;
  const completedCount = campaignState?.progress.completedCount ?? 0;
  const currentChallenge =
    challenges.find((challenge) => challenge.challengeIndex === currentIndex) ?? null;
  const activeChallenge =
    (stageChallengeId
      ? challenges.find((challenge) => challenge.id === stageChallengeId) ?? null
      : null) ?? currentChallenge;
  const currentAttemptState =
    activeChallenge?.challengeIndex === currentIndex ? campaignState?.attemptState ?? null : null;
  const title = formatCampaignTitle(campaignState);
  const bannerImage = getAssetValue(campaignState, 'banner_image');
  const challengeIcon = getAssetValue(campaignState, 'challenge_icon');
  const roadChallenges = useMemo(
    () => buildRoadWindow(challenges, currentIndex),
    [challenges, currentIndex],
  );
  const roadRetryCost =
    currentChallenge && requiresRetryCharge(campaignState?.attemptState)
      ? getRetryCost(campaignState?.attemptState)
      : null;
  const currentRetryCost = requiresRetryCharge(currentAttemptState)
    ? getRetryCost(currentAttemptState)
    : null;
  const canStartRetry = hasEnoughCoinsForRetry(currentAttemptState, coins);
  const updateRewardPreview = useCallback(
    (nextDisplayedCoins: number) => {
      setCoinPreview(nextDisplayedCoins);
    },
    [setCoinPreview],
  );
  const handleRewardAnimationComplete = useCallback(() => {
    setIsAnimatingReward(false);
    setCoinPreview(null);
  }, [setCoinPreview]);

  const startOriginalRecording = useCallback(async () => {
    await originalRecorder.prepareRecording();
    await originalRecorder.startRecording();
  }, [originalRecorder]);

  const startAttemptRecording = useCallback(async () => {
    await attemptRecorder.prepareRecording();
    await attemptRecorder.startRecording();
  }, [attemptRecorder]);

  const openAttemptStep = useCallback(() => {
    setError(null);
    setInfo(null);
    setAttemptRecording(null);
    setReversedAttemptRecording(null);
    setStars(0);
    setCampaignReward(null);
    setIsAnimatingReward(false);
    setCoinPreview(null);
    attemptRecorder.clearRecording();
    setStage('attempt-ready');
  }, [attemptRecorder, setCoinPreview]);

  const openGuideStep = useCallback(() => {
    if (!guideRecording) {
      return;
    }

    setError(null);
    setInfo(null);
    setStage('guide');
  }, [guideRecording]);

  const startCampaignAttempt = useCallback(
    async (
      challenge: CampaignChallenge,
      nextStage: Extract<CampaignStage, 'recording-original' | 'recording-attempt'>,
    ) => {
      setIsStartingAttempt(true);
      setError(null);

      try {
        const attemptResult = await consumeCampaignAttempt(challenge.id);
        const attemptWasCharged = Boolean(attemptResult.charged);
        const retryCost = getRetryCost(attemptResult);

        if (typeof attemptResult.currentBalance === 'number') {
          setCoinBalance(attemptResult.currentBalance);
        } else {
          await refreshCoins();
        }

        setCampaignState((current) => {
          if (!current) {
            return current;
          }

          const nextAttempts = current.attempts.some(
            (attempt) => attempt.challengeId === attemptResult.challengeId,
          )
            ? current.attempts.map((attempt) =>
                attempt.challengeId === attemptResult.challengeId ? attemptResult : attempt,
              )
            : [...current.attempts, attemptResult];

          return {
            ...current,
            attemptState:
              challenge.challengeIndex === current.progress.currentIndex
                ? attemptResult
                : current.attemptState,
            attempts: nextAttempts,
          };
        });

        setStageChallengeId(challenge.id);
        setAttemptRecording(null);
        setReversedAttemptRecording(null);
        setStars(0);
        setCampaignReward(null);
        setIsAnimatingReward(false);
        setCoinPreview(null);
        attemptRecorder.clearRecording();

        if (nextStage === 'recording-original') {
          setOriginalRecording(null);
          setGuideRecording(null);
          originalRecorder.clearRecording();
        }

        setActiveAttemptCharge({
          charged: attemptWasCharged,
          cost: retryCost,
        });
        setInfo(attemptWasCharged ? `Retry charged: -${retryCost} BB Coins.` : null);
        setStage(nextStage);
      } catch (caughtError) {
        const nextError =
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to start this campaign attempt.';

        setError(
          nextError,
        );

        try {
          await refreshCampaign({ clearError: false });
        } catch {
          // Keep the original start error visible if the refresh also fails.
        }

        setError((current) => current ?? nextError);
      } finally {
        setIsStartingAttempt(false);
      }
    },
    [
      attemptRecorder,
      originalRecorder,
      refreshCampaign,
      refreshCoins,
      setCoinBalance,
      setCoinPreview,
    ],
  );

  const openChallengeBriefing = useCallback(() => {
    if (!currentChallenge || isStartingAttempt) {
      return;
    }

    if (!hasEnoughCoinsForRetry(currentAttemptState, coins)) {
      setError(`You need ${getRetryCost(currentAttemptState)} BB Coins for another campaign retry.`);
      return;
    }

    void startCampaignAttempt(
      currentChallenge,
      currentChallenge.mode === 'reverse_only' ? 'recording-attempt' : 'recording-original',
    );
  }, [coins, currentAttemptState, currentChallenge, isStartingAttempt, startCampaignAttempt]);

  const startRetryAttempt = useCallback(() => {
    if (!activeChallenge || isStartingAttempt) {
      return;
    }

    if (!hasEnoughCoinsForRetry(currentAttemptState, coins)) {
      setError(`You need ${getRetryCost(currentAttemptState)} BB Coins for another campaign retry.`);
      return;
    }

    void startCampaignAttempt(
      activeChallenge,
      activeChallenge.mode === 'reverse_only' ? 'recording-attempt' : 'recording-original',
    );
  }, [activeChallenge, coins, currentAttemptState, isStartingAttempt, startCampaignAttempt]);

  const startNextChallenge = useCallback(() => {
    if (!currentChallenge || isStartingAttempt) {
      return;
    }

    if (!hasEnoughCoinsForRetry(campaignState?.attemptState ?? null, coins)) {
      setError(`You need ${getRetryCost(campaignState?.attemptState)} BB Coins for another campaign retry.`);
      return;
    }

    void startCampaignAttempt(
      currentChallenge,
      currentChallenge.mode === 'reverse_only' ? 'recording-attempt' : 'recording-original',
    );
  }, [campaignState?.attemptState, coins, currentChallenge, isStartingAttempt, startCampaignAttempt]);

  const handleProcessAttempt = useCallback(async () => {
    if (!activeChallenge || !attemptRecording) {
      return;
    }

    setStage('processing');
    setError(null);

    try {
      const nextReversedAttempt = await reverseAudioBlob(attemptRecording);
      const processedAttemptAudio = await preprocessAudioBlob(nextReversedAttempt);
      const attemptScoreResult = await scoreAudio(processedAttemptAudio, activeChallenge.phrase);
      const nextScore = attemptScoreResult.score;
      const nextStars = attemptScoreResult.stars;
      let rewardResult: {
        challengeId: string;
        rewardAmount: number;
        currentBalance: number | null;
        advanced: boolean;
      };

      rewardBaseCoinsRef.current = coins;

      if (nextStars === 3) {
        const completionResult = await completeCampaignChallenge({
          challengeId: activeChallenge.id,
          stars: nextStars,
          score: nextScore,
        });

        rewardResult = {
          challengeId: completionResult.challengeId,
          rewardAmount: completionResult.rewardAmount,
          currentBalance: completionResult.currentBalance,
          advanced: completionResult.advanced,
        };

        const refreshedCampaignState = await refreshCampaign();

        if (!refreshedCampaignState) {
          console.warn('Unable to refresh campaign state after clearing a challenge.');
        }
      } else {
        const attemptRewardResult = await awardCampaignAttemptReward({
          challengeId: activeChallenge.id,
          stars: nextStars,
          score: nextScore,
        });

        rewardResult = {
          challengeId: attemptRewardResult.challengeId,
          rewardAmount: attemptRewardResult.rewardAmount,
          currentBalance: attemptRewardResult.currentBalance,
          advanced: false,
        };
      }

      setReversedAttemptRecording(nextReversedAttempt);
      setStars(nextStars);

      let nextBalance = rewardResult.currentBalance;

      if (nextBalance === null) {
        try {
          nextBalance = await refreshCoins();
        } catch (refreshError) {
          console.warn('Unable to refresh BB Coins after completing a campaign challenge.', refreshError);
        }
      }

      const resolvedBalance = nextBalance ?? rewardBaseCoinsRef.current + rewardResult.rewardAmount;

      setCampaignReward({
        id: `campaign-reward-${rewardResult.challengeId}`,
        stars: nextStars as CampaignRewardReveal['stars'],
        difficulty: activeChallenge.difficulty,
        rewardAmount: rewardResult.rewardAmount,
        currentBalance: resolvedBalance,
        advanced: rewardResult.advanced,
      });
      setIsAnimatingReward(true);
      setCoinBalance(resolvedBalance);
      updateRewardPreview(rewardBaseCoinsRef.current);
      setStage('reward');

      if (rewardResult.advanced) {
        setInfo(
          activeAttemptCharge?.charged
            ? `Retry charged: -${activeAttemptCharge.cost} BB Coins. Challenge cleared for +${rewardResult.rewardAmount} BB Coins. The next egg is ready on the road.`
            : `Challenge cleared for +${rewardResult.rewardAmount} BB Coins. The next egg is ready on the road.`,
        );
      } else if (activeAttemptCharge?.charged) {
        setInfo(
          `Retry charged: -${activeAttemptCharge.cost} BB Coins. You earned +${rewardResult.rewardAmount} BB Coins, but you still need 3 stars to unlock the next egg.`,
        );
      } else {
        setInfo(
          `You earned +${rewardResult.rewardAmount} BB Coins, but you still need 3 stars to unlock the next egg.`,
        );
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to score this campaign attempt.',
      );
      setStage('attempt-ready');
    }
  }, [
    attemptRecording,
    activeChallenge,
    activeAttemptCharge,
    coins,
    refreshCampaign,
    refreshCoins,
    setCoinBalance,
    setCoinPreview,
    updateRewardPreview,
  ]);

  useEffect(() => {
    if (!leaderboardOpen || !campaignState) {
      return;
    }

    let cancelled = false;

    const loadLeaderboard = async () => {
      setIsLoadingLeaderboard(true);
      setLeaderboardError(null);

      try {
        const nextEntries = (await listCampaignLeaderboard(campaignState.campaign.id, {
          friendsOnly: leaderboardFriendsOnly,
        })) as Array<Record<string, unknown>>;

        if (!cancelled) {
          setLeaderboardEntries(nextEntries);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setLeaderboardError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load the leaderboard.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLeaderboard(false);
        }
      }
    };

    void loadLeaderboard();

    return () => {
      cancelled = true;
    };
  }, [campaignState, leaderboardFriendsOnly, leaderboardOpen]);

  const renderChallengeBody = () => {
    if (!activeChallenge) {
      return (
        <div className="campaign-step-stack">
          <div className="campaign-result-card">
            <div className="campaign-result-hero">
              <div>
                <h3>Campaign Complete</h3>
                <p>You cleared every egg in this month&apos;s campaign.</p>
              </div>
            </div>
          </div>
          <div className="button-row">
            <button className="button primary" onClick={resetFlow} type="button">
              Done
            </button>
          </div>
        </div>
      );
    }



    if (stage === 'recording-original') {
      return (
        <div className="campaign-step-stack">
          <div className="result-box campaign-phrase-card">
            <span className="campaign-phrase-label">Speak this phrase normally</span>
            <strong>{activeChallenge.phrase}</strong>
          </div>
          <ToggleRecordButton
            disabled={false}
            isPreparing={originalRecorder.isPreparing}
            isRecording={originalRecorder.isRecording}
            liveStream={originalRecorder.liveStream}
            onStart={startOriginalRecording}
            onStop={originalRecorder.stopRecording}
          />
          {originalRecording ? (
            <AudioPlayerCard
              blob={originalRecording}
              description="Play the recording forward."
              title="Your forward recording"
            />
          ) : null}
          <div className="button-row">
            <button
              className="button primary"
              disabled={!guideRecording}
              onClick={openGuideStep}
              type="button"
            >
              Continue
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'guide') {
      return (
        <div className="campaign-step-stack">
          <AudioPlayerCard
            blob={guideRecording}
            description="Use this reversed clip as the guide."
            title="Reversed Guide"
          />
          <div className="button-row">
            <button className="button primary" onClick={openAttemptStep} type="button">
              Record Imitation
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'recording-attempt') {
      const backwardExample = buildBackwardPhraseExample(activeChallenge.phrase);

      return (
        <div className="campaign-step-stack">
          <div className="result-box campaign-phrase-card">
            <span className="campaign-phrase-label">
              {activeChallenge.mode === 'reverse_only'
                ? 'Say this phrase backwards out loud'
                : 'Imitate the reversed guide'}
            </span>
            <strong>{activeChallenge.phrase}</strong>
            {activeChallenge.mode === 'reverse_only' ? (
              <p className="campaign-reverse-example">
                Example: "{activeChallenge.phrase}" {'->'} "{backwardExample}"
              </p>
            ) : null}
          </div>
          <ToggleRecordButton
            disabled={false}
            isPreparing={attemptRecorder.isPreparing}
            isRecording={attemptRecorder.isRecording}
            liveStream={attemptRecorder.liveStream}
            onStart={startAttemptRecording}
            onStop={attemptRecorder.stopRecording}
          />
        </div>
      );
    }

    if (stage === 'attempt-ready') {
      return (
        <div className="campaign-step-stack">
          <div className="result-box campaign-phrase-card">
            <span className="campaign-phrase-label">Imitate the reversed guide</span>
            <strong>{activeChallenge.phrase}</strong>
          </div>
          <ToggleRecordButton
            disabled={false}
            isPreparing={attemptRecorder.isPreparing}
            isRecording={attemptRecorder.isRecording}
            liveStream={attemptRecorder.liveStream}
            onStart={startAttemptRecording}
            onStop={attemptRecorder.stopRecording}
          />
          {attemptRecording ? (
            <AudioPlayerCard
              blob={attemptRecording}
              description="Replay your latest attempt before it is scored."
              title="Attempt Preview"
            />
          ) : null}
          <div className="button-row">
            <button
              className="button primary"
              disabled={!attemptRecording}
              onClick={() => void handleProcessAttempt()}
              type="button"
            >
              Submit
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'processing') {
      return (
        <div className="round-loader-callout" aria-live="polite" role="status">
          <WaveformLoader className="round-loader-callout-spinner" size={92} strokeWidth={3.6} />
          <div>
            <strong>Scoring challenge...</strong>
            <p>Reversing audio, running the browser speech model, and computing phrase probability.</p>
          </div>
        </div>
      );
    }

    if (stage === 'reward' && campaignReward) {

      return (
        <div className="campaign-step-stack reward-stage-step">
          <RoundRewardSequence
            baseCoins={rewardBaseCoinsRef.current}
            onAnimationComplete={handleRewardAnimationComplete}
            onDisplayedCoinsChange={updateRewardPreview}
            reward={campaignReward}
            startCompleted={!isAnimatingReward}
          >
            {reversedAttemptRecording ? (
              <AudioPlayerCard
                blob={reversedAttemptRecording}
                description="This reversed clip was converted back to forward speech and scored in the browser."
                title="Scoring Audio"
              />
            ) : null}
            <div className="button-row">
              <button className="button secondary" onClick={resetFlow} type="button">
                Done
              </button>
              <button
                className="button primary"
                disabled={
                  isAnimatingReward ||
                  isStartingAttempt ||
                  (!campaignReward.advanced && !canStartRetry)
                }
                onClick={campaignReward.advanced ? startNextChallenge : startRetryAttempt}
                type="button"
              >
                {campaignReward.advanced ? 'Next Challenge' : isStartingAttempt ? (
                  'Starting...'
                ) : (
                  <CampaignActionLabel label="Try Again" retryCost={currentRetryCost} />
                )}
              </button>
            </div>
          </RoundRewardSequence>
        </div>
      );
    }

    if (stage === 'result') {
      return (
        <div className="campaign-step-stack">
          <div className="campaign-result-card">
            <div className="campaign-result-hero">
              <div>
                <h3>{stars === 3 ? 'Challenge Cleared' : 'Try Again'}</h3>
                <p>
                  {stars === 3
                    ? 'You earned the full 3 stars and unlocked the next egg.'
                    : 'You need all 3 stars to open the next challenge.'}
                </p>
              </div>
              <div className="campaign-result-stars">
                <strong>{stars} / 3 stars</strong>
                <StarRating label={`Campaign result ${stars} out of 3 stars`} value={stars} />
              </div>
            </div>
          </div>
          <div className="audio-grid">
            <AudioPlayerCard
              blob={attemptRecording}
              description="Your recorded attempt."
              title="Attempt Audio"
            />
            <AudioPlayerCard
              blob={reversedAttemptRecording}
              description="This reversed clip was converted back to forward speech and scored in the browser."
              title="Scoring Audio"
            />
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={resetFlow} type="button">
              Done
            </button>
            {stars < 3 ? (
              <button
                className="button primary"
                disabled={isStartingAttempt || !canStartRetry}
                onClick={startRetryAttempt}
                type="button"
              >
                {isStartingAttempt ? (
                  'Starting...'
                ) : (
                  <CampaignActionLabel label="Try Again" retryCost={currentRetryCost} />
                )}
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="campaign-step-stack">
        <div className="empty-state compact-empty">
          Press Play from the road to begin the next challenge.
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="surface round-screen campaign-screen">
        <div aria-hidden="true" className="campaign-floating-field">
          {FLOATING_EGGS.map((egg) => (
            <span
              className="campaign-floating-egg"
              key={`${egg.top}-${egg.left}`}
              style={{
                top: egg.top,
                left: egg.left,
                width: `${egg.size}px`,
                height: `${egg.size * 1.2}px`,
                animationDelay: egg.delay,
              }}
            >
              {challengeIcon ? (
                <img alt="" aria-hidden="true" src={challengeIcon} />
              ) : (
                <span className="campaign-floating-egg-shape" />
              )}
            </span>
          ))}
        </div>

        {stage === 'overview' ? (
          <div className="campaign-road-page">
            {info ? <div className="success-banner">{info}</div> : null}

            {isLoadingCampaign ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader className="round-loader-callout-spinner" size={92} strokeWidth={3.6} />
                <div>
                  <strong>Loading campaign...</strong>
                  <p>Fetching the active month, challenge road, and your progress.</p>
                </div>
              </div>
            ) : !campaignState ? (
              <div className="empty-state compact-empty">No active campaign is available.</div>
            ) : (
              <>
                <div className="campaign-banner-card">
                  {bannerImage ? (
                    <img
                      alt=""
                      aria-hidden="true"
                      className="campaign-banner-image"
                      src={bannerImage}
                    />
                  ) : (
                    <div aria-hidden="true" className="campaign-banner-fallback" />
                  )}
                </div>

                <div className="campaign-road-stage">
                  <div className="campaign-road-stage-inner">
                    <div className="campaign-road-viewer">
                      <button
                        aria-label="Open leaderboard"
                        className="campaign-side-action"
                        onClick={() => setLeaderboardOpen(true)}
                        type="button"
                      >
                        <LeaderboardIcon />
                        <span>Ranks</span>
                      </button>

                      <div className="campaign-road-line" />

                      {roadChallenges.map((challenge, index) => {
                        const state = getChallengeState(
                          challenge.challengeIndex,
                          currentIndex,
                          completedCount,
                        );

                        return (
                          <div
                            className={`campaign-road-node campaign-road-node-${state}`}
                            key={challenge.id}
                            style={{ top: getRoadNodeTop(index, roadChallenges.length) }}
                          >
                            <span className="campaign-road-node-icon">
                              {challengeIcon ? (
                                <img alt="" aria-hidden="true" src={challengeIcon} />
                              ) : null}
                              <strong>{challenge.challengeIndex}</strong>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {currentChallenge ? (
                  <div className="campaign-current-difficulty">
                    <span>{formatDifficultyLabel(currentChallenge.difficulty)}</span>
                    <strong>
                      {currentChallenge.mode === 'reverse_only' ? 'Reverse Only' : 'Normal'}
                    </strong>
                  </div>
                ) : null}

                <div className="campaign-road-cta">
                  <button
                    className="campaign-start-button"
                    disabled={!currentChallenge || isStartingAttempt}
                    onClick={openChallengeBriefing}
                    type="button"
                  >
                    {currentChallenge ? (
                      <CampaignActionLabel label="Play" retryCost={roadRetryCost} />
                    ) : (
                      'Campaign Complete'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="campaign-play-page">
            {info ? <div className="success-banner">{info}</div> : null}

            {activeChallenge ? (
              <div className="campaign-play-header">
                <div className="campaign-play-icon compact">
                  {challengeIcon ? <img alt="" aria-hidden="true" src={challengeIcon} /> : null}
                  <strong>{activeChallenge.challengeIndex}</strong>
                </div>
              </div>
            ) : null}

            <div className="campaign-focus-card campaign-play-card">{renderChallengeBody()}</div>
          </div>
        )}
      </section>

      {leaderboardOpen && campaignState ? (
        <div
          className="campaign-leaderboard-backdrop"
          onClick={() => setLeaderboardOpen(false)}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="campaign-leaderboard-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="campaign-leaderboard-header">
              <div>
                <div className="eyebrow">Leaderboard</div>
                <h3>{title}</h3>
                <p>Ranked by completed challenge count.</p>
              </div>
              <button className="button ghost" onClick={() => setLeaderboardOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="campaign-leaderboard-filters">
              <button
                className={`button ${leaderboardFriendsOnly ? 'secondary' : 'primary'}`}
                onClick={() => setLeaderboardFriendsOnly(false)}
                type="button"
              >
                Global
              </button>
              <button
                className={`button ${leaderboardFriendsOnly ? 'primary' : 'secondary'}`}
                onClick={() => setLeaderboardFriendsOnly(true)}
                type="button"
              >
                Friends
              </button>
            </div>

            {isLoadingLeaderboard ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader className="round-loader-callout-spinner" size={82} strokeWidth={3.4} />
                <div>
                  <strong>Loading leaderboard...</strong>
                </div>
              </div>
            ) : (
              <div className="campaign-leaderboard-list" role="list">
                {leaderboardEntries.map((entry, index) => {
                  const username =
                    typeof entry.username === 'string'
                      ? entry.username
                      : typeof entry.user_username === 'string'
                        ? entry.user_username
                        : 'player';
                  const progress =
                    typeof entry.completedCount === 'number'
                      ? entry.completedCount
                      : Number(entry.completed_count ?? 0);

                  return (
                    <div className="campaign-leaderboard-row" key={`${username}-${index}`} role="listitem">
                      <span className="campaign-leaderboard-rank">#{index + 1}</span>
                      <strong>{username}</strong>
                      <span>{progress} cleared</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
