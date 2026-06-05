import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { WaveformLoader } from '../../../components/WaveformLoader';
import {
  completeChatRound,
  createChatRoundRecord,
  listFriendChatRounds,
  markChatThreadRead,
  markRoundResultsViewed,
  maxChatPhraseLength,
  saveChatRoundAttempt,
} from '../../../lib/rounds';
import type { Friend } from '../../social/types';
import type { Round, RoundGuessEvent } from '../types';
import {
  composeGuessTextFromEntries,
  composeGuessTextFromEvents,
  getGuessTargetIndexes,
  isGuessCharacterCorrect,
  isGuessSpacer,
} from '../utils';
import {
  GuessPhraseGrid,
  GuessReplayPanel,
  GuessResultGrid,
  type GuessCellMap,
} from './GuessPhraseGrid';
import { useObjectUrl } from '../../../audio/hooks/useObjectUrl';
import { WaveformPlayButton } from '../../../components/WaveformPlayButton';

interface ChatThreadPanelProps {
  currentUserId: string;
  currentUserUsername: string;
  friend: Friend;
  onBack: () => void;
  onThreadChanged?: () => Promise<void> | void;
}

interface GuessEntry {
  phraseIndex: number;
  value: string;
  correct: boolean;
  shake?: boolean;
}

type AudioRecorderControls = ReturnType<typeof useAudioRecorder>;
type ComposerStage = 'phrase' | 'record';

interface PreparedChatRoundAudio {
  reversedAttemptBlob: Blob | null;
  reversedPromptBlob: Blob | null;
}

const EMPTY_PREPARED_CHAT_AUDIO: PreparedChatRoundAudio = {
  reversedAttemptBlob: null,
  reversedPromptBlob: null,
};

const reversedRemoteAudioCache = new Map<string, Promise<Blob>>();
const reversedBlobAudioCache = new WeakMap<Blob, Promise<Blob>>();

async function fetchAudioBlob(remoteUrl: string) {
  const response = await fetch(remoteUrl);

  if (!response.ok) {
    throw new Error(`Unable to load the audio file (${response.status}).`);
  }

  return response.blob();
}

function getReversedAudioBlob({
  blob,
  remoteUrl,
}: {
  blob?: Blob | null;
  remoteUrl?: string | null;
}) {
  if (blob) {
    const cachedBlobPromise = reversedBlobAudioCache.get(blob);

    if (cachedBlobPromise) {
      return cachedBlobPromise;
    }

    const nextBlobPromise = reverseAudioBlob(blob).catch((error) => {
      reversedBlobAudioCache.delete(blob);
      throw error;
    });
    reversedBlobAudioCache.set(blob, nextBlobPromise);
    return nextBlobPromise;
  }

  if (!remoteUrl) {
    return null;
  }

  const cachedRemotePromise = reversedRemoteAudioCache.get(remoteUrl);

  if (cachedRemotePromise) {
    return cachedRemotePromise;
  }

  const nextRemotePromise = fetchAudioBlob(remoteUrl)
    .then((sourceBlob) => reverseAudioBlob(sourceBlob))
    .catch((error) => {
      reversedRemoteAudioCache.delete(remoteUrl);
      throw error;
    });
  reversedRemoteAudioCache.set(remoteUrl, nextRemotePromise);
  return nextRemotePromise;
}

function RecordingReviewActions({
  audioBlob,
  disabled,
  isSending,
  onRedo,
  onSend,
  playbackKind = 'normal',
}: {
  audioBlob: Blob | null;
  disabled?: boolean;
  isSending?: boolean;
  onRedo: () => void;
  onSend: () => void;
  playbackKind?: 'normal' | 'babble';
}) {
  const audioUrl = useObjectUrl(audioBlob);

  if (!audioUrl) {
    return null;
  }

  return (
    <div className="chat-recording-review-row">
      <button
        aria-label="Redo recording"
        className="button ghost chat-recording-review-icon chat-recording-review-redo"
        disabled={disabled}
        onClick={onRedo}
        type="button"
      >
        <RedoIcon />
      </button>
      <WaveformPlayButton
        className="chat-recording-review-play"
        disabled={disabled}
        inactiveAriaLabel="Play recording"
        playbackKind={playbackKind}
        size={76}
        src={audioUrl}
      />
      <button
        aria-label={isSending ? 'Sending recording' : 'Send recording'}
        className="button primary chat-recording-review-icon chat-recorder-send chat-recorder-send-icon"
        disabled={disabled}
        onClick={onSend}
        type="button"
      >
        <SendIcon />
      </button>
    </div>
  );
}

function BackArrowIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M13 6 7 12l6 6M8 12h10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.8"
      />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M7.2 8.2a7 7 0 1 1-.2 9.5M7.2 8.2H3.6V4.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="m4.5 12.4 14.8-7.2-4.8 15.2-3.2-6.4-6.8-1.6Zm6.8 1.6 3.8-4.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" className="chat-thread-icon" fill="none" viewBox="0 0 24 24">
      <path
        d="M5 7.6c0-2 1.7-3.6 3.8-3.6h6.4C17.3 4 19 5.6 19 7.6v4.1c0 2-1.7 3.6-3.8 3.6h-3.9l-4.1 3.2v-3.2C5.9 14.8 5 13.4 5 11.8V7.6Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M9 9.2h6M9 12h3.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function getFriendInitial(username: string) {
  return Array.from(username.trim())[0]?.toUpperCase() || '?';
}

function sortRounds(rounds: Round[]) {
  return [...rounds].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function formatMessageTime(createdAt: string) {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatThreadDate(createdAt: string) {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = formatMessageTime(createdAt);

  if (isToday) {
    return `Today ${time}`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function upsertRound(rounds: Round[], nextRound: Round) {
  const existingIndex = rounds.findIndex((round) => round.id === nextRound.id);

  if (existingIndex === -1) {
    return sortRounds([...rounds, nextRound]);
  }

  return sortRounds(
    rounds.map((round) =>
      round.id === nextRound.id
        ? {
            ...nextRound,
            originalAudioBlob: nextRound.originalAudioBlob ?? round.originalAudioBlob,
            attemptAudioBlob: nextRound.attemptAudioBlob ?? round.attemptAudioBlob,
          }
        : round,
    ),
  );
}

function hasCurrentUserViewedRound(round: Round, currentUserId: string) {
  return round.senderId === currentUserId
    ? Boolean(round.senderViewedResultsAt)
    : Boolean(round.recipientViewedResultsAt);
}

function isCollapsedTranscript(round: Round) {
  return Boolean(
    round.status === 'complete' &&
      (round.chatCollapsedAt ||
        (round.senderViewedResultsAt && round.recipientViewedResultsAt)),
  );
}

function needsReversedPromptForChat(round: Round, currentUserId: string) {
  return Boolean(
    !isCollapsedTranscript(round) &&
      round.senderId !== currentUserId &&
      (round.originalAudioBlob || round.originalAudioUrl),
  );
}

function needsReversedAttemptForChat(round: Round, currentUserId: string) {
  if (
    isCollapsedTranscript(round) ||
    !(round.attemptAudioBlob || round.attemptAudioUrl)
  ) {
    return false;
  }

  return round.status === 'complete' || (
    round.status === 'attempted' && round.recipientId === currentUserId
  );
}

function getChatAudioPreparationError(error: unknown) {
  return error instanceof Error
    ? `Unable to prepare chat audio: ${error.message}`
    : 'Unable to prepare chat audio.';
}

function getBubbleStatus(round: Round, isOutgoing: boolean) {
  if (round.status === 'complete') {
    return round.chatGaveUp
      ? isOutgoing
        ? 'They gave up'
        : 'You gave up'
      : isOutgoing
        ? 'They solved it'
        : 'Solved it';
  }

  if (round.status === 'attempted') {
    return isOutgoing ? 'They sent a take' : 'Guess the phrase';
  }

  return '';
}

function ChatRoundBubble({
  currentUserId,
  onSelectActionRound,
  preparedAudio,
  rowRef,
  round,
}: {
  currentUserId: string;
  onSelectActionRound?: (roundId: string) => void;
  preparedAudio: PreparedChatRoundAudio;
  rowRef?: (element: HTMLElement | null) => void;
  round: Round;
}) {
  const isOutgoing = round.senderId === currentUserId;
  const collapsed = isCollapsedTranscript(round);
  const statusLabel = getBubbleStatus(round, isOutgoing);
  const createdTime = formatMessageTime(round.createdAt);
  const handleReplayComplete = useCallback(() => undefined, []);
  const { reversedAttemptBlob, reversedPromptBlob } = preparedAudio;
  const shouldSelectOnPlay =
    !isOutgoing && (round.status === 'waiting_for_attempt' || round.status === 'attempted');
  const handleSelectOnPlay = shouldSelectOnPlay
    ? () => {
        onSelectActionRound?.(round.id);
      }
    : undefined;
  const renderBubble = ({
    bubbleClassName = '',
    children,
    rowIsOutgoing,
    showTime = false,
    topLabel = '',
  }: {
    bubbleClassName?: string;
    children: ReactNode;
    rowIsOutgoing: boolean;
    showTime?: boolean;
    topLabel?: string;
  }) => (
    <article className={`chat-bubble-row ${rowIsOutgoing ? 'is-outgoing' : 'is-incoming'}`} ref={rowRef}>
      <div className="chat-message-frame">
        <div className="chat-bubble-topline">
          {topLabel ? <span>{topLabel}</span> : null}
          {showTime && createdTime ? <time dateTime={round.createdAt}>{createdTime}</time> : null}
        </div>

        <div className={`chat-bubble ${bubbleClassName}`}>
          {children}
        </div>
      </div>
    </article>
  );

  const renderOriginalPromptBubble = (options?: { showTime?: boolean }) => {
    const shouldShowPhrase = isOutgoing || round.status === 'complete';

    return renderBubble({
      bubbleClassName: `is-${round.status} is-audio-only${shouldShowPhrase ? ' is-prompt-with-text' : ''}`,
      rowIsOutgoing: isOutgoing,
      showTime: options?.showTime,
      children: (
        <div className="chat-bubble-stack">
          <AudioPlayerCard
            title={isOutgoing ? 'Your prompt' : 'Reversed challenge'}
            blob={isOutgoing ? round.originalAudioBlob : reversedPromptBlob}
            onPlayRequest={handleSelectOnPlay}
            remoteUrl={isOutgoing ? round.originalAudioUrl : null}
          />
          {shouldShowPhrase ? (
            <p className="chat-transcript">
              {round.correctPhrase}
            </p>
          ) : null}
        </div>
      ),
    });
  };

  const renderRevealedPhraseBubble = () =>
    renderBubble({
      bubbleClassName: 'is-complete is-text-only',
      rowIsOutgoing: isOutgoing,
      children: (
        <p className="chat-transcript">
          {round.correctPhrase}
        </p>
      ),
    });

  if (collapsed) {
    return renderBubble({
      bubbleClassName: `is-${round.status} is-collapsed`,
      rowIsOutgoing: isOutgoing,
      showTime: true,
      topLabel: statusLabel,
      children: (
          <p className="chat-transcript">
            {round.correctPhrase}
          </p>
      ),
    });
  }

  if (round.status === 'complete') {
    const recipientSideIsOutgoing = round.recipientId === currentUserId;
    const guessPanel = isOutgoing ? (
      <GuessReplayPanel
        correctPhrase={round.correctPhrase}
        events={round.guessEvents}
        guess={round.guess}
        onComplete={handleReplayComplete}
        playbackKey={`${round.id}-${round.guessEvents.length}`}
      />
    ) : (
      <GuessResultGrid
        correctPhrase={round.correctPhrase}
        events={round.guessEvents}
        guess={round.guess}
      />
    );

    return (
      <>
        {round.originalAudioBlob || round.originalAudioUrl
          ? renderOriginalPromptBubble({ showTime: true })
          : renderRevealedPhraseBubble()}
        {round.attemptAudioBlob || round.attemptAudioUrl
          ? renderBubble({
              bubbleClassName: 'is-complete is-guess-playback-combo',
              rowIsOutgoing: recipientSideIsOutgoing,
              children: (
                <div className="chat-guess-playback-combo">
                  <AudioPlayerCard
                    title="Reversed imitation"
                    blob={reversedAttemptBlob}
                    playbackKind="babble"
                  />
                  {guessPanel}
                </div>
              ),
            })
          : renderBubble({
              bubbleClassName: 'is-complete is-guess-only',
              rowIsOutgoing: recipientSideIsOutgoing,
              children: guessPanel,
            })}
      </>
    );
  }

  if (round.status === 'attempted') {
    const recipientSideIsOutgoing = round.recipientId === currentUserId;

    return (
      <>
        {renderOriginalPromptBubble({ showTime: true })}
        {renderBubble({
          bubbleClassName: 'is-attempted is-audio-only',
          rowIsOutgoing: recipientSideIsOutgoing,
          children: (
            <div className="chat-bubble-stack">
              <AudioPlayerCard
                title={recipientSideIsOutgoing ? 'Your reversed take' : 'Their imitation'}
                blob={recipientSideIsOutgoing ? reversedAttemptBlob : round.attemptAudioBlob}
                onPlayRequest={handleSelectOnPlay}
                playbackKind="babble"
                remoteUrl={recipientSideIsOutgoing ? null : round.attemptAudioUrl}
              />
            </div>
          ),
        })}
      </>
    );
  }

  return (
    <>
      {renderOriginalPromptBubble({ showTime: true })}
    </>
  );
}

function ChatGuessTray({
  currentUserId,
  onRoundUpdated,
  reversedAttemptBlob,
  round,
}: {
  currentUserId: string;
  onRoundUpdated: (round: Round) => void;
  reversedAttemptBlob: Blob | null;
  round: Round;
}) {
  const guessInputRef = useRef<HTMLInputElement | null>(null);
  const guessStartedAtRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [guessEntries, setGuessEntries] = useState<GuessEntry[]>([]);
  const [guessEvents, setGuessEvents] = useState<RoundGuessEvent[]>(round.guessEvents);
  const [guessMistakeCount, setGuessMistakeCount] = useState(round.guessMistakeCount ?? 0);
  const [guessFeedback, setGuessFeedback] = useState<GuessEntry | null>(null);
  const [isGuessAnimating, setIsGuessAnimating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guessTargetIndexes = useMemo(
    () => getGuessTargetIndexes(round.correctPhrase),
    [round.correctPhrase],
  );
  const guessCells = useMemo<GuessCellMap>(() => {
    const cells = guessEntries.reduce<GuessCellMap>((nextCells, entry) => {
      nextCells[entry.phraseIndex] = {
        correct: entry.correct,
        shake: entry.shake,
        value: entry.value,
      };

      return nextCells;
    }, {});

    if (guessFeedback) {
      cells[guessFeedback.phraseIndex] = {
        correct: guessFeedback.correct,
        shake: guessFeedback.shake,
        value: guessFeedback.value,
      };
    }

    return cells;
  }, [guessEntries, guessFeedback]);
  const activeGuessIndex = guessTargetIndexes[guessEntries.length] ?? null;
  const isGuessComplete =
    guessTargetIndexes.length > 0 && guessEntries.length >= guessTargetIndexes.length;
  const isGuessInputDisabled =
    isSubmitting || !reversedAttemptBlob;

  useEffect(() => {
    setGuessEntries([]);
    setGuessEvents(round.guessEvents);
    setGuessMistakeCount(round.guessMistakeCount ?? 0);
    setGuessFeedback(null);
    setIsGuessAnimating(false);
    guessStartedAtRef.current = null;

    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
    };
  }, [round.id, round.guessEvents, round.guessMistakeCount]);

  useEffect(() => {
    if (isGuessInputDisabled || round.recipientId !== currentUserId) {
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
  }, [currentUserId, guessEntries.length, isGuessInputDisabled, round.id, round.recipientId]);

  const finishRound = async (options: {
    entries: GuessEntry[];
    events: RoundGuessEvent[];
    gaveUp: boolean;
    mistakeCount: number;
  }) => {
    const guess = options.gaveUp
      ? composeGuessTextFromEvents(round.correctPhrase, options.events)
      : composeGuessTextFromEntries(round.correctPhrase, options.entries);

    setError(null);
    setIsSubmitting(true);

    try {
      const updatedRound = await completeChatRound({
        gaveUp: options.gaveUp,
        guess,
        guessEvents: options.events,
        guessMistakeCount: options.mistakeCount,
        roundId: round.id,
      });

      onRoundUpdated({
        ...updatedRound,
        attemptAudioBlob: round.attemptAudioBlob,
        originalAudioBlob: round.originalAudioBlob,
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to finish this round.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGuessCharacter = (rawCharacter: string) => {
    if (
      isGuessInputDisabled ||
      isGuessAnimating ||
      isGuessComplete ||
      isGuessSpacer(rawCharacter) ||
      round.recipientId !== currentUserId
    ) {
      return;
    }

    const targetIndex = guessTargetIndexes[guessEntries.length];

    if (typeof targetIndex !== 'number') {
      return;
    }

    const phraseCharacters = Array.from(round.correctPhrase);
    const expected = phraseCharacters[targetIndex] ?? '';
    const value = Array.from(rawCharacter)[0] ?? '';
    const correct = isGuessCharacterCorrect(value, expected);
    const nextMistakeCount = guessMistakeCount + (correct ? 0 : 1);
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();

    if (guessStartedAtRef.current === null) {
      guessStartedAtRef.current = now;
    }

    const nextEntry: GuessEntry = {
      phraseIndex: targetIndex,
      value,
      correct,
      shake: !correct,
    };
    const nextEvent: RoundGuessEvent = {
      attemptIndex: 0,
      correct,
      elapsedMs: Math.max(0, Math.round(now - guessStartedAtRef.current)),
      expected,
      index: targetIndex,
      mistakeCount: nextMistakeCount,
      value,
    };
    const nextEntries = correct ? [...guessEntries, nextEntry] : guessEntries;
    const nextEvents = [...guessEvents, nextEvent];
    const didCompleteGuess = correct && nextEntries.length >= guessTargetIndexes.length;

    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }

    setGuessFeedback(nextEntry);
    setGuessEvents(nextEvents);
    setGuessMistakeCount(nextMistakeCount);
    setIsGuessAnimating(true);

    feedbackTimerRef.current = window.setTimeout(() => {
      if (correct) {
        setGuessEntries(nextEntries);
      }

      setGuessFeedback(null);
      setIsGuessAnimating(false);

      if (didCompleteGuess) {
        void finishRound({
          entries: nextEntries,
          events: nextEvents,
          gaveUp: false,
          mistakeCount: nextMistakeCount,
        });
      }
    }, correct ? 180 : 460);
  };

  const handleGuessKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') {
      event.preventDefault();
      return;
    }

    if (event.key.length !== 1) {
      return;
    }

    event.preventDefault();
    handleGuessCharacter(event.key);
  };

  const handleGuessInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextCharacter = Array.from(event.currentTarget.value).find(
      (character) => !isGuessSpacer(character),
    );

    event.currentTarget.value = '';

    if (nextCharacter) {
      handleGuessCharacter(nextCharacter);
    }
  };

  const handleGiveUp = () => {
    if (isSubmitting) {
      return;
    }

    void finishRound({
      entries: guessEntries,
      events: guessEvents,
      gaveUp: true,
      mistakeCount: guessMistakeCount,
    });
  };

  return (
    <div className="chat-input-tray chat-guess-tray">
      <div className="chat-guess-card-head">
        <div className="chat-guess-card-title">
          <span className="chat-guess-card-icon" aria-hidden="true">
            <ChatIcon />
          </span>
          <strong>Guess the phrase!</strong>
        </div>
        <button className="button ghost chat-give-up-button" disabled={isSubmitting} onClick={handleGiveUp} type="button">
          Give up
        </button>
      </div>

      <div className="chat-guess-combo-bubble">
        <AudioPlayerCard
          title="Your take backwards"
          blob={reversedAttemptBlob}
          playButtonSize={74}
          playbackKind="babble"
        />

        <div
          aria-label="Guess what your friend said"
          className={`guess-board chat-guess-board${isGuessInputDisabled ? ' is-disabled' : ''}`}
          onClick={() => guessInputRef.current?.focus({ preventScroll: true })}
          onKeyDown={handleGuessKeyDown}
          role="group"
          tabIndex={isGuessInputDisabled ? -1 : 0}
        >
          <GuessPhraseGrid
            activeIndex={isGuessInputDisabled ? null : activeGuessIndex}
            ariaLabel="Guess what your friend said"
            cells={guessCells}
            correctPhrase={round.correctPhrase}
          />
          <input
            aria-label="Guess what your friend said"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            autoFocus
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

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}

function ChatRecorderTray({
  currentUserId,
  onRoundUpdated,
  recorder,
  round,
}: {
  currentUserId: string;
  onRoundUpdated: (round: Round) => void;
  recorder: AudioRecorderControls;
  round: Round;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasRecordedTake = Boolean(recorder.audioBlob);

  const handleSaveAttempt = async () => {
    if (!recorder.audioBlob) {
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const savedRound = await saveChatRoundAttempt({
        attemptAudioBlob: recorder.audioBlob,
        currentUserId,
        roundId: round.id,
      });

      onRoundUpdated({
        ...savedRound,
        attemptAudioBlob: recorder.audioBlob,
        originalAudioBlob: round.originalAudioBlob,
      });
      recorder.clearRecording();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save your take.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="chat-input-tray chat-record-tray">
      {hasRecordedTake ? (
        <RecordingReviewActions
          audioBlob={recorder.audioBlob}
          disabled={recorder.isRecording || isSaving}
          isSending={isSaving}
          onRedo={recorder.clearRecording}
          onSend={() => {
            void handleSaveAttempt();
          }}
          playbackKind="babble"
        />
      ) : (
        <ToggleRecordButton
          disabled={isSaving}
          isPreparing={recorder.isPreparing}
          isRecording={recorder.isRecording}
          liveStream={recorder.liveStream}
          onStart={recorder.startRecording}
          onStop={recorder.stopRecording}
        />
      )}

      {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}

function ChatComposerTray({
  currentUserId,
  friend,
  onRoundCreated,
  recorder,
}: {
  currentUserId: string;
  currentUserUsername: string;
  friend: Friend;
  onRoundCreated: (round: Round) => void;
  recorder: AudioRecorderControls;
}) {
  const [stage, setStage] = useState<ComposerStage>('phrase');
  const [phraseDraft, setPhraseDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRecord = phraseDraft.trim().length > 0 && phraseDraft.trim().length <= maxChatPhraseLength;
  const canSend =
    Boolean(recorder.audioBlob) && !recorder.isPreparing && !recorder.isRecording && !isSending;

  const handleEnterRecordStage = async () => {
    if (!canRecord) {
      return;
    }

    setError(null);

    try {
      await recorder.prepareRecording();
      setStage('record');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to start recording.');
    }
  };

  const handleSendPrompt = async () => {
    if (!recorder.audioBlob) {
      return;
    }

    setError(null);
    setIsSending(true);

    try {
      const createdRound = await createChatRoundRecord({
        correctPhrase: phraseDraft,
        currentUserId,
        originalAudioBlob: recorder.audioBlob,
        recipientId: friend.id,
      });

      onRoundCreated(createdRound);
      setPhraseDraft('');
      setStage('phrase');
      recorder.clearRecording();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to send this recording.',
      );
    } finally {
      setIsSending(false);
    }
  };

  if (stage === 'phrase') {
    return (
      <div className="chat-input-tray chat-compose-tray">
        <div className="field chat-phrase-field">
          <input
            aria-label={`Message ${friend.username}`}
            id="chatPhrase"
            maxLength={maxChatPhraseLength}
            onChange={(event) => setPhraseDraft(event.target.value)}
            placeholder={`Message ${friend.username}`}
            value={phraseDraft}
          />
        </div>
        <div className="button-row chat-tray-actions chat-compose-actions">
          <button
            aria-label={`Record message for ${friend.username}`}
            className="button primary chat-compose-send-button"
            disabled={!canRecord}
            onClick={() => {
              void handleEnterRecordStage();
            }}
            type="button"
          >
            <SendIcon />
          </button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="chat-input-tray chat-record-tray">
      {recorder.audioBlob ? (
        <RecordingReviewActions
          audioBlob={recorder.audioBlob}
          disabled={!canSend}
          isSending={isSending}
          onRedo={recorder.clearRecording}
          onSend={() => {
            void handleSendPrompt();
          }}
        />
      ) : (
        <>
          <div className="chat-record-phrase">
            <span>Say:</span>
            <strong>{phraseDraft}</strong>
          </div>

          <ToggleRecordButton
            disabled={isSending}
            isPreparing={recorder.isPreparing}
            isRecording={recorder.isRecording}
            liveStream={recorder.liveStream}
            onStart={recorder.startRecording}
            onStop={recorder.stopRecording}
          />
        </>
      )}

      {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}

export function ChatThreadPanel({
  currentUserId,
  currentUserUsername,
  friend,
  onBack,
  onThreadChanged,
}: ChatThreadPanelProps) {
  const recorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const markingViewedKeyRef = useRef('');
  const roundRowRefs = useRef(new Map<string, HTMLElement>());
  const [rounds, setRounds] = useState<Round[]>([]);
  const [preparedAudioByRoundId, setPreparedAudioByRoundId] = useState<
    Record<string, PreparedChatRoundAudio>
  >({});
  const [isPreparingChatAudio, setIsPreparingChatAudio] = useState(false);
  const [audioPreparationError, setAudioPreparationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestScrollRequest, setLatestScrollRequest] = useState(0);
  const [selectedActionRoundId, setSelectedActionRoundId] = useState<string | null>(null);
  const roundsScrollKey = useMemo(
    () =>
      rounds
        .map(
          (round) =>
            `${round.id}:${round.status}:${round.chatCollapsedAt ?? ''}:${round.senderViewedResultsAt ?? ''}:${round.recipientViewedResultsAt ?? ''}`,
        )
        .join('|'),
    [rounds],
  );
  const selectedActionRound = useMemo(
    () =>
      rounds.find(
        (round) =>
          round.id === selectedActionRoundId &&
          round.status !== 'complete' &&
          round.recipientId === currentUserId,
      ) ?? null,
    [currentUserId, rounds, selectedActionRoundId],
  );
  const hasUnpreparedChatAudio = useMemo(() => {
    if (isLoading || audioPreparationError) {
      return false;
    }

    return rounds.some((round) => {
      const preparedAudio = preparedAudioByRoundId[round.id];
      const needsPrompt = needsReversedPromptForChat(round, currentUserId);
      const needsAttempt = needsReversedAttemptForChat(round, currentUserId);

      return Boolean(
        (needsPrompt && !preparedAudio?.reversedPromptBlob) ||
          (needsAttempt && !preparedAudio?.reversedAttemptBlob),
      );
    });
  }, [audioPreparationError, currentUserId, isLoading, preparedAudioByRoundId, rounds]);
  const isChatPreparing = isLoading || isPreparingChatAudio || hasUnpreparedChatAudio;
  const canRenderChat = !isChatPreparing && !audioPreparationError;

  const loadRounds = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const nextRounds = await listFriendChatRounds({
          currentUserId,
          friendId: friend.id,
        });
        setRounds(nextRounds);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load chat.');
      } finally {
        if (!options?.silent) {
          setIsLoading(false);
        }
      }
    },
    [currentUserId, friend.id],
  );

  useEffect(() => {
    void loadRounds();
  }, [loadRounds]);

  useEffect(() => {
    if (isLoading) {
      setIsPreparingChatAudio(false);
      setAudioPreparationError(null);
      return;
    }

    const roundsNeedingPreparedAudio = rounds.filter(
      (round) =>
        needsReversedPromptForChat(round, currentUserId) ||
        needsReversedAttemptForChat(round, currentUserId),
    );

    if (roundsNeedingPreparedAudio.length === 0) {
      setPreparedAudioByRoundId({});
      setIsPreparingChatAudio(false);
      setAudioPreparationError(null);
      return;
    }

    let cancelled = false;
    setIsPreparingChatAudio(true);
    setAudioPreparationError(null);

    const prepareChatAudio = async () => {
      try {
        const preparedEntries = await Promise.all(
          roundsNeedingPreparedAudio.map(async (round) => {
            const preparedAudio: PreparedChatRoundAudio = {
              reversedAttemptBlob: null,
              reversedPromptBlob: null,
            };

            if (needsReversedPromptForChat(round, currentUserId)) {
              preparedAudio.reversedPromptBlob = await getReversedAudioBlob({
                blob: round.originalAudioBlob,
                remoteUrl: round.originalAudioUrl,
              });
            }

            if (needsReversedAttemptForChat(round, currentUserId)) {
              preparedAudio.reversedAttemptBlob = await getReversedAudioBlob({
                blob: round.attemptAudioBlob,
                remoteUrl: round.attemptAudioUrl,
              });
            }

            return [round.id, preparedAudio] as const;
          }),
        );

        if (!cancelled) {
          setPreparedAudioByRoundId(Object.fromEntries(preparedEntries));
        }
      } catch (caughtError) {
        if (!cancelled) {
          setPreparedAudioByRoundId({});
          setAudioPreparationError(getChatAudioPreparationError(caughtError));
        }
      } finally {
        if (!cancelled) {
          setIsPreparingChatAudio(false);
        }
      }
    };

    void prepareChatAudio();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, isLoading, rounds]);

  useEffect(() => {
    let cancelled = false;

    const markThreadRead = async () => {
      try {
        await markChatThreadRead(friend.id);

        if (!cancelled) {
          void onThreadChanged?.();
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to mark this chat as read.',
          );
        }
      }
    };

    void markThreadRead();

    return () => {
      cancelled = true;
    };
  }, [friend.id, onThreadChanged]);

  useEffect(() => {
    recorder.clearRecording();
  }, [selectedActionRound?.id]);

  useEffect(() => {
    if (isChatPreparing || selectedActionRoundId) {
      return;
    }

    const chatBody = chatBodyRef.current;

    if (!chatBody) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'auto' });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [friend.id, isChatPreparing, roundsScrollKey, selectedActionRoundId]);

  useEffect(() => {
    if (!latestScrollRequest || !canRenderChat) {
      return;
    }

    const chatBody = chatBodyRef.current;

    if (!chatBody) {
      return;
    }

    let timeout: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'smooth' });
      timeout = window.setTimeout(() => {
        chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: 'auto' });
      }, 180);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [canRenderChat, latestScrollRequest, roundsScrollKey]);

  useEffect(() => {
    if (!selectedActionRoundId || !canRenderChat) {
      return;
    }

    const chatBody = chatBodyRef.current;
    const selectedRow = roundRowRefs.current.get(selectedActionRoundId);

    if (!chatBody || !selectedRow) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const bodyRect = chatBody.getBoundingClientRect();
      const rowRect = selectedRow.getBoundingClientRect();
      const topPadding = 16;
      const bottomPadding = 20;
      let nextScrollTop = chatBody.scrollTop;

      if (rowRect.bottom > bodyRect.bottom - bottomPadding) {
        nextScrollTop += rowRect.bottom - (bodyRect.bottom - bottomPadding);
      }

      if (rowRect.top < bodyRect.top + topPadding) {
        nextScrollTop -= bodyRect.top + topPadding - rowRect.top;
      }

      if (Math.abs(nextScrollTop - chatBody.scrollTop) > 1) {
        chatBody.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [canRenderChat, selectedActionRound?.status, selectedActionRoundId]);

  useEffect(() => {
    const roundsToMark = rounds.filter(
      (round) =>
        round.status === 'complete' &&
        round.roundMode === 'chat' &&
        !hasCurrentUserViewedRound(round, currentUserId),
    );
    const nextKey = roundsToMark.map((round) => round.id).join(',');

    if (!nextKey || markingViewedKeyRef.current === nextKey) {
      return;
    }

    let cancelled = false;
    markingViewedKeyRef.current = nextKey;

    const markViewed = async () => {
      try {
        await Promise.all(roundsToMark.map((round) => markRoundResultsViewed(round.id)));

        if (!cancelled) {
          await loadRounds({ silent: true });
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to update viewed chat results.',
          );
        }
      }
    };

    void markViewed();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, loadRounds, rounds]);

  const handleRoundCreated = (round: Round) => {
    setRounds((currentRounds) => upsertRound(currentRounds, round));
    setLatestScrollRequest((currentRequest) => currentRequest + 1);
    void onThreadChanged?.();
  };

  const handleRoundUpdated = (round: Round) => {
    setRounds((currentRounds) => upsertRound(currentRounds, round));
    if (round.status === 'complete') {
      setSelectedActionRoundId((currentRoundId) =>
        currentRoundId === round.id ? null : currentRoundId,
      );
    }
    void onThreadChanged?.();
  };

  const renderTray = () => {
    if (!canRenderChat) {
      return null;
    }

    if (!selectedActionRound) {
      return (
        <ChatComposerTray
          currentUserId={currentUserId}
          currentUserUsername={currentUserUsername}
          friend={friend}
          onRoundCreated={handleRoundCreated}
          recorder={recorder}
        />
      );
    }

    if (selectedActionRound.status === 'waiting_for_attempt') {
      return (
        <ChatRecorderTray
          currentUserId={currentUserId}
          onRoundUpdated={handleRoundUpdated}
          recorder={recorder}
          round={selectedActionRound}
        />
      );
    }

    return (
      <ChatGuessTray
        currentUserId={currentUserId}
        onRoundUpdated={handleRoundUpdated}
        reversedAttemptBlob={
          preparedAudioByRoundId[selectedActionRound.id]?.reversedAttemptBlob ?? null
        }
        round={selectedActionRound}
      />
    );
  };
  const firstRoundDate = rounds[0]?.createdAt ? formatThreadDate(rounds[0].createdAt) : '';

  return (
    <section className="chat-thread-shell">
      <div className="chat-thread-header">
        <button aria-label="Back to friends" className="chat-thread-back" onClick={onBack} type="button">
          <BackArrowIcon />
        </button>
        <div className="chat-thread-avatar-wrap" aria-hidden="true">
          <div className="chat-thread-avatar">
            {getFriendInitial(friend.username)}
          </div>
          <span className="chat-thread-presence-dot" />
        </div>
        <div className="chat-thread-title">
          <h2>{friend.username}</h2>
        </div>
      </div>

      <div className="chat-thread-body" ref={chatBodyRef} role="log" aria-live="polite">
        {isChatPreparing ? (
          <div className="chat-loading">
            <WaveformLoader size={86} strokeWidth={4} />
            <strong>Loading chat...</strong>
          </div>
        ) : audioPreparationError ? (
          <div className="chat-empty-state">
            <ChatIcon />
            <strong>Unable to load chat audio.</strong>
          </div>
        ) : rounds.length === 0 ? (
          <div className="chat-empty-state">
            <ChatIcon />
            <strong>Send the first backwards challenge.</strong>
            <p>Type what you will say, record it, and {friend.username} will hear it reversed.</p>
          </div>
        ) : (
          <>
            {firstRoundDate ? <div className="chat-date-divider">{firstRoundDate}</div> : null}
            {rounds.map((round) => (
              <ChatRoundBubble
                currentUserId={currentUserId}
                key={round.id}
                onSelectActionRound={setSelectedActionRoundId}
                preparedAudio={preparedAudioByRoundId[round.id] ?? EMPTY_PREPARED_CHAT_AUDIO}
                rowRef={(element) => {
                  if (element) {
                    roundRowRefs.current.set(round.id, element);
                    return;
                  }

                  roundRowRefs.current.delete(round.id);
                }}
                round={round}
              />
            ))}
          </>
        )}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {audioPreparationError ? <div className="error-banner">{audioPreparationError}</div> : null}
      {renderTray()}
    </section>
  );
}
