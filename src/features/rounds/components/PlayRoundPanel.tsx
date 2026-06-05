import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type CSSProperties,
  type FormEvent,
} from 'react';
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
import { listWordPacks, type WordPack } from '../../../lib/wordPacks';
import {
  consumeRoundListen,
  extraListenCost,
  freeListenLimitByDifficulty,
  getRoundListenState,
  markRoundResultsViewed,
  maxRoundReactionLength,
  saveRoundAttempt,
  saveRoundReaction,
  submitRoundGuess,
} from '../../../lib/rounds';
import { getRoundSummary, getScorePresentation } from '../scorePresentation';
import type { Round, RoundGuessEvent, RoundListenState, RoundReward } from '../types';
import {
  getAdjacentGuessTargetIndex,
  composeGuessTextFromEvents,
  composeGuessTextFromEntries,
  failedGuessMistakeCount,
  getGuessTargetIndexes,
  getNextOpenGuessTargetIndex,
  isGuessCharacterCorrect,
  isGuessCompleteFromEntries,
  isGuessTargetCharacter,
  upsertGuessEntryByPhraseIndex,
} from '../utils';
import {
  GuessPhraseGrid,
  GuessReplayPanel,
  GuessResultGrid,
  type GuessCellMap,
} from './GuessPhraseGrid';
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

interface GuessEntry {
  phraseIndex: number;
  value: string;
  correct: boolean;
  animationKey?: number;
  shake?: boolean;
}

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

function getGuessPlaybackStorageKey(userId: string, roundId: string) {
  return `backtalk:round-guess-playback:${userId}:${roundId}`;
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

function hasCompletedGuessPlayback(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.sessionStorage.getItem(getGuessPlaybackStorageKey(userId, roundId)) === 'complete';
}

function markGuessPlaybackCompleted(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getGuessPlaybackStorageKey(userId, roundId), 'complete');
}

function clearRewardAnimationState(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(getRewardAnimationStorageKey(userId, roundId));
}

function formatFreeListenLabel(count: number) {
  return `${count} free listen${count === 1 ? '' : 's'}`;
}

function getRoundMistakeCount(round: Round) {
  return round.guessMistakeCount ?? round.guessEvents.reduce(
    (maxMistakeCount, event) => Math.max(maxMistakeCount, event.mistakeCount),
    0,
  );
}

function formatMistakeCount(count: number) {
  return `${count} mistake${count === 1 ? '' : 's'}`;
}

interface Point {
  x: number;
  y: number;
}

interface ListenSpendAnimation {
  amount: number;
  id: number;
}

interface SpendParticleSpec {
  id: string;
  delay: number;
  duration: number;
  size: number;
  lift: number;
  sourceOffsetX: number;
  sourceOffsetY: number;
  endOffsetX: number;
  endOffsetY: number;
  spin: number;
}

interface SpendParticleRender {
  id: string;
  style: CSSProperties;
}

const LISTEN_SPEND_STREAM_DURATION_MS = 920;

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

function easeInOutCubic(value: number) {
  const clampedValue = clampUnit(value);

  return clampedValue < 0.5
    ? 4 * clampedValue * clampedValue * clampedValue
    : 1 - Math.pow(-2 * clampedValue + 2, 3) / 2;
}

function quadraticBezier(start: number, control: number, end: number, progress: number) {
  const inverseProgress = 1 - progress;
  return (
    inverseProgress * inverseProgress * start +
    2 * inverseProgress * progress * control +
    progress * progress * end
  );
}

function getCenterPoint(element: HTMLElement | null): Point | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getCoinDisplaySourcePoint() {
  const exactTarget = document.querySelector<HTMLElement>('[data-coin-display-target="true"]');

  if (exactTarget) {
    return getCenterPoint(exactTarget);
  }

  const fallbackTarget = document.querySelector<HTMLElement>('[data-coin-display="true"]');
  return getCenterPoint(fallbackTarget);
}

function getListenPlaybackTargetPoint() {
  const exactTarget = document.querySelector<HTMLElement>('[data-round-listen-play-target="true"]');
  return getCenterPoint(exactTarget);
}

function createSpendParticleSpecs(amount: number) {
  const count = Math.max(3, Math.min(8, Math.round(amount) || extraListenCost));
  const centerIndex = (count - 1) / 2;

  return Array.from({ length: count }, (_, index): SpendParticleSpec => ({
    id: `listen-spend-particle-${index}`,
    delay: index * 58,
    duration: 500 + (index % 3) * 46,
    size: 19 + (index % 2) * 4,
    lift: 56 + (index % 4) * 12,
    sourceOffsetX: (index - centerIndex) * 4,
    sourceOffsetY: (index % 2 === 0 ? -1 : 1) * 4,
    endOffsetX: (index % 3 - 1) * 14,
    endOffsetY: (index % 2 === 0 ? -1 : 1) * 10,
    spin: (index % 2 === 0 ? -1 : 1) * (120 + index * 24),
  }));
}

