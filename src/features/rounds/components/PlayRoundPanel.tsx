import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { WaveformLoader } from '../../../components/WaveformLoader';
import type { PlaybackStartKind } from '../../../components/WaveformPlayButton';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { useCoins } from '../../resources/ResourceProvider';
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
  round: Round | null;
  onArchiveRound: (round: Round) => Promise<void>;
  onBack: () => void;
  onComposeNextRound: () => void;
  onUpdateRound: (roundId: string, updater: (round: Round) => Round) => void;
}

type RecipientStage = 'listen' | 'record' | 'guess' | 'reveal';
type CompletedRoundStage = 'review' | 'reward';

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

function getCompletedRoundStageStorageKey(userId: string, roundId: string) {
  return `backtalk:round-complete-stage:${userId}:${roundId}`;
}

function getStoredCompletedRoundStage(userId: string, roundId: string): CompletedRoundStage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const storedStage = window.sessionStorage.getItem(getCompletedRoundStageStorageKey(userId, roundId));
  return storedStage === 'reward' ? 'reward' : storedStage === 'review' ? 'review' : null;
}

function setStoredCompletedRoundStage(
  userId: string,
  roundId: string,
  stage: CompletedRoundStage,
) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getCompletedRoundStageStorageKey(userId, roundId), stage);
}

