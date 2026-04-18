import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useObjectUrl } from '../../../audio/hooks/useObjectUrl';
import { useReversedAudio } from '../../../audio/hooks/useReversedAudio';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { WaveformLoader } from '../../../components/WaveformLoader';
import { WaveformPlayButton, type PlaybackStartKind } from '../../../components/WaveformPlayButton';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { useCoins } from '../../resources/ResourceProvider';
import {
  formatCampaignCurrencyLabel,
  listCampaignCatalog,
  type CampaignCatalogEntry,
} from '../../../lib/campaigns';
import { claimReward, getRoundReward } from '../../../lib/roundRewards';
import {
  consumeRoundListen,
  extraListenCost,
  freeListenLimitByDifficulty,
  getRoundListenState,
  markRoundResultsViewed,
  saveRoundAttempt,
  submitRoundGuess,
} from '../../../lib/rounds';
import { getRoundSummary, getScorePresentation } from '../scorePresentation';
import type { Round, RoundListenState, RoundReward } from '../types';
import { RoundRewardSequence } from './RoundRewardSequence';

interface PlayRoundPanelProps {
  currentUserId: string;
  isLoadingRound?: boolean;
  round: Round | null;
  onArchiveRound: (round: Round) => Promise<void>;
  onBack: () => void;
  onComposeNextRound: () => void;
  onUpdateRound: (roundId: string, updater: (round: Round) => Round) => void;
}

type RecipientStage = 'listen' | 'record' | 'guess' | 'reveal';

function getRecipientStage(options: {
  hasAttempt: boolean;
  hasConfirmedListen: boolean;
  hasUnsavedAttempt: boolean;
  isSavingAttempt: boolean;
  isRecording: boolean;
  isComplete: boolean;
}): RecipientStage {
  const {
    hasAttempt,
    hasConfirmedListen,
    hasUnsavedAttempt,
    isSavingAttempt,
    isRecording,
    isComplete,
  } = options;

  if (isComplete) {
    return 'reveal';
  }

  if (hasAttempt) {
    return 'guess';
  }

  if (isRecording || hasUnsavedAttempt || isSavingAttempt || hasConfirmedListen) {
    return 'record';
  }

  return 'listen';
}

function getRecipientStepLabel(stage: RecipientStage) {
  switch (stage) {
    case 'listen':
      return 'Step 1 of 4';
    case 'record':
      return 'Step 2 of 4';
    case 'guess':
      return 'Step 3 of 4';
    case 'reveal':
      return 'Step 4 of 4';
  }
}

function getRewardAnimationStorageKey(userId: string, roundId: string) {
  return `backtalk:round-reward:${userId}:${roundId}`;
}

function hasStartedRewardAnimation(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.sessionStorage.getItem(getRewardAnimationStorageKey(userId, roundId)) === 'started';
}

function markRewardAnimationStarted(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getRewardAnimationStorageKey(userId, roundId), 'started');
}

function clearRewardAnimationState(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(getRewardAnimationStorageKey(userId, roundId));
}

function formatListenLabel(count: number) {
  return `${count} listen${count === 1 ? '' : 's'}`;
}

function logRewardDebug(message: string, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }

  if (details) {
    console.info('[reward-debug]', message, details);
    return;
  }

  console.info('[reward-debug]', message);
}

function RewardPlaybackButton({
  blob,
  isLoading = false,
  loadingLabel = 'Preparing audio...',
  remoteUrl,
}: {
  blob?: Blob | null;
  isLoading?: boolean;
  loadingLabel?: string;
  remoteUrl?: string | null;
}) {
  const objectUrl = useObjectUrl(blob);
  const src = objectUrl ?? remoteUrl ?? null;

  if (!src) {
    return (
      <div className="empty-state compact-empty reward-review-empty">
        {isLoading ? loadingLabel : 'No audio available yet.'}
      </div>
    );
  }

  return (
    <div className="reward-review-playback">
      <WaveformPlayButton className="reward-review-play-button" size={86} src={src} />
    </div>
  );
}