function RoundListenSpendStream({
  amount,
  animationId,
  onComplete,
}: {
  amount: number;
  animationId: number;
  onComplete: (animationId: number) => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sourcePoint, setSourcePoint] = useState<Point | null>(null);
  const [targetPoint, setTargetPoint] = useState<Point | null>(null);
  const hasCompletedAnimationRef = useRef(false);
  const particles = useMemo(() => createSpendParticleSpecs(amount), [amount]);

  useEffect(() => {
    hasCompletedAnimationRef.current = false;
    setElapsedMs(0);
    setSourcePoint(getCoinDisplaySourcePoint());
    setTargetPoint(getListenPlaybackTargetPoint());
  }, [animationId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let animationFrameId = 0;
    let startTimeMs = 0;

    const animate = (timestampMs: number) => {
      if (!startTimeMs) {
        startTimeMs = timestampMs;
      }

      const nextElapsedMs = Math.min(timestampMs - startTimeMs, LISTEN_SPEND_STREAM_DURATION_MS);
      setElapsedMs(nextElapsedMs);

      if (nextElapsedMs < LISTEN_SPEND_STREAM_DURATION_MS) {
        animationFrameId = window.requestAnimationFrame(animate);
      }
    };

    animationFrameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [animationId]);

  useEffect(() => {
    if (elapsedMs < LISTEN_SPEND_STREAM_DURATION_MS || hasCompletedAnimationRef.current) {
      return;
    }

    hasCompletedAnimationRef.current = true;
    onComplete(animationId);
  }, [animationId, elapsedMs, onComplete]);

  const particleStyles = useMemo<SpendParticleRender[]>(() => {
    if (!sourcePoint || !targetPoint) {
      return [];
    }

    return particles.reduce<SpendParticleRender[]>((result, particle) => {
      const progress = clampUnit((elapsedMs - particle.delay) / particle.duration);

      if (progress <= 0) {
        return result;
      }

      const easedProgress = easeInOutCubic(progress);
      const startX = sourcePoint.x + particle.sourceOffsetX;
      const startY = sourcePoint.y + particle.sourceOffsetY;
      const endX = targetPoint.x + particle.endOffsetX;
      const endY = targetPoint.y + particle.endOffsetY;
      const controlX = (startX + endX) / 2 + (startX > endX ? -36 : 36);
      const controlY = Math.min(startY, endY) - particle.lift;
      const x = quadraticBezier(startX, controlX, endX, easedProgress);
      const y = quadraticBezier(startY, controlY, endY, easedProgress);
      const fadeIn = clampUnit(progress / 0.16);
      const fadeOut = progress > 0.84 ? 1 - (progress - 0.84) / 0.16 : 1;
      const scale = 0.76 + Math.sin(progress * Math.PI) * 0.28;

      result.push({
        id: particle.id,
        style: {
          width: `${particle.size}px`,
          height: `${particle.size}px`,
          opacity: fadeIn * fadeOut,
          transform: `translate(${x - particle.size / 2}px, ${y - particle.size / 2}px) scale(${scale}) rotate(${particle.spin * easedProgress}deg)`,
        },
      });

      return result;
    }, []);
  }, [elapsedMs, particles, sourcePoint, targetPoint]);

  return (
    <>
      {particleStyles.map((particle) => (
        <img
          alt=""
          aria-hidden="true"
          className="round-listen-spend-coin"
          key={particle.id}
          src={`${import.meta.env.BASE_URL}bbcoin.png`}
          style={particle.style}
        />
      ))}
    </>
  );
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
  playbackKind = 'normal',
  remoteUrl,
}: {
  blob?: Blob | null;
  isLoading?: boolean;
  loadingLabel?: string;
  playbackKind?: 'normal' | 'babble';
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
      <WaveformPlayButton
        className="reward-review-play-button"
        playbackKind={playbackKind}
        size={86}
        src={src}
      />
    </div>
  );
}

function hasReactionMessage(message: string | null | undefined) {
  return Boolean(message?.trim());
}

function RoundReactionBubble({
  authorLabel,
  message,
}: {
  authorLabel: string;
  message: string | null | undefined;
}) {
  if (!hasReactionMessage(message)) {
    return null;
  }

  return (
    <div className="round-reaction-bubble" aria-label={`${authorLabel} reaction`}>
      <span className="round-reaction-bubble-kicker">{authorLabel}</span>
      <p>{message}</p>
    </div>
  );
}

function RoundReactionThread({
  recipientLabel,
  recipientMessage,
  senderLabel,
  senderMessage,
}: {
  recipientLabel: string;
  recipientMessage: string | null | undefined;
  senderLabel: string;
  senderMessage: string | null | undefined;
}) {
  if (!hasReactionMessage(senderMessage) && !hasReactionMessage(recipientMessage)) {
    return null;
  }

  return (
    <div className="round-reaction-thread">
      <RoundReactionBubble authorLabel={senderLabel} message={senderMessage} />
      <RoundReactionBubble authorLabel={recipientLabel} message={recipientMessage} />
    </div>
  );
}