function formatListenLabel(count: number) {
  return `${count} listen${count === 1 ? '' : 's'}`;
}
export function PlayRoundPanel({
  currentUserId,
  round,
  onArchiveRound,
  onBack,
  onComposeNextRound,
  onUpdateRound,
}: PlayRoundPanelProps) {
  const recorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const { coins, isLoadingCoins, refreshCoins, setCoinBalance, setCoinPreview } = useCoins();
  const [guess, setGuess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isLoadingReward, setIsLoadingReward] = useState(false);
  const [isAnimatingReward, setIsAnimatingReward] = useState(false);
  const [isAwaitingRewardContinue, setIsAwaitingRewardContinue] = useState(false);
  const [isClaimingReward, setIsClaimingReward] = useState(false);
  const [completedRoundStage, setCompletedRoundStage] = useState<CompletedRoundStage>('review');
  const [roundReward, setRoundReward] = useState<RoundReward | null>(null);
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
    setInfo(null);
    setHasConfirmedListen(false);
    recorder.clearRecording();
    lastSavedAttemptBlobRef.current = null;
    setRoundReward(null);
    setIsLoadingReward(
      round?.status === 'complete'
        ? round.recipientId === currentUserId
          ? true
          : (getStoredCompletedRoundStage(currentUserId, round.id) ?? 'review') === 'reward'
        : false,
    );
    setIsAnimatingReward(false);
    setIsAwaitingRewardContinue(false);
    setIsClaimingReward(false);
    setCompletedRoundStage(
      round?.status === 'complete'
        ? round.recipientId === currentUserId
          ? 'reward'
          : getStoredCompletedRoundStage(currentUserId, round.id) ?? 'review'
        : 'review',
    );
    setListenState(null);
    setIsLoadingListenState(false);
    setIsAuthorizingListenPlayback(false);
    rewardBaseCoinsRef.current = coins;
    loadedRewardRoundIdRef.current = null;
    setCoinPreview(null);
  }, [currentUserId, round?.id, recorder.clearRecording, setCoinPreview]);

  const isRecipient = Boolean(round && round.recipientId === currentUserId);
  const hasAttempt = Boolean(
    round &&
      (round.attemptAudioBlob || round.attemptAudioUrl) &&
      (round.attemptReversedBlob || round.attemptReversedUrl),
  );
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
  const isRewardStepOpen = Boolean(isCompletedRound && (isRecipient || completedRoundStage === 'reward'));
  const isReviewerRecordingStep = Boolean(isCompletedRound && !isRecipient && completedRoundStage === 'review');
  const includedFreeListenLimit = round ? freeListenLimitByDifficulty[round.difficulty] : 0;
  const effectiveFreeListenLimit = listenState?.freeLimit ?? includedFreeListenLimit;
  const listenUsageCount = listenState?.listenCount ?? 0;
  const paidListenCount =
    listenState?.paidListenCount ?? Math.max(0, listenUsageCount - effectiveFreeListenLimit);
  const freeListenCountRemaining = Math.max(0, effectiveFreeListenLimit - listenUsageCount);
  const nextListenReplayCost = listenState?.nextPlayCost ?? extraListenCost;
  const listenPlaybackHelperText = !round
    ? ''
    : isLoadingListenState
      ? 'Checking your free replay limit.'
      : freeListenCountRemaining > 0
        ? `${formatListenLabel(freeListenCountRemaining)} free out of ${formatListenLabel(effectiveFreeListenLimit)} remaining. Extra replays cost ${nextListenReplayCost} BB Coins each.`
        : paidListenCount > 0
          ? `Free listens are used up. You have already bought ${formatListenLabel(paidListenCount)}. Each new replay costs ${nextListenReplayCost} BB Coins.`
          : `Free listens are used up. Each new replay costs ${nextListenReplayCost} BB Coins.`;

  const canSubmitGuess = useMemo(
    () =>
      Boolean(round && isRecipient && hasAttempt && guess.trim()) &&
      round?.status !== 'complete' &&
      !isSavingAttempt &&
      !isSubmittingGuess,
    [guess, hasAttempt, isRecipient, isSavingAttempt, isSubmittingGuess, round],
  );
  const isRewardBusy = isAnimatingReward || isClaimingReward;
  const hasPendingReward = Boolean(roundReward && !roundReward.claimed);
  const shouldShowRewardSequence = hasPendingReward && (isAnimatingReward || isAwaitingRewardContinue);

  const updateRewardPreview = useCallback(
    (nextDisplayedCoins: number) => {
      setCoinPreview(nextDisplayedCoins);
    },
    [setCoinPreview],
  );

  const settleClaimedReward = useCallback(
    async (rewardToSettle: RoundReward, options: { claimedNow: boolean; currentBalance: number | null }) => {
      if (options.currentBalance !== null) {
        setCoinBalance(options.currentBalance);
      } else {
        try {
          await refreshCoins();
        } catch (refreshError) {
          console.warn('Unable to refresh BB Coins after claiming a round reward.', refreshError);
        }
      }

      setRoundReward({ ...rewardToSettle, claimed: true });
      setIsAnimatingReward(false);
      setIsAwaitingRewardContinue(false);
      setIsClaimingReward(false);
      setCoinPreview(null);
      clearRewardAnimationState(currentUserId, rewardToSettle.roundId);
      setInfo(
        rewardToSettle.rewardAmount > 0 && options.claimedNow
          ? `Reward claimed. +${rewardToSettle.rewardAmount} BB Coins.`
          : 'Reward already settled for this round.',
      );
    },
    [currentUserId, refreshCoins, setCoinBalance, setCoinPreview],
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
    setInfo(null);
    setIsSavingAttempt(true);

    try {
      const reversedAttemptBlob = await reverseAudioBlob(attemptBlob);
      if (cancelled?.()) {
        return;
      }

      const savedRound = await saveRoundAttempt({
        currentUserId,
        roundId: currentRound.id,
        attemptAudioBlob: attemptBlob,
        attemptReversedBlob: reversedAttemptBlob,
      });

      if (cancelled?.()) {
        return;
      }

      onUpdateRound(currentRound.id, (existingRound) => ({
        ...savedRound,
        originalAudioBlob: existingRound.originalAudioBlob,
        reversedAudioBlob: existingRound.reversedAudioBlob,
        attemptAudioBlob: attemptBlob,
        attemptReversedBlob: reversedAttemptBlob,
      }));
      lastSavedAttemptBlobRef.current = attemptBlob;
      recorder.clearRecording();
      setInfo('Take saved. Your guess step is open now.');
    } catch (caughtError) {
      if (!cancelled?.()) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to reverse and save the attempt recording.',
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
      return;
    }

    if (loadedRewardRoundIdRef.current === round.id) {
      return;
    }

    loadedRewardRoundIdRef.current = round.id;
    let cancelled = false;

    const loadRoundReward = async () => {
      setIsLoadingReward(true);

      try {
        setStoredCompletedRoundStage(currentUserId, round.id, 'reward');

        try {
          await markRoundResultsViewed(round.id);
        } catch (markViewedError) {
          console.warn('Unable to mark the completed round as viewed.', markViewedError);
        }

        const reward = await getRoundReward(currentUserId, round.id);

        if (cancelled) {
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
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load the round reward.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingReward(false);
        }
      }
    };

    void loadRoundReward();

    return () => {
      cancelled = true;
    };
  }, [
    coins,
    currentUserId,
    finalizePendingRewardClaim,
    isRewardStepOpen,
    isLoadingCoins,
    round,
    updateRewardPreview,
    setCoinPreview,
  ]);

  if (!round) {
    return (
      <section className="surface round-screen">
        <div className="round-screen-header">
          <button className="button ghost round-screen-back" onClick={onBack} type="button">
            Back
          </button>
          <div className="round-screen-copy">
            <div className="eyebrow">Round</div>
            <h2>No active round</h2>
            <p>Pick a friend from home to open the current thread.</p>
          </div>
        </div>
      </section>
    );
  }

  const isSenderCompletedRound = !isRecipient && round.status === 'complete';
  const showSenderRecordingReview = isSenderCompletedRound && completedRoundStage === 'review';
  const showRewardPage = round.status === 'complete' && (isRecipient || completedRoundStage === 'reward');
  const rewardResultSummary =
    round.status === 'complete' && scorePresentation ? (
      <div className="reward-reveal-details">
        <p>
          <strong>{isRecipient ? 'You guessed:' : 'You said:'}</strong>{' '}
          {isRecipient ? round.guess || 'No guess submitted' : round.correctPhrase}
        </p>
        <p>
          <strong>{isRecipient ? `${round.senderUsername} said:` : `${round.recipientUsername} guessed:`}</strong>{' '}
          {isRecipient ? round.correctPhrase : round.guess || 'No guess submitted'}
        </p>
      </div>
    ) : null;
  const headerEyebrow = isRecipient
    ? recipientStage === 'reveal'
      ? 'Reward Reveal'
      : getRecipientStepLabel(recipientStage)
    : showSenderRecordingReview
      ? 'Review Recordings'
      : showRewardPage
        ? 'Reward Review'
        : 'Round Review';
  const headerTitle = isRecipient
    ? recipientStage === 'reveal'
      ? (roundSummary?.headline ?? 'Round')
      : (roundSummary?.headline ?? 'Round')
    : showSenderRecordingReview
      ? `Review ${round.recipientUsername}'s round`
      : showRewardPage
        ? (roundSummary?.headline ?? 'Round')
        : (roundSummary?.headline ?? 'Round');
  const headerDescription = isRecipient
    ? recipientStage === 'reveal'
      ? 'See the score, compare the phrase, and bank your BB Coins when you continue.'
      : (roundSummary?.description ?? '')
    : showSenderRecordingReview
      ? 'Listen through the recordings first. Continue when you are ready to reveal the score and BB Coin payout.'
      : showRewardPage
        ? 'This screen settles your BB Coin reward for the round.'
        : (roundSummary?.description ?? '');
  const roundScreenClassName = showRewardPage ? 'round-screen round-screen-reward' : 'surface round-screen';

  const handleSubmitGuess = async () => {
    const nextGuess = guess.trim();
    if (!nextGuess || !isRecipient) {
      return;
    }

    setError(null);
    setInfo(null);
    setIsSubmittingGuess(true);

    try {
      const updatedRound = await submitRoundGuess({
        roundId: round.id,
        guess: nextGuess,
        correctPhrase: round.correctPhrase,
        difficulty: round.difficulty,
      });

      onUpdateRound(round.id, (currentRound) => ({
        ...updatedRound,
        originalAudioBlob: currentRound.originalAudioBlob,
        reversedAudioBlob: currentRound.reversedAudioBlob,
        attemptAudioBlob: currentRound.attemptAudioBlob,
        attemptReversedBlob: currentRound.attemptReversedBlob,
      }));
      setInfo('Score revealed. Your BB Coin reward will lock in on this results screen.');
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
      setInfo(null);
      setIsAuthorizingListenPlayback(true);

      try {
        const nextListenState = await consumeRoundListen(round.id);
        setListenState(nextListenState);
        setCoinBalance(nextListenState.currentBalance);
        setCoinPreview(null);

        if (nextListenState.charged) {
          setInfo(`Extra replay unlocked. -${nextListenState.nextPlayCost} BB Coins.`);
        }

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

  const handleReadyToImitate = async () => {
    await recorder.prepareRecording();
    setHasConfirmedListen(true);
  };

  const handleOpenRewardStep = () => {
    if (!round) {
      return;
    }

    setError(null);
    setInfo(null);
    setIsLoadingReward(true);
    setStoredCompletedRoundStage(currentUserId, round.id, 'reward');
    setCompletedRoundStage('reward');
  };

  const handleRecipientContinue = async () => {
    if (isRewardBusy) {
      return;
    }

    setError(null);
    setInfo(null);

    if (roundReward && !roundReward.claimed) {
      const didClaimReward = await finalizePendingRewardClaim(roundReward);

      if (!didClaimReward) {
        return;
      }
    }

    onComposeNextRound();
  };

  const handleArchiveRound = async () => {
    if (isRewardBusy) {
      return;
    }

    setError(null);
    setInfo(null);
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
        blob={round.originalAudioBlob}
        remoteUrl={round.originalAudioUrl}
      />
      <AudioPlayerCard
        title="Your reversed prompt"
        description="The backward clip your friend heard before imitating it."
        blob={round.reversedAudioBlob}
        remoteUrl={round.reversedAudioUrl}
      />
      <AudioPlayerCard
        title="Their imitation"
        description="Your friend's attempt at copying the reversed prompt."
        blob={round.attemptAudioBlob}
        remoteUrl={round.attemptAudioUrl}
      />
      <AudioPlayerCard
        title="Their imitation reversed"
        description="The flipped version they used when making their guess."
        blob={round.attemptReversedBlob}
        remoteUrl={round.attemptReversedUrl}
      />
    </div>
  );

  const rewardStatusCard =
    round.status === 'complete' && roundReward ? (
      <RoundRewardSequence
        baseCoins={rewardBaseCoinsRef.current}
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
            blob={round.originalAudioBlob}
            remoteUrl={round.originalAudioUrl}
          />
        ) : null}
        <div className="button-row">
          {isRecipient ? (
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
          ) : (
            <button
              className="button primary"
              disabled={isArchiving || isRewardBusy || isLoadingReward}
              onClick={() => {
                void handleArchiveRound();
              }}
              type="button"
            >
              {isArchiving
                ? 'Continuing...'
                : isLoadingReward
                  ? 'loading...'
                  : 'Continue thread'}
            </button>
          )}
        </div>
      </RoundRewardSequence>
    ) : round.status === 'complete' ? (
      isLoadingReward ? (
        <div aria-live="polite" className="reward-loading-shell" role="status">
          <WaveformLoader className="reward-loading-spinner" size={136} strokeWidth={4} />
          <p>loading...</p>
        </div>
      ) : (
        <div className="reward-status-shell">
          <p>Reward data is missing for this round, so no BB Coin payout can be shown here.</p>
          <div className="button-row">
            {isRecipient ? (
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
            ) : (
              <button
                className="button primary"
                disabled={isArchiving || isRewardBusy}
                onClick={() => {
                  void handleArchiveRound();
                }}
                type="button"
              >
                {isArchiving ? 'Continuing...' : 'Continue thread'}
              </button>
            )}
          </div>
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
                blob={round.reversedAudioBlob}
                onPlayRequest={handleListenPlaybackRequest}
                playButtonDisabled={isAuthorizingListenPlayback}
                remoteUrl={round.reversedAudioUrl}
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
                blob={round.attemptReversedBlob}
                remoteUrl={round.attemptReversedUrl}
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
        <div className="round-screen-body">
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
                description="This is the flipped clip your friend is hearing while they record."
                blob={round.reversedAudioBlob}
                remoteUrl={round.reversedAudioUrl}
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
              {showSenderRecordingReview ? (
                <>
                  <div className="result-box round-screen-summary">
                    <strong>Review the recordings</strong>
                    <p>
                      Listen through the round first. Continue when you are ready to reveal the
                      score and BB Coin reward.
                    </p>
                  </div>
                  {reviewAudioGrid}
                </>
              ) : null}

              {showRewardPage ? (
                <>
                  {rewardStatusCard}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="round-screen-footer">
        {isRecipient && recipientStage === 'listen' ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={isAuthorizingListenPlayback || recorder.isPreparing}
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

        {!isRecipient && showSenderRecordingReview ? (
          <div className="button-row">
            <button
              className="button primary"
              onClick={handleOpenRewardStep}
              type="button"
            >
              Continue
            </button>
          </div>
        ) : null}

      </div>

      <div className="stack">
        {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="success-banner">{info}</div> : null}
      </div>
    </section>
  );
}