export function PlayRoundPanel({
  currentUserId,
  isLoadingRound = false,
  round,
  onArchiveRound,
  onBack,
  onComposeNextRound,
  onUpdateRound,
}: PlayRoundPanelProps) {
  const recorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const {
    coins,
    isLoadingCoins,
    refreshCoins,
    setCoinBalance,
    setCoinPreview,
    setResourceBalance,
  } = useCoins();
  const [guess, setGuess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isLoadingReward, setIsLoadingReward] = useState(false);
  const [isAnimatingReward, setIsAnimatingReward] = useState(false);
  const [isAwaitingRewardContinue, setIsAwaitingRewardContinue] = useState(false);
  const [isClaimingReward, setIsClaimingReward] = useState(false);
  const [roundReward, setRoundReward] = useState<RoundReward | null>(null);
  const [campaignCatalog, setCampaignCatalog] = useState<CampaignCatalogEntry[]>([]);
  const [listenState, setListenState] = useState<RoundListenState | null>(null);
  const [isLoadingListenState, setIsLoadingListenState] = useState(false);
  const [isAuthorizingListenPlayback, setIsAuthorizingListenPlayback] = useState(false);
  const [hasConfirmedListen, setHasConfirmedListen] = useState(false);
  const lastSavedAttemptBlobRef = useRef<Blob | null>(null);
  const rewardBaseCoinsRef = useRef(0);
  const loadedRewardRoundIdRef = useRef<string | null>(null);

  useEffect(() => {
    setGuess(round?.guess ?? '');
    setError(null);
    setHasConfirmedListen(false);
    recorder.clearRecording();
    lastSavedAttemptBlobRef.current = null;
    setRoundReward(null);
    setIsLoadingReward(round?.status === 'complete');
    setIsAnimatingReward(false);
    setIsAwaitingRewardContinue(false);
    setIsClaimingReward(false);
    setListenState(null);
    setIsLoadingListenState(false);
    setIsAuthorizingListenPlayback(false);
    rewardBaseCoinsRef.current = coins;
    loadedRewardRoundIdRef.current = null;
    setCoinPreview(null);
  }, [currentUserId, round?.id, round?.status, recorder.clearRecording, setCoinPreview]);

  useEffect(() => {
    let cancelled = false;

    const loadCampaigns = async () => {
      try {
        const nextCatalog = await listCampaignCatalog();

        if (!cancelled) {
          setCampaignCatalog(nextCatalog);
        }
      } catch (catalogError) {
        if (!cancelled) {
          console.warn('Unable to load campaign catalog for reward metadata.', catalogError);
        }
      }
    };

    void loadCampaigns();

    return () => {
      cancelled = true;
    };
  }, []);

  const isRecipient = Boolean(round && round.recipientId === currentUserId);
  const hasAttempt = Boolean(round && (round.attemptAudioBlob || round.attemptAudioUrl));
  const {
    reversedBlob: reversedPromptBlob,
    isLoading: isLoadingReversedPrompt,
    error: reversedPromptError,
  } = useReversedAudio({
    blob: round?.originalAudioBlob,
    enabled: Boolean(round?.originalAudioBlob || round?.originalAudioUrl),
    remoteUrl: round?.originalAudioUrl,
  });
  const {
    reversedBlob: reversedAttemptBlob,
    isLoading: isLoadingReversedAttempt,
    error: reversedAttemptError,
  } = useReversedAudio({
    blob: round?.attemptAudioBlob,
    enabled: Boolean(round?.attemptAudioBlob || round?.attemptAudioUrl),
    remoteUrl: round?.attemptAudioUrl,
  });
  const hasUnsavedAttempt = Boolean(
    recorder.audioBlob && lastSavedAttemptBlobRef.current !== recorder.audioBlob,
  );
  const scorePresentation = round ? getScorePresentation(round.score) : null;
  const roundSummary = round ? getRoundSummary(round, isRecipient) : null;
  const recipientStage = round
    ? getRecipientStage({
        hasAttempt,
        hasConfirmedListen,
        hasUnsavedAttempt,
        isSavingAttempt,
        isRecording: recorder.isRecording,
        isComplete: round.status === 'complete',
      })
    : 'listen';
  const isCompletedRound = round?.status === 'complete';
  const isRewardStepOpen = Boolean(isCompletedRound);
  const includedFreeListenLimit = round ? freeListenLimitByDifficulty[round.difficulty] : 0;
  const effectiveFreeListenLimit = listenState?.freeLimit ?? includedFreeListenLimit;
  const listenUsageCount = listenState?.listenCount ?? 0;
  const paidListenCount =
    listenState?.paidListenCount ?? Math.max(0, listenUsageCount - effectiveFreeListenLimit);
  const freeListenCountRemaining = Math.max(0, effectiveFreeListenLimit - listenUsageCount);
  const nextListenReplayCost = listenState?.nextPlayCost ?? extraListenCost;
  const listenPlaybackHelperText = !round
    ? ''
    : isLoadingReversedPrompt
      ? 'Preparing the reversed prompt from the saved recording.'
      : isLoadingListenState
      ? 'Checking your free replay limit.'
      : freeListenCountRemaining > 0
        ? `${formatListenLabel(freeListenCountRemaining)} free out of ${formatListenLabel(effectiveFreeListenLimit)} remaining. Extra replays cost ${nextListenReplayCost} BB Coins each.`
        : paidListenCount > 0
          ? `Free listens are used up. You have already bought ${formatListenLabel(paidListenCount)}. Each new replay costs ${nextListenReplayCost} BB Coins.`
          : `Free listens are used up. Each new replay costs ${nextListenReplayCost} BB Coins.`;

  const canSubmitGuess = useMemo(
    () =>
      Boolean(round && isRecipient && hasAttempt && reversedAttemptBlob && guess.trim()) &&
      round?.status !== 'complete' &&
      !isLoadingReversedAttempt &&
      !isSavingAttempt &&
      !isSubmittingGuess,
    [
      guess,
      hasAttempt,
      isLoadingReversedAttempt,
      isRecipient,
      isSavingAttempt,
      isSubmittingGuess,
      reversedAttemptBlob,
      round,
    ],
  );
  const isRewardBusy = isAnimatingReward || isClaimingReward;
  const hasPendingReward = Boolean(roundReward && !roundReward.claimed);
  const shouldShowRewardSequence = hasPendingReward && (isAnimatingReward || isAwaitingRewardContinue);
  const rewardCampaignEntry = useMemo(() => {
    if (!round?.packId && !roundReward?.campaignId && !roundReward?.bonusResourceType) {
      return null;
    }

    return (
      campaignCatalog.find((entry) => {
        if (roundReward?.campaignId && entry.campaign.id === roundReward.campaignId) {
          return true;
        }

        if (round?.packId && entry.campaign.rewardPackId === round.packId) {
          return true;
        }

        return (
          roundReward?.bonusResourceType !== null &&
          roundReward?.bonusResourceType !== undefined &&
          entry.currency?.resourceType === roundReward.bonusResourceType
        );
      }) ?? null
    );
  }, [campaignCatalog, round?.packId, roundReward?.bonusResourceType, roundReward?.campaignId]);
  const rewardCampaignCurrency = rewardCampaignEntry?.currency ?? null;
  const rewardCampaignIcon = rewardCampaignEntry?.assets.challenge_icon ?? null;

  const updateRewardPreview = useCallback(
    (nextDisplayedCoins: number) => {
      setCoinPreview(nextDisplayedCoins);
    },
    [setCoinPreview],
  );

  const settleClaimedReward = useCallback(
    async (
      rewardToSettle: RoundReward,
      options: {
        claimedNow: boolean;
        currentBalance: number | null;
        bonusResourceCurrentBalance: number | null;
      },
    ) => {
      if (options.currentBalance !== null) {
        setCoinBalance(options.currentBalance);
      } else {
        try {
          await refreshCoins();
        } catch (refreshError) {
          console.warn('Unable to refresh BB Coins after claiming a round reward.', refreshError);
        }
      }

      if (
        rewardToSettle.bonusResourceType &&
        typeof options.bonusResourceCurrentBalance === 'number'
      ) {
        setResourceBalance(
          rewardToSettle.bonusResourceType,
          options.bonusResourceCurrentBalance,
        );
      }

      setRoundReward({ ...rewardToSettle, claimed: true });
      setIsAnimatingReward(false);
      setIsAwaitingRewardContinue(false);
      setIsClaimingReward(false);
      setCoinPreview(null);
      clearRewardAnimationState(currentUserId, rewardToSettle.roundId);
    },
    [
      currentUserId,
      refreshCoins,
      rewardCampaignCurrency,
      setCoinBalance,
      setCoinPreview,
      setResourceBalance,
    ],
  );

  const handleRewardAnimationComplete = useCallback(
    (rewardToPreview: RoundReward) => {
      setIsAnimatingReward(false);
      setIsAwaitingRewardContinue(true);
      updateRewardPreview(rewardBaseCoinsRef.current + rewardToPreview.rewardAmount);
    },
    [updateRewardPreview],
  );

  const finalizePendingRewardClaim = useCallback(
    async (rewardToClaim: RoundReward) => {
      setIsAwaitingRewardContinue(false);
      setIsAnimatingReward(false);
      setIsClaimingReward(true);

      try {
        const claimResult = await claimReward(currentUserId, rewardToClaim.roundId);

        if (!claimResult) {
          setRoundReward(null);
          setIsClaimingReward(false);
          setCoinPreview(null);
          clearRewardAnimationState(currentUserId, rewardToClaim.roundId);
          return true;
        }

        await settleClaimedReward(claimResult.reward, {
          claimedNow: claimResult.claimedNow,
          currentBalance: claimResult.currentBalance,
          bonusResourceCurrentBalance: claimResult.bonusResourceCurrentBalance,
        });
        return true;
      } catch (caughtError) {
        setIsAwaitingRewardContinue(true);
        setIsClaimingReward(false);
        setCoinPreview(null);
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to claim the round reward.',
        );
        return false;
      }
    },
    [currentUserId, settleClaimedReward, setCoinPreview],
  );

  const saveAttempt = async (
    currentRound: Round,
    attemptBlob: Blob,
    options: { cancelled?: () => boolean } = {},
  ) => {
    const { cancelled } = options;

    if (currentRound.recipientId !== currentUserId) {
      return;
    }

    setError(null);
    setIsSavingAttempt(true);

    try {
      const savedRound = await saveRoundAttempt({
        currentUserId,
        roundId: currentRound.id,
        attemptAudioBlob: attemptBlob,
      });

      if (cancelled?.()) {
        return;
      }

      onUpdateRound(currentRound.id, (existingRound) => ({
        ...savedRound,
        originalAudioBlob: existingRound.originalAudioBlob,
        attemptAudioBlob: attemptBlob,
      }));
      lastSavedAttemptBlobRef.current = attemptBlob;
      recorder.clearRecording();
    } catch (caughtError) {
      if (!cancelled?.()) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to save the attempt recording.',
        );
      }
    } finally {
      if (!cancelled?.()) {
        setIsSavingAttempt(false);
      }
    }
  };

  useEffect(() => {
    if (
      !round ||
      !isRecipient ||
      !recorder.audioBlob ||
      recorder.isRecording ||
      round.status === 'complete'
    ) {
      return;
    }

    const attemptBlob = recorder.audioBlob;

    if (lastSavedAttemptBlobRef.current === attemptBlob) {
      return;
    }

    let cancelled = false;

    void saveAttempt(round, attemptBlob, { cancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, isRecipient, onUpdateRound, recorder.audioBlob, recorder.isRecording, round]);

  useEffect(() => {
    if (!round || !isRecipient || round.status !== 'waiting_for_attempt') {
      setListenState(null);
      setIsLoadingListenState(false);
      return;
    }

    let cancelled = false;

    const loadListenState = async () => {
      setIsLoadingListenState(true);

      try {
        const nextListenState = await getRoundListenState(round.id);

        if (cancelled) {
          return;
        }

        setListenState(nextListenState);
        setCoinBalance(nextListenState.currentBalance);
      } catch (listenStateError) {
        if (!cancelled) {
          console.warn('Unable to load the round listen state.', listenStateError);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingListenState(false);
        }
      }
    };

    void loadListenState();

    return () => {
      cancelled = true;
    };
  }, [isRecipient, round?.id, round?.status, setCoinBalance]);

  useEffect(() => {
    if (!round || round.status !== 'complete' || !currentUserId || isLoadingCoins || !isRewardStepOpen) {
      if (round?.status === 'complete') {
        logRewardDebug('Skipped reward load before fetch.', {
          currentUserId,
          isLoadingCoins,
          isRewardStepOpen,
          loadedRewardRoundId: loadedRewardRoundIdRef.current,
          roundId: round.id,
        });
      }

      return;
    }

    if (loadedRewardRoundIdRef.current === round.id) {
      logRewardDebug('Skipped reward load because the round is already marked as loaded.', {
        loadedRewardRoundId: loadedRewardRoundIdRef.current,
        roundId: round.id,
      });
      return;
    }

    loadedRewardRoundIdRef.current = round.id;
    let cancelled = false;
    let didFinishLoading = false;

    const loadRoundReward = async () => {
      logRewardDebug('Starting reward load.', {
        coins,
        currentUserId,
        roundId: round.id,
      });
      setIsLoadingReward(true);

      try {
        try {
          await markRoundResultsViewed(round.id);
          logRewardDebug('Marked completed round as viewed.', {
            roundId: round.id,
          });
        } catch (markViewedError) {
          console.warn('Unable to mark the completed round as viewed.', markViewedError);
          logRewardDebug('Failed to mark completed round as viewed.', {
            error:
              markViewedError instanceof Error ? markViewedError.message : String(markViewedError),
            roundId: round.id,
          });
        }

        const reward = await getRoundReward(currentUserId, round.id);
        logRewardDebug('Reward query completed.', {
          rewardClaimed: reward?.claimed ?? null,
          rewardId: reward?.id ?? null,
          rewardRoundId: reward?.roundId ?? null,
          rewardValue: reward?.rewardAmount ?? null,
          roundId: round.id,
        });

        if (cancelled) {
          logRewardDebug('Discarded reward result because the effect was cancelled.', {
            roundId: round.id,
          });
          return;
        }

        setRoundReward(reward);
        rewardBaseCoinsRef.current = coins;

        if (!reward) {
          setCoinPreview(null);
          return;
        }

        if (reward.claimed) {
          setIsAnimatingReward(false);
          setIsAwaitingRewardContinue(false);
          setCoinPreview(null);
          clearRewardAnimationState(currentUserId, round.id);
          return;
        }

        if (hasStartedRewardAnimation(currentUserId, round.id)) {
          updateRewardPreview(coins + reward.rewardAmount);
          setIsAnimatingReward(false);
          setIsAwaitingRewardContinue(true);
          return;
        }

        updateRewardPreview(coins);
        markRewardAnimationStarted(currentUserId, round.id);
        setIsAwaitingRewardContinue(false);
        setIsAnimatingReward(true);
      } catch (caughtError) {
        if (!cancelled) {
          logRewardDebug('Reward load failed.', {
            error: caughtError instanceof Error ? caughtError.message : String(caughtError),
            roundId: round.id,
          });
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load the round reward.',
          );
        }
      } finally {
        if (!cancelled) {
          didFinishLoading = true;
          setIsLoadingReward(false);
        }
      }
    };

    void loadRoundReward();

    return () => {
      cancelled = true;
      logRewardDebug('Reward load cleanup ran.', {
        didFinishLoading,
        loadedRewardRoundId: loadedRewardRoundIdRef.current,
        roundId: round.id,
      });

      if (!didFinishLoading && loadedRewardRoundIdRef.current === round.id) {
        loadedRewardRoundIdRef.current = null;
        logRewardDebug('Cleared loaded reward round id after cancellation.', {
          roundId: round.id,
        });
      }
    };
  }, [
    coins,
    currentUserId,
    isRewardStepOpen,
    isLoadingCoins,
    round?.id,
    round?.status,
    setCoinPreview,
    updateRewardPreview,
  ]);

  const handleSubmitGuess = async () => {
    const currentRound = round;
    const nextGuess = guess.trim();
    if (!currentRound || !nextGuess || !isRecipient) {
      return;
    }

    setError(null);
    setIsSubmittingGuess(true);

    try {
      const updatedRound = await submitRoundGuess({
        roundId: currentRound.id,
        guess: nextGuess,
        correctPhrase: currentRound.correctPhrase,
        difficulty: currentRound.difficulty,
      });

      onUpdateRound(currentRound.id, (existingRound) => ({
        ...updatedRound,
        originalAudioBlob: existingRound.originalAudioBlob,
        attemptAudioBlob: existingRound.attemptAudioBlob,
      }));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to submit the guess.',
      );
    } finally {
      setIsSubmittingGuess(false);
    }
  };

  const handleListenPlaybackRequest = useCallback(
    async (playbackStartKind: PlaybackStartKind) => {
      if (playbackStartKind === 'resume') {
        return true;
      }

      if (!round || round.recipientId !== currentUserId) {
        return false;
      }

      setError(null);
      setIsAuthorizingListenPlayback(true);

      try {
        const nextListenState = await consumeRoundListen(round.id);
        setListenState(nextListenState);
        setCoinBalance(nextListenState.currentBalance);
        setCoinPreview(null);

        return true;
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to authorize this replay.',
        );
        return false;
      } finally {
        setIsAuthorizingListenPlayback(false);
      }
    },
    [currentUserId, round, setCoinBalance, setCoinPreview],
  );

  if (!round) {
    return (
      <section className="surface round-screen">
        <div className="round-screen-header">
          <button className="button ghost round-screen-back" onClick={onBack} type="button">
            Back
          </button>
          <div className="round-screen-copy">
            <div className="eyebrow">Round</div>
            <h2>{isLoadingRound ? 'Loading thread' : 'No active round'}</h2>
            <p>
              {isLoadingRound
                ? 'Fetching the current round and secure audio links for this thread.'
                : 'Pick a friend from home to open the current thread.'}
            </p>
          </div>
        </div>
        {isLoadingRound ? (
          <div className="round-screen-body">
            <div className="round-loader-callout" aria-live="polite" role="status">
              <WaveformLoader className="round-loader-callout-spinner" size={92} strokeWidth={3.6} />
              <div>
                <strong>Loading round...</strong>
                <p>Preparing the latest audio for playback.</p>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const activeRound = round;
  const showRewardPage = activeRound.status === 'complete';
  const isSenderRewardPage = showRewardPage && !isRecipient;
  const rewardResultSummary =
    isRecipient && activeRound.status === 'complete' && scorePresentation ? (
      <div className="reward-reveal-details">
        <p>
          <strong>You guessed:</strong> {activeRound.guess || 'No guess submitted'}
        </p>
        <p>
          <strong>{activeRound.senderUsername} said:</strong> {activeRound.correctPhrase}
        </p>
      </div>
    ) : null;
  const senderRewardReview = isSenderRewardPage ? (
    <div className="reward-review-stack">
      <div className="reward-review-block">
        <p className="reward-review-line">
          <span className="reward-review-label">You said:</span>
          <strong className="reward-review-phrase">{activeRound.correctPhrase}</strong>
        </p>
        <p className="reward-review-line reward-review-line-guess">
          <span className="reward-review-label">{activeRound.recipientUsername} guessed:</span>
          <strong className="reward-review-phrase">{activeRound.guess || 'No guess submitted'}</strong>
        </p>
        <RewardPlaybackButton
          blob={activeRound.originalAudioBlob}
          remoteUrl={activeRound.originalAudioUrl}
        />
      </div>

      <div className="reward-review-block">
        <p className="reward-review-line">{activeRound.recipientUsername} heard:</p>
        <RewardPlaybackButton
          blob={reversedPromptBlob}
          isLoading={isLoadingReversedPrompt}
          loadingLabel="Preparing reversed prompt..."
        />
      </div>

      <div className="reward-review-block">
        <p className="reward-review-line">{activeRound.recipientUsername} Babbled:</p>
        <RewardPlaybackButton
          blob={activeRound.attemptAudioBlob}
          remoteUrl={activeRound.attemptAudioUrl}
        />
      </div>

      <div className="reward-review-block">
        <p className="reward-review-line">{activeRound.recipientUsername} Babble reversed:</p>
        <RewardPlaybackButton
          blob={reversedAttemptBlob}
          isLoading={isLoadingReversedAttempt}
          loadingLabel="Preparing reversed take..."
        />
      </div>
    </div>
  ) : null;
  const headerEyebrow = isRecipient
    ? recipientStage === 'reveal'
      ? 'Reward Reveal'
      : getRecipientStepLabel(recipientStage)
    : showRewardPage
      ? 'Reward Review'
      : 'Round Review';
  const headerTitle = isRecipient
    ? recipientStage === 'reveal'
      ? (roundSummary?.headline ?? 'Round')
      : (roundSummary?.headline ?? 'Round')
    : (roundSummary?.headline ?? 'Round');
  const headerDescription = isRecipient
    ? recipientStage === 'reveal'
      ? 'See the score, compare the phrase, and bank your BB Coins when you continue.'
      : (roundSummary?.description ?? '')
    : showRewardPage
      ? 'This screen settles your BB Coin reward for the round.'
      : (roundSummary?.description ?? '');
  const roundScreenClassName = showRewardPage ? 'round-screen round-screen-reward' : 'surface round-screen';

  const handleReadyToImitate = async () => {
    await recorder.prepareRecording();
    setHasConfirmedListen(true);
  };

  const handleRecipientContinue = async () => {
    if (isRewardBusy) {
      return;
    }

    setError(null);

    if (roundReward && !roundReward.claimed) {
      const didClaimReward = await finalizePendingRewardClaim(roundReward);

      if (!didClaimReward) {
        return;
      }
    }

    onComposeNextRound();
  };

  const handleArchiveRound = async () => {
    if (!round) {
      return;
    }

    if (isRewardBusy) {
      return;
    }

    setError(null);
    setIsArchiving(true);

    try {
      if (roundReward && !roundReward.claimed) {
        const didClaimReward = await finalizePendingRewardClaim(roundReward);

        if (!didClaimReward) {
          setIsArchiving(false);
          return;
        }
      }

      await onArchiveRound(round);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to continue the thread right now.',
      );
      setIsArchiving(false);
      return;
    }

    setIsArchiving(false);
  };

  const reviewAudioGrid = (
    <div className="audio-grid">
      <AudioPlayerCard
        title="Your original prompt"
        description="The forward recording that started this round."
        blob={activeRound.originalAudioBlob}
        remoteUrl={activeRound.originalAudioUrl}
      />
      <AudioPlayerCard
        title="Your reversed prompt"
        description="Generated locally from your saved forward prompt."
        blob={reversedPromptBlob}
        isLoading={isLoadingReversedPrompt}
        loadingLabel="Preparing reversed prompt..."
      />
      <AudioPlayerCard
        title="Their imitation"
        description="Your friend's attempt at copying the reversed prompt."
        blob={activeRound.attemptAudioBlob}
        remoteUrl={activeRound.attemptAudioUrl}
      />
      <AudioPlayerCard
        title="Their imitation reversed"
        description="Generated locally from their saved forward take."
        blob={reversedAttemptBlob}
        isLoading={isLoadingReversedAttempt}
        loadingLabel="Preparing reversed take..."
      />
    </div>
  );

  const rewardStatusCard =
    activeRound.status === 'complete' && roundReward ? (
      <RoundRewardSequence
        baseCoins={rewardBaseCoinsRef.current}
        bonusReward={
          roundReward.bonusResourceType && rewardCampaignCurrency && rewardCampaignIcon
            ? {
                amount: roundReward.bonusRewardAmount,
                label: formatCampaignCurrencyLabel(
                  rewardCampaignCurrency,
                  roundReward.bonusRewardAmount,
                ),
                iconSrc: rewardCampaignIcon,
              }
            : null
        }
        onAnimationComplete={() => handleRewardAnimationComplete(roundReward)}
        onDisplayedCoinsChange={updateRewardPreview}
        reward={roundReward}
        startCompleted={!shouldShowRewardSequence || isAwaitingRewardContinue}
      >
        {rewardResultSummary}
        {isRecipient ? (
          <AudioPlayerCard
            title="Original phrase clip"
            description="Replay the forward clip if you want to compare it to your guess."
            blob={activeRound.originalAudioBlob}
            remoteUrl={activeRound.originalAudioUrl}
          />
        ) : senderRewardReview}
        {isRecipient ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={isRewardBusy}
              onClick={() => {
                void handleRecipientContinue();
              }}
              type="button"
            >
              Record next prompt
            </button>
          </div>
        ) : null}
      </RoundRewardSequence>
    ) : activeRound.status === 'complete' ? (
      isLoadingReward ? (
        <div aria-live="polite" className="reward-loading-shell" role="status">
          <WaveformLoader className="reward-loading-spinner" size={136} strokeWidth={4} />
          <p>loading...</p>
        </div>
      ) : (
        <div className="reward-status-shell">
          <p>Reward data is missing for this round, so no BB Coin payout can be shown here.</p>
          {isRecipient ? (
            <div className="button-row">
              <button
                className="button primary"
                disabled={isRewardBusy}
                onClick={() => {
                  void handleRecipientContinue();
                }}
                type="button"
              >
                Record next prompt
              </button>
            </div>
          ) : null}
        </div>
      )
    ) : null;

  return (
    <section className={roundScreenClassName}>
      {!showRewardPage ? (
        <div className="round-screen-header">
          <div className="round-screen-copy">
            <div className="eyebrow">{headerEyebrow}</div>
            <h2>{headerTitle}</h2>
            <p>{headerDescription}</p>
          </div>
        </div>
      ) : null}

      {isRecipient ? (
        <div className="round-screen-body">
          {recipientStage === 'listen' ? (
            <div className="round-screen-step">
              <AudioPlayerCard
                title="Reversed prompt"
                description={`You get ${formatListenLabel(effectiveFreeListenLimit)} for free. Extra replays cost ${nextListenReplayCost} BB Coins each.`}
                blob={reversedPromptBlob}
                isLoading={isLoadingReversedPrompt}
                loadingLabel="Preparing reversed prompt..."
                onPlayRequest={handleListenPlaybackRequest}
                playButtonDisabled={isAuthorizingListenPlayback}
              />

              <div className="helper-text round-screen-helper">
                {isAuthorizingListenPlayback
                  ? 'Authorizing this replay and updating your BB Coin balance.'
                  : `${listenPlaybackHelperText} Nothing else opens until you confirm you are ready to record.`}
              </div>
            </div>
          ) : null}

          {recipientStage === 'record' ? (
            <div className="round-screen-step">
              <div className="button-row round-record-actions">
                <ToggleRecordButton
                  disabled={round.status === 'complete' || isSavingAttempt}
                  isPreparing={recorder.isPreparing}
                  isRecording={recorder.isRecording}
                  liveStream={recorder.liveStream}
                  onStart={recorder.startRecording}
                  onStop={recorder.stopRecording}
                />
                {recorder.audioBlob ? (
                  <button
                    className="button ghost"
                    disabled={recorder.isRecording || isSavingAttempt}
                    onClick={recorder.clearRecording}
                    type="button"
                  >
                    Clear take
                  </button>
                ) : null}
              </div>

              <AudioPlayerCard
                title="Latest take"
                description={
                  recorder.audioBlob
                    ? 'Replay the take you just made.'
                    : 'Your saved imitation appears here after recording.'
                }
                blob={recorder.audioBlob ?? round.attemptAudioBlob}
                remoteUrl={round.attemptAudioUrl}
              />
            </div>
          ) : null}

          {recipientStage === 'guess' ? (
            <div className="round-screen-step">
              <AudioPlayerCard
                title="Reversed take"
                description="Your imitation is locked in. Type the original phrase."
                blob={reversedAttemptBlob}
                isLoading={isLoadingReversedAttempt}
                loadingLabel="Preparing reversed take..."
              />

              <div className="field">
                <label htmlFor="guess">Your guess</label>
                <input
                  id="guess"
                  disabled={round.status === 'complete' || isSubmittingGuess}
                  onChange={(event) => setGuess(event.target.value)}
                  placeholder="What was the original phrase?"
                  value={guess}
                />
              </div>
            </div>
          ) : null}

          {recipientStage === 'reveal' && scorePresentation ? (
            <div className="round-screen-step reward-stage-step">
              {rewardStatusCard}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={`round-screen-body${isSenderRewardPage ? ' round-screen-body-with-floating-footer' : ''}`}>
          {round.status === 'waiting_for_attempt' ? (
            <div className="round-screen-step">
              <div className="result-box">
                <p>
                  <strong>Phrase:</strong> {round.correctPhrase}
                </p>
                <p>{roundSummary?.callToAction}</p>
              </div>

              <AudioPlayerCard
                title="Your prompt reversed"
                description="This reversed clip is generated locally from your saved prompt."
                blob={reversedPromptBlob}
                isLoading={isLoadingReversedPrompt}
                loadingLabel="Preparing reversed prompt..."
              />
            </div>
          ) : null}

          {round.status === 'attempted' ? (
            <div className="round-screen-step">
              <div className="result-box">
                <p>
                  <strong>Phrase:</strong> {round.correctPhrase}
                </p>
                <p>{roundSummary?.callToAction}</p>
              </div>

              {reviewAudioGrid}
            </div>
          ) : null}

          {round.status === 'complete' && scorePresentation ? (
            <div className={`round-screen-step${showRewardPage ? ' reward-stage-step' : ''}`}>
              {showRewardPage ? rewardStatusCard : null}
            </div>
          ) : null}
        </div>
      )}

      <div className={`round-screen-footer${isSenderRewardPage ? ' round-screen-footer-floating' : ''}`}>
        {isRecipient && recipientStage === 'listen' ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={
                isAuthorizingListenPlayback || isLoadingReversedPrompt || recorder.isPreparing
              }
              onClick={() => {
                void handleReadyToImitate();
              }}
              type="button"
            >
              Ready to imitate
            </button>
          </div>
        ) : null}

        {isRecipient && recipientStage === 'guess' ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={!canSubmitGuess}
              onClick={() => {
                void handleSubmitGuess();
              }}
              type="button"
            >
              {isSubmittingGuess ? 'Revealing...' : 'Reveal stars'}
            </button>
          </div>
        ) : null}

        {isSenderRewardPage ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={isArchiving || isRewardBusy || isLoadingReward}
              onClick={() => {
                void handleArchiveRound();
              }}
              type="button"
            >
              {isArchiving ? 'Continuing...' : isLoadingReward ? 'loading...' : 'Continue'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="stack">
        {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
        {reversedPromptError ? <div className="error-banner">{reversedPromptError}</div> : null}
        {reversedAttemptError ? <div className="error-banner">{reversedAttemptError}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    </section>
  );
}
