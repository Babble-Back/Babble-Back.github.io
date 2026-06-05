import { useEffect, useMemo, useState } from 'react';
import type { RoundGuessEvent } from '../types';
import {
  extractGuessCharacters,
  getGuessTargetIndexes,
  isGuessCharacterCorrect,
  isGuessSpacer,
  isGuessTargetCharacter,
} from '../utils';

export interface GuessCellState {
  value: string;
  correct: boolean;
  animationKey?: number;
  shake?: boolean;
}

export type GuessCellMap = Record<number, GuessCellState | undefined>;

interface GuessPhraseGridProps {
  activeIndex?: number | null;
  ariaLabel?: string;
  cells: GuessCellMap;
  className?: string;
  correctPhrase: string;
  onSelectIndex?: (index: number) => void;
}

interface GuessReplayPanelProps {
  correctPhrase: string;
  events?: RoundGuessEvent[] | null;
  guess: string;
  onComplete: () => void;
  playbackKey: string;
}

interface GuessResultGridProps {
  correctPhrase: string;
  events?: RoundGuessEvent[] | null;
  guess: string;
}

type GuessPhrasePart =
  | {
      characters: Array<
        | {
            index: number;
            type: 'cell';
          }
        | {
            character: string;
            index: number;
            type: 'fixed';
          }
      >;
      type: 'word';
    }
  | {
      index: number;
      type: 'space';
    };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildFallbackEvents(correctPhrase: string, guess: string): RoundGuessEvent[] {
  const phraseCharacters = Array.from(correctPhrase);
  const targetIndexes = getGuessTargetIndexes(correctPhrase);
  const guessCharacters = extractGuessCharacters(guess).slice(0, targetIndexes.length);
  let mistakeCount = 0;

  return guessCharacters.map((value, guessIndex) => {
    const index = targetIndexes[guessIndex] ?? guessIndex;
    const expected = phraseCharacters[index] ?? '';
    const correct = isGuessCharacterCorrect(value, expected);

    if (!correct) {
      mistakeCount += 1;
    }

    return {
      index,
      value,
      expected,
      correct,
      mistakeCount,
      elapsedMs: guessIndex * 420,
    };
  });
}

function getReplaySchedule(events: RoundGuessEvent[]) {
  let elapsedMs = 320;

  return events.map((event, index) => {
    const previousEvent = events[index - 1];
    const rawDelta =
      previousEvent && event.elapsedMs > previousEvent.elapsedMs
        ? event.elapsedMs - previousEvent.elapsedMs
        : 420;
    const delta = clamp(rawDelta * 1.08, 260, 1250);

    elapsedMs += delta;

    return {
      delayMs: elapsedMs,
      event,
    };
  });
}

function getPlaybackEvents(
  correctPhrase: string,
  guess: string,
  events: RoundGuessEvent[] | null | undefined,
) {
  return events && events.length > 0
    ? events
    : buildFallbackEvents(correctPhrase, guess);
}

function buildFinalGuessCells(events: RoundGuessEvent[]) {
  return events.reduce<GuessCellMap>((cells, event, eventIndex) => {
    cells[event.index] = {
      animationKey: eventIndex + 1,
      correct: event.correct,
      value: event.value,
    };

    return cells;
  }, {});
}

function buildGuessPhraseParts(correctPhrase: string) {
  const parts: GuessPhrasePart[] = [];
  let currentWord: Extract<GuessPhrasePart, { type: 'word' }>['characters'] = [];

  Array.from(correctPhrase).forEach((character, index) => {
    if (isGuessSpacer(character)) {
      if (currentWord.length > 0) {
        parts.push({
          characters: currentWord,
          type: 'word',
        });
        currentWord = [];
      }

      parts.push({
        index,
        type: 'space',
      });
      return;
    }

    currentWord.push({
      index,
      ...(isGuessTargetCharacter(character)
        ? {
            type: 'cell' as const,
          }
        : {
            character,
            type: 'fixed' as const,
          }),
    });
  });

  if (currentWord.length > 0) {
    parts.push({
      characters: currentWord,
      type: 'word',
    });
  }

  return parts;
}