function RewardAudioWithReaction({
  blob,
  description,
  isLoading = false,
  loadingLabel = 'Preparing audio...',
  playbackKind = 'normal',
  reactionLabel,
  reactionMessage,
  remoteUrl,
  title,
}: {
  blob?: Blob | null;
  description: string;
  isLoading?: boolean;
  loadingLabel?: string;
  playbackKind?: 'normal' | 'babble';
  reactionLabel: string;
  reactionMessage: string | null | undefined;
  remoteUrl?: string | null;
  title: string;
}) {
  return (
    <article className="audio-card reward-reaction-audio-card">
      <div className="audio-card-head">
        <div>
          <h4>{title}</h4>
        </div>
      </div>
      <p>{description}</p>
      <div className="reward-reaction-playback-row">
        <RewardPlaybackButton
          blob={blob}
          isLoading={isLoading}
          loadingLabel={loadingLabel}
          playbackKind={playbackKind}
          remoteUrl={remoteUrl}
        />
        <RoundReactionBubble authorLabel={reactionLabel} message={reactionMessage} />
      </div>
    </article>
  );
}

function RoundReactionComposer({
  buttonLabel,
  draft,
  disabled = false,
  fieldId,
  isOpen,
  isSaving,
  onCancel,
  onChange,
  onOpen,
  onSave,
}: {
  buttonLabel: string;
  draft: string;
  disabled?: boolean;
  fieldId: string;
  isOpen: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onOpen: () => void;
  onSave: () => void;
}) {
  const trimmedDraft = draft.trim();

  if (!isOpen) {
    return (
      <div className="round-reaction-composer">
        <button className="button comment" disabled={disabled || isSaving} onClick={onOpen} type="button">
          {buttonLabel}
        </button>
      </div>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!trimmedDraft || disabled || isSaving) {
      return;
    }

    onSave();
  };

  return (
    <form className="round-reaction-composer" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={fieldId}>Comment message</label>
        <textarea
          id={fieldId}
          disabled={disabled || isSaving}
          maxLength={maxRoundReactionLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type a message for this reward."
          rows={3}
          value={draft}
        />
      </div>
      <div className="round-reaction-composer-footer">
        <span>
          {draft.length}/{maxRoundReactionLength}
        </span>
        <div className="button-row">
          <button className="button ghost" disabled={isSaving} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!trimmedDraft || disabled || isSaving}
            type="submit"
          >
            {isSaving ? 'Saving...' : 'Send Comment'}
          </button>
        </div>
      </div>
    </form>
  );
}