export function GuessPhraseGrid({
  activeIndex = null,
  ariaLabel = 'Phrase guess',
  cells,
  className = '',
  correctPhrase,
  onSelectIndex,
}: GuessPhraseGridProps) {
  const phraseParts = useMemo(() => buildGuessPhraseParts(correctPhrase), [correctPhrase]);

  return (
    <div
      aria-label={ariaLabel}
      className={`guess-phrase-grid ${className}`.trim()}
      role="img"
    >
      {phraseParts.map((part, partIndex) => {
        if (part.type === 'space') {
          return (
            <span
              aria-hidden="true"
              className="guess-phrase-space"
              key={`space-${part.index}`}
            />
          );
        }

        return (
          <span aria-hidden="true" className="guess-phrase-word" key={`word-${partIndex}`}>
            {part.characters.map((phraseCharacter) => {
              if (phraseCharacter.type === 'fixed') {
                return (
                  <span
                    aria-hidden="true"
                    className="guess-phrase-fixed-char"
                    key={`fixed-${phraseCharacter.index}`}
                  >
                    {phraseCharacter.character}
                  </span>
                );
              }

              const { index } = phraseCharacter;
              const cell = cells[index];
              const isFilled = Boolean(cell?.value);
              const toneClass = isFilled
                ? cell?.correct
                  ? 'is-correct'
                  : 'is-mistake'
                : 'is-empty';
              const activeClass = activeIndex === index ? 'is-active' : '';
              const shakeClass = cell?.shake ? 'is-shaking' : '';
              const selectableClass = onSelectIndex ? 'is-selectable' : '';

              return (
                <span
                  aria-hidden="true"
                  className={`guess-phrase-cell ${toneClass} ${activeClass} ${shakeClass} ${selectableClass}`.trim()}
                  data-guess-index={index}
                  key={`cell-${index}-${cell?.animationKey ?? 'empty'}`}
                  onClick={onSelectIndex ? () => onSelectIndex(index) : undefined}
                >
                  {cell?.value ?? '_'}
                </span>
              );
            })}
          </span>
        );
      })}
    </div>
  );
}

export function GuessReplayPanel({
  correctPhrase,
  events,
  guess,
  onComplete,
  playbackKey,
}: GuessReplayPanelProps) {
  const playbackEvents = useMemo(
    () => getPlaybackEvents(correctPhrase, guess, events),
    [correctPhrase, events, guess],
  );
  const [cells, setCells] = useState<GuessCellMap>({});
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    setCells({});
    setActiveIndex(null);

    if (playbackEvents.length === 0) {
      const emptyTimer = window.setTimeout(onComplete, 420);

      return () => {
        window.clearTimeout(emptyTimer);
      };
    }

    const schedule = getReplaySchedule(playbackEvents);
    const timers = schedule.map(({ delayMs, event }, eventIndex) =>
      window.setTimeout(() => {
        setActiveIndex(event.index);
        setCells((currentCells) => ({
          ...currentCells,
          [event.index]: {
            animationKey: eventIndex + 1,
            correct: event.correct,
            shake: !event.correct,
            value: event.value,
          },
        }));
      }, delayMs),
    );
    const finalDelayMs = (schedule[schedule.length - 1]?.delayMs ?? 0) + 1100;
    const completeTimer = window.setTimeout(() => {
      setActiveIndex(null);
      onComplete();
    }, finalDelayMs);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(completeTimer);
    };
  }, [onComplete, playbackEvents, playbackKey]);

  return (
    <div className="guess-replay-card" aria-live="polite">
      <GuessPhraseGrid
        activeIndex={activeIndex}
        ariaLabel="Guess replay"
        cells={cells}
        correctPhrase={correctPhrase}
      />
    </div>
  );
}

export function GuessResultGrid({
  correctPhrase,
  events,
  guess,
}: GuessResultGridProps) {
  const cells = useMemo(
    () => buildFinalGuessCells(getPlaybackEvents(correctPhrase, guess, events)),
    [correctPhrase, events, guess],
  );

  return (
    <GuessPhraseGrid
      ariaLabel="Final guess"
      cells={cells}
      className="guess-phrase-grid-final"
      correctPhrase={correctPhrase}
    />
  );
}