function formatDifficultyLabel(difficulty: Round['difficulty']) {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

function getPackInitials(packName: string) {
  const initials = packName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return initials || 'WP';
}

function RoundPromptMetadata({
  difficulty,
  iconUrl,
  packName,
}: {
  difficulty: Round['difficulty'];
  iconUrl: string | null;
  packName: string;
}) {
  const [didIconFail, setDidIconFail] = useState(false);
  const normalizedPackName = packName.trim() || 'Word pack';
  const shouldShowImage = Boolean(iconUrl) && !didIconFail;

  useEffect(() => {
    setDidIconFail(false);
  }, [iconUrl]);

  return (
    <aside className="round-prompt-meta-card" aria-label="Round prompt details">
      <span className="round-prompt-pack-icon" aria-hidden="true">
        {shouldShowImage && iconUrl ? (
          <img
            alt=""
            onError={() => setDidIconFail(true)}
            src={iconUrl}
          />
        ) : (
          <span>{getPackInitials(normalizedPackName)}</span>
        )}
      </span>
      <span className="round-prompt-meta-copy">
        <span className="round-prompt-meta-label">Word pack</span>
        <strong className="round-prompt-meta-name">{normalizedPackName}</strong>
      </span>
      <span className={`badge ${difficulty} round-prompt-difficulty`}>
        {formatDifficultyLabel(difficulty)}
      </span>
    </aside>
  );
}

function RoundListenAudioCard({
  blob,
  coinSpendAnimation,
  isPaidReplay = false,
  isLoading = false,
  loadingLabel = 'Preparing audio...',
  onCoinSpendAnimationComplete,
  onPlayRequest,
  playButtonDisabled = false,
  statusLabel,
  title,
}: {
  blob?: Blob | null;
  coinSpendAnimation?: ListenSpendAnimation | null;
  isPaidReplay?: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  onCoinSpendAnimationComplete?: (animationId: number) => void;
  onPlayRequest?: (playbackStartKind: PlaybackStartKind) => boolean | void | Promise<boolean | void>;
  playButtonDisabled?: boolean;
  statusLabel: string;
  title: string;
}) {
  const objectUrl = useObjectUrl(blob);

  return (
    <article className="round-listen-audio-card">
      <h3>{title}</h3>
      {objectUrl ? (
        <div className="round-listen-player-wrap" data-round-listen-play-target="true">
          <WaveformPlayButton
            className="round-listen-play-button"
            disabled={playButtonDisabled}
            onPlayRequest={onPlayRequest}
            size={152}
            src={objectUrl}
            strokeWidth={5}
          />
          {coinSpendAnimation && onCoinSpendAnimationComplete ? (
            <RoundListenSpendStream
              amount={coinSpendAnimation.amount}
              animationId={coinSpendAnimation.id}
              onComplete={onCoinSpendAnimationComplete}
            />
          ) : null}
        </div>
      ) : (
        <div className="round-listen-audio-loading">
          <WaveformLoader className="round-listen-audio-spinner" size={112} strokeWidth={4} />
          <span>{isLoading ? loadingLabel : 'No audio available yet.'}</span>
        </div>
      )}
      <div className="round-listen-free-listens" aria-live="polite">
        <span aria-hidden="true">🎧</span>
        {isPaidReplay ? (
          <strong className="round-listen-paid-replay">
            <span>{statusLabel}</span>
            <img alt="BB Coin" src={`${import.meta.env.BASE_URL}bbcoin.png`} />
            <span>per replay</span>
          </strong>
        ) : (
          <strong>{statusLabel}</strong>
        )}
      </div>
    </article>
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
  const [guessEntries, setGuessEntries] = useState<GuessEntry[]>([]);
  const [guessEvents, setGuessEvents] = useState<RoundGuessEvent[]>([]);
  const [guessMistakeCount, setGuessMistakeCount] = useState(0);
  const [guessFeedback, setGuessFeedback] = useState<GuessEntry | null>(null);
  const [activeGuessCursorIndex, setActiveGuessCursorIndex] = useState<number | null>(null);
  const [isGuessAnimating, setIsGuessAnimating] = useState(false);
  const [isGuessLocked, setIsGuessLocked] = useState(false);
  const [isGuessReplayComplete, setIsGuessReplayComplete] = useState(true);
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
  const [wordPacks, setWordPacks] = useState<WordPack[]>([]);
  const [listenState, setListenState] = useState<RoundListenState | null>(null);
  const [isLoadingListenState, setIsLoadingListenState] = useState(false);
  const [isAuthorizingListenPlayback, setIsAuthorizingListenPlayback] = useState(false);
  const [listenSpendAnimation, setListenSpendAnimation] =
    useState<ListenSpendAnimation | null>(null);
  const [hasConfirmedListen, setHasConfirmedListen] = useState(false);
  const [isReactionComposerOpen, setIsReactionComposerOpen] = useState(false);
  const [reactionDraft, setReactionDraft] = useState('');
  const [isSavingReaction, setIsSavingReaction] = useState(false);
  const lastSavedAttemptBlobRef = useRef<Blob | null>(null);
  const rewardBaseCoinsRef = useRef(0);
  const loadedRewardRoundIdRef = useRef<string | null>(null);
  const listenSpendAnimationIdRef = useRef(0);
  const guessInputRef = useRef<HTMLInputElement | null>(null);
  const guessStartedAtRef = useRef<number | null>(null);
  const isAutoSubmittingGuessRef = useRef(false);
  const guessFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (guessFeedbackTimerRef.current) {
      clearTimeout(guessFeedbackTimerRef.current);
      guessFeedbackTimerRef.current = null;
    }

    setGuessEntries([]);
    setGuessEvents([]);
    setGuessMistakeCount(0);
    setGuessFeedback(null);
    setActiveGuessCursorIndex(null);
    setIsGuessAnimating(false);
    setIsGuessLocked(round?.status === 'complete');
    setIsGuessReplayComplete(
      !round ||
        round.status !== 'complete' ||
        hasCompletedGuessPlayback(currentUserId, round.id),
    );
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
    setListenSpendAnimation(null);
    setIsReactionComposerOpen(false);
    setReactionDraft(
      round?.senderId === currentUserId
        ? (round.senderReactionMessage ?? '')
        : round?.recipientId === currentUserId
          ? (round.recipientReactionMessage ?? '')
          : '',
    );
    setIsSavingReaction(false);
    rewardBaseCoinsRef.current = coins;
    loadedRewardRoundIdRef.current = null;
    guessStartedAtRef.current = null;
    isAutoSubmittingGuessRef.current = false;
    setCoinPreview(null);
  }, [currentUserId, round?.id, round?.status, recorder.clearRecording, setCoinPreview]);

  useEffect(
    () => () => {
      if (guessFeedbackTimerRef.current) {
        clearTimeout(guessFeedbackTimerRef.current);
        guessFeedbackTimerRef.current = null;
      }
    },
    [],
  );

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

  useEffect(() => {
    let cancelled = false;

    const loadWordPackMetadata = async () => {
      try {
        const nextWordPacks = await listWordPacks();

        if (!cancelled) {
          setWordPacks(nextWordPacks);
        }
      } catch (packError) {
        if (!cancelled) {
          console.warn('Unable to load word pack metadata for round details.', packError);
        }
      }
    };

    void loadWordPackMetadata();

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
  const freeListenCountRemaining = Math.max(0, effectiveFreeListenLimit - listenUsageCount);
  const nextListenReplayCost = listenState?.nextPlayCost ?? extraListenCost;
  const listenStatusLabel =
    isAuthorizingListenPlayback
      ? 'Authorizing replay'
      : isLoadingListenState
        ? 'Checking listens'
        : freeListenCountRemaining > 0
          ? formatFreeListenLabel(freeListenCountRemaining)
          : `${nextListenReplayCost}`;
  const isPaidListenReplay = !isAuthorizingListenPlayback &&
    !isLoadingListenState &&
    freeListenCountRemaining <= 0;
  const guessTargetIndexes = useMemo(
    () => (round ? getGuessTargetIndexes(round.correctPhrase) : []),
    [round?.correctPhrase],
  );
  const guessCells = useMemo<GuessCellMap>(
    () => {
      const cells = guessEntries.reduce<GuessCellMap>((nextCells, entry) => {
        nextCells[entry.phraseIndex] = {
          animationKey: entry.animationKey,
          correct: entry.correct,
          shake: entry.shake,
          value: entry.value,
        };

        return nextCells;
      }, {});

      if (guessFeedback) {
        cells[guessFeedback.phraseIndex] = {
          animationKey: guessFeedback.animationKey,
          correct: guessFeedback.correct,
          shake: guessFeedback.shake,
          value: guessFeedback.value,
        };
      }

      return cells;
    },
    [guessEntries, guessFeedback],
  );
  const fallbackActiveGuessIndex =
    getNextOpenGuessTargetIndex(guessTargetIndexes, guessEntries) ?? guessTargetIndexes[0] ?? null;
  const activeGuessIndex =
    activeGuessCursorIndex !== null && guessTargetIndexes.includes(activeGuessCursorIndex)
      ? activeGuessCursorIndex
      : fallbackActiveGuessIndex;
  const isGuessComplete = isGuessCompleteFromEntries(guessTargetIndexes, guessEntries);
  const isGuessFailed = guessMistakeCount >= failedGuessMistakeCount;
  const currentGuessText = round
    ? isGuessFailed
      ? composeGuessTextFromEvents(round.correctPhrase, guessEvents)
      : composeGuessTextFromEntries(round.correctPhrase, guessEntries)
    : '';
  const shouldPlayGuessReplay = Boolean(
    round && round.status === 'complete' && !isGuessReplayComplete,
  );
  const isGuessInputDisabled = Boolean(
    !round ||
      round.status === 'complete' ||
      isSubmittingGuess ||
      isGuessLocked ||
      isLoadingReversedAttempt ||
      !reversedAttemptBlob,
  );

  const canSubmitGuess = useMemo(
    () =>
      Boolean(
        round &&
          isRecipient &&
          hasAttempt &&
          reversedAttemptBlob &&
          (isGuessComplete || isGuessFailed) &&
          currentGuessText,
      ) &&
      round?.status !== 'complete' &&
      !isGuessAnimating &&
      !isLoadingReversedAttempt &&
      !isSavingAttempt &&
      !isSubmittingGuess,
    [
      currentGuessText,
      hasAttempt,
      isGuessAnimating,
      isGuessComplete,
      isGuessFailed,
      isLoadingReversedAttempt,
      isRecipient,
      isSavingAttempt,
      isSubmittingGuess,
      reversedAttemptBlob,
      round,
    ],
  );
  const isRewardBusy = isAnimatingReward || isClaimingReward || shouldPlayGuessReplay;
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
  const activeWordPack = useMemo(() => {
    if (!round?.packId) {
      return null;
    }

    return wordPacks.find((pack) => pack.id === round.packId) ?? null;
  }, [round?.packId, wordPacks]);
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
    if (recipientStage !== 'guess' || isGuessLocked || isSubmittingGuess) {
      return;
    }

    const focusGuessInput = () => {
      guessInputRef.current?.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusGuessInput);
    const timeout = window.setTimeout(focusGuessInput, 80);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [isGuessLocked, isSubmittingGuess, recipientStage, round?.id]);

  useEffect(() => {
    if (
      !round ||
      round.status !== 'complete' ||
      !currentUserId ||
      isLoadingCoins ||
      !isRewardStepOpen ||
      shouldPlayGuessReplay
    ) {
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
    shouldPlayGuessReplay,
    updateRewardPreview,
  ]);

  const handleSubmitGuess = async (options?: {
    entries?: GuessEntry[];
    events?: RoundGuessEvent[];
    guessText?: string;
    mistakeCount?: number;
  }) => {
    const currentRound = round;
    const nextEntries = options?.entries ?? guessEntries;
    const nextEvents = options?.events ?? guessEvents;
    const nextMistakeCount = options?.mistakeCount ?? guessMistakeCount;
    const nextGuess =
      options?.guessText ??
      (currentRound
        ? nextMistakeCount >= failedGuessMistakeCount
          ? composeGuessTextFromEvents(currentRound.correctPhrase, nextEvents)
          : composeGuessTextFromEntries(currentRound.correctPhrase, nextEntries)
        : '');

    if (
      !currentRound ||
      !nextGuess ||
      !isRecipient ||
      currentRound.status === 'complete' ||
      isAutoSubmittingGuessRef.current
    ) {
      return;
    }

    setError(null);
    setIsSubmittingGuess(true);
    setIsGuessLocked(true);
    isAutoSubmittingGuessRef.current = true;

    try {
      const updatedRound = await submitRoundGuess({
        roundId: currentRound.id,
        correctPhrase: currentRound.correctPhrase,
        guess: nextGuess,
        guessEvents: nextEvents,
        guessMistakeCount: nextMistakeCount,
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
      isAutoSubmittingGuessRef.current = false;
      setIsSubmittingGuess(false);
    }
  };

  const handleGuessCharacter = (rawCharacter: string) => {
    const currentRound = round;

    if (
      !currentRound ||
      currentRound.status === 'complete' ||
      !isRecipient ||
      isGuessLocked ||
      isSubmittingGuess ||
      isGuessComplete ||
      isGuessFailed ||
      !isGuessTargetCharacter(rawCharacter)
    ) {
      return;
    }

    const targetIndex = activeGuessIndex;

    if (typeof targetIndex !== 'number') {
      return;
    }

    const phraseCharacters = Array.from(currentRound.correctPhrase);
    const expected = phraseCharacters[targetIndex] ?? '';
    const value = Array.from(rawCharacter)[0] ?? '';
    const correct = isGuessCharacterCorrect(value, expected);
    const nextMistakeCount = guessMistakeCount + (correct ? 0 : 1);
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    const animationKey = guessEvents.length + 1;

    if (guessStartedAtRef.current === null) {
      guessStartedAtRef.current = now;
    }

    const nextEntry: GuessEntry = {
      phraseIndex: targetIndex,
      value,
      correct,
      animationKey,
      shake: !correct,
    };
    const nextEvent: RoundGuessEvent = {
      index: targetIndex,
      value,
      expected,
      correct,
      mistakeCount: nextMistakeCount,
      elapsedMs: Math.max(0, Math.round(now - guessStartedAtRef.current)),
    };
    const nextEntries = correct
      ? upsertGuessEntryByPhraseIndex(guessEntries, nextEntry, guessTargetIndexes)
      : guessEntries;
    const nextEvents = [...guessEvents, nextEvent];
    const didFailGuess = nextMistakeCount >= failedGuessMistakeCount;
    const didCompleteGuess = correct && isGuessCompleteFromEntries(guessTargetIndexes, nextEntries);

    if (guessFeedbackTimerRef.current) {
      clearTimeout(guessFeedbackTimerRef.current);
      guessFeedbackTimerRef.current = null;
    }

    setGuessFeedback(nextEntry);
    setIsGuessAnimating(true);
    setGuessEvents(nextEvents);
    setGuessMistakeCount(nextMistakeCount);
    if (correct) {
      setGuessEntries(nextEntries);
      setActiveGuessCursorIndex(
        getNextOpenGuessTargetIndex(guessTargetIndexes, nextEntries, targetIndex) ?? targetIndex,
      );
      setIsGuessLocked(didCompleteGuess);
    } else {
      setActiveGuessCursorIndex(targetIndex);
    }

    if (didFailGuess) {
      setIsGuessLocked(true);
      guessFeedbackTimerRef.current = setTimeout(() => {
        setGuessFeedback(null);
        setIsGuessAnimating(false);
        void handleSubmitGuess({
          entries: nextEntries,
          events: nextEvents,
          mistakeCount: nextMistakeCount,
        });
      }, 540);
      return;
    }

    guessFeedbackTimerRef.current = setTimeout(() => {
      setGuessFeedback(null);
      setIsGuessAnimating(false);
    }, correct ? 180 : 460);
  };

  const moveGuessCursor = (direction: -1 | 1) => {
    if (isGuessInputDisabled || guessTargetIndexes.length === 0) {
      return;
    }

    const nextIndex = getAdjacentGuessTargetIndex(guessTargetIndexes, activeGuessIndex, direction);

    if (typeof nextIndex === 'number') {
      setActiveGuessCursorIndex(nextIndex);
    }
  };

  const handleGuessKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();

      if (canSubmitGuess) {
        void handleSubmitGuess();
      }

      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Backspace') {
      event.preventDefault();
      moveGuessCursor(-1);
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'Delete') {
      event.preventDefault();
      moveGuessCursor(1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveGuessCursorIndex(guessTargetIndexes[0] ?? null);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActiveGuessCursorIndex(guessTargetIndexes[guessTargetIndexes.length - 1] ?? null);
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) {
      return;
    }

    event.preventDefault();
    handleGuessCharacter(event.key);
  };

  const handleGuessInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextCharacter = Array.from(event.currentTarget.value).find(
      isGuessTargetCharacter,
    );

    event.currentTarget.value = '';

    if (nextCharacter) {
      handleGuessCharacter(nextCharacter);
    }
  };

  const handleListenSpendAnimationComplete = useCallback(
    (animationId: number) => {
      setListenSpendAnimation((currentAnimation) =>
        currentAnimation?.id === animationId ? null : currentAnimation,
      );
      setCoinPreview(null);
    },
    [setCoinPreview],
  );

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
        const previousBalance = listenState?.currentBalance ?? coins;
        const nextListenState = await consumeRoundListen(round.id);
        const chargedAmount = Math.max(0, previousBalance - nextListenState.currentBalance);
        setListenState(nextListenState);
        setCoinBalance(nextListenState.currentBalance);

        if (nextListenState.charged) {
          listenSpendAnimationIdRef.current += 1;
          setCoinPreview(previousBalance);
          setListenSpendAnimation({
            amount: chargedAmount || nextListenReplayCost,
            id: listenSpendAnimationIdRef.current,
          });
        } else {
          setCoinPreview(null);
          setListenSpendAnimation(null);
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
    [coins, currentUserId, listenState?.currentBalance, nextListenReplayCost, round, setCoinBalance, setCoinPreview],
  );

  const handleGuessReplayComplete = useCallback(() => {
    if (!round) {
      return;
    }

    markGuessPlaybackCompleted(currentUserId, round.id);
    setIsGuessReplayComplete(true);
  }, [currentUserId, round?.id]);

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

  const handleSaveReaction = async () => {
    const currentRound = round;
    const message = reactionDraft.trim();

    if (!currentRound || !message) {
      return;
    }

    if (reactionDraft.length > maxRoundReactionLength) {
      setError(`Reactions must be ${maxRoundReactionLength} characters or fewer.`);
      return;
    }

    setError(null);
    setIsSavingReaction(true);

    try {
      const updatedRound = await saveRoundReaction({
        roundId: currentRound.id,
        message,
      });

      onUpdateRound(currentRound.id, (existingRound) => ({
        ...updatedRound,
        originalAudioBlob: existingRound.originalAudioBlob,
        attemptAudioBlob: existingRound.attemptAudioBlob,
      }));
      setReactionDraft(
        updatedRound.senderId === currentUserId
          ? (updatedRound.senderReactionMessage ?? '')
          : (updatedRound.recipientReactionMessage ?? ''),
      );
      setIsReactionComposerOpen(false);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to save the reaction.',
      );
    } finally {
      setIsSavingReaction(false);
    }
  };

  const activeRound = round;
  const showRewardPage = activeRound.status === 'complete';
  const isRecipientListenPage = isRecipient && recipientStage === 'listen' && !showRewardPage;
  const roundPromptPackName = activeWordPack?.name ?? 'Word pack';
  const roundPromptPackIconUrl =
    activeWordPack?.campaignCurrency?.iconUrl ?? rewardCampaignIcon;
  const isSenderRewardPage = showRewardPage && !isRecipient;
  const senderReactionMessage = activeRound.senderReactionMessage?.trim() || null;
  const recipientReactionMessage = activeRound.recipientReactionMessage?.trim() || null;
  const ownReactionMessage = recipientReactionMessage;
  const senderReactionLabel = isRecipient ? `${activeRound.senderUsername} reacted` : 'You reacted';
  const recipientReactionLabel = isRecipient
    ? 'You reacted'
    : `${activeRound.recipientUsername} reacted`;
  const reactionComposer = showRewardPage && isRecipient ? (
    <RoundReactionComposer
      buttonLabel={ownReactionMessage ? 'Edit Comment' : 'Add Comment'}
      disabled={isRewardBusy}
      draft={reactionDraft}
      fieldId={`roundReaction-${activeRound.id}`}
      isOpen={isReactionComposerOpen}
      isSaving={isSavingReaction}
      onCancel={() => {
        setReactionDraft(ownReactionMessage ?? '');
        setIsReactionComposerOpen(false);
      }}
      onChange={setReactionDraft}
      onOpen={() => {
        setReactionDraft(ownReactionMessage ?? '');
        setIsReactionComposerOpen(true);
      }}
      onSave={() => {
        void handleSaveReaction();
      }}
    />
  ) : null;
  const rewardResultSummary =
    isRecipient && activeRound.status === 'complete' && scorePresentation ? (
      <div className="reward-reveal-details">
        <p className="reward-reveal-detail is-guess">
          <span>Guess</span>
          <strong>{activeRound.guess || 'No guess submitted'}</strong>
        </p>
        <p className="reward-reveal-detail">
          <span>Mistakes</span>
          <strong>{formatMistakeCount(getRoundMistakeCount(activeRound))}</strong>
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
      </div>

      <div className="reward-review-block">
        <p className="reward-review-line">{activeRound.recipientUsername} heard:</p>
        <RewardPlaybackButton
          blob={reversedAttemptBlob}
          isLoading={isLoadingReversedAttempt}
          loadingLabel="Preparing reversed take..."
          playbackKind="babble"
        />
      </div>

      <div className="reward-review-block">
        <p className="reward-review-line">They Guessed:</p>
        <GuessResultGrid
          correctPhrase={activeRound.correctPhrase}
          events={activeRound.guessEvents}
          guess={activeRound.guess}
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
  const roundScreenClassName = showRewardPage
    ? 'round-screen round-screen-reward'
    : `surface round-screen${isRecipientListenPage ? ' round-listen-screen' : ''}`;

  const handleReadyToImitate = async () => {
    setListenSpendAnimation(null);
    setCoinPreview(null);
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
        playbackKind="babble"
        remoteUrl={activeRound.attemptAudioUrl}
      />
      <AudioPlayerCard
        title="Their imitation reversed"
        description="Generated locally from their saved forward take."
        blob={reversedAttemptBlob}
        isLoading={isLoadingReversedAttempt}
        loadingLabel="Preparing reversed take..."
        playbackKind="babble"
      />
    </div>
  );

  const rewardStatusCard =
    activeRound.status === 'complete' && shouldPlayGuessReplay ? (
      <div className="reward-guess-replay-stage">
        <p>Replaying the guess</p>
        <GuessReplayPanel
          correctPhrase={activeRound.correctPhrase}
          events={activeRound.guessEvents}
          guess={activeRound.guess}
          onComplete={handleGuessReplayComplete}
          playbackKey={activeRound.id}
        />
      </div>
    ) : activeRound.status === 'complete' && roundReward ? (
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
          <RewardAudioWithReaction
            title="Original phrase clip"
            description="Replay the forward clip if you want to compare it to your guess."
            blob={activeRound.originalAudioBlob}
            reactionLabel={senderReactionLabel}
            reactionMessage={senderReactionMessage}
            remoteUrl={activeRound.originalAudioUrl}
          />
        ) : senderRewardReview}
        {isRecipient ? (
          <>
            <RoundReactionThread
              recipientLabel={recipientReactionLabel}
              recipientMessage={recipientReactionMessage}
              senderLabel={senderReactionLabel}
              senderMessage={null}
            />
            {reactionComposer}
          </>
        ) : null}
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
      {!showRewardPage && !isRecipientListenPage ? (
        <div className="round-screen-header">
          <div className="round-screen-copy">
            <div className="eyebrow">{headerEyebrow}</div>
            <h2>{headerTitle}</h2>
            {headerDescription ? <p>{headerDescription}</p> : null}
          </div>
        </div>
      ) : null}

      {isRecipient ? (
        <div className="round-screen-body">
          {recipientStage === 'listen' ? (
            <div className="round-screen-step">
              <RoundPromptMetadata
                difficulty={activeRound.difficulty}
                iconUrl={roundPromptPackIconUrl}
                packName={roundPromptPackName}
              />

              <RoundListenAudioCard
                title={`${activeRound.senderUsername}'s reverse audio`}
                coinSpendAnimation={listenSpendAnimation}
                isPaidReplay={isPaidListenReplay}
                statusLabel={listenStatusLabel}
                blob={reversedPromptBlob}
                isLoading={isLoadingReversedPrompt}
                loadingLabel="Preparing reversed prompt..."
                onCoinSpendAnimationComplete={handleListenSpendAnimationComplete}
                onPlayRequest={handleListenPlaybackRequest}
                playButtonDisabled={isAuthorizingListenPlayback}
              />
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
                playbackKind="babble"
                remoteUrl={round.attemptAudioUrl}
              />
            </div>
          ) : null}

          {recipientStage === 'guess' ? (
            <div className="round-screen-step round-guess-step">
              <AudioPlayerCard
                title="Reversed take"
                description=""
                blob={reversedAttemptBlob}
                isLoading={isLoadingReversedAttempt}
                loadingLabel="Preparing reversed take..."
                playbackKind="babble"
              />

              <div
                aria-label="Type the phrase"
                className={`guess-board${isGuessInputDisabled ? ' is-disabled' : ''}`}
                onClick={() => {
                  guessInputRef.current?.focus({ preventScroll: true });
                }}
                onKeyDown={handleGuessKeyDown}
                role="group"
                tabIndex={isGuessInputDisabled ? -1 : 0}
              >
                <GuessPhraseGrid
                  activeIndex={isGuessInputDisabled ? null : activeGuessIndex}
                  ariaLabel="Type the phrase"
                  cells={guessCells}
                  correctPhrase={activeRound.correctPhrase}
                  onSelectIndex={isGuessInputDisabled ? undefined : setActiveGuessCursorIndex}
                />
                <input
                  aria-label="Type the phrase"
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  className="guess-board-input"
                  disabled={isGuessInputDisabled}
                  enterKeyHint="done"
                  inputMode="text"
                  onChange={handleGuessInputChange}
                  ref={guessInputRef}
                  spellCheck={false}
                  type="text"
                  value=""
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
              Ready!
            </button>
          </div>
        ) : null}

        {isRecipient && recipientStage === 'guess' && (isGuessComplete || isGuessFailed) ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={!canSubmitGuess}
              onClick={() => {
                void handleSubmitGuess();
              }}
              type="button"
            >
              {isSubmittingGuess ? 'Continuing...' : 'Continue'}
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
