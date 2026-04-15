import type { Round } from './types';

type StarTone = 'zero' | 'one' | 'two' | 'three' | 'pending';

export interface ScorePresentation {
  starCount: number | null;
  starLabel: string;
  description: string;
  celebration: string;
  tone: StarTone;
}

export interface RoundSummary {
  headline: string;
  description: string;
  callToAction: string;
}

export function scoreToStars(score: number | null): number | null {
  if (score === null) {
    return null;
  }

  if (score === 10) {
    return 3;
  }

  if (score >= 8) {
    return 2;
  }

  if (score >= 5) {
    return 1;
  }

  return 0;
}

function buildScorePresentation(score: number): ScorePresentation {
  const starCount = scoreToStars(score) ?? 0;

  if (starCount === 3) {
    return {
      starCount,
      starLabel: '3 stars',
      description: 'Exact match. Nothing got lost in the noise.',
      celebration: 'Perfect score. That landed clean.',
      tone: 'three',
    };
  }

  if (starCount === 2) {
    return {
      starCount,
      starLabel: '2 stars',
      description: 'Very close. Your imitation held together well.',
      celebration: 'Strong round. Small details kept it from three.',
      tone: 'two',
    };
  }

  if (starCount === 1) {
    return {
      starCount,
      starLabel: '1 star',
      description: 'A solid attempt with a few wobble points.',
      celebration: 'One star on the board. You were in range.',
      tone: 'one',
    };
  }

  return {
    starCount,
    starLabel: '0 stars',
    description: 'A brave first pass. The shape is there, but the phrase drifted.',
    celebration: 'No stars this time. The next round resets fast.',
    tone: 'zero',
  };
}

export function formatStars(value: number) {
  return `${value} star${value === 1 ? '' : 's'}`;
}

export function formatAverageStars(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 'No stars yet';
  }

  const roundedValue = Math.round(value * 10) / 10;
  const label = Number.isInteger(roundedValue)
    ? roundedValue.toFixed(0)
    : roundedValue.toFixed(1);

  return `${label} avg stars`;
}

export function getScorePresentation(score: number | null): ScorePresentation {
  if (score === null) {
    return {
      starCount: null,
      starLabel: 'Pending',
      description: 'Submit the guess to reveal the score.',
      celebration: 'The reveal is waiting.',
      tone: 'pending',
    };
  }

  return buildScorePresentation(score);
}

export function getRoundSummary(round: Round, isRecipient: boolean): RoundSummary {
  if (isRecipient) {
    if (round.status === 'complete') {
      return {
        headline: 'Round complete. Your reward reveal is ready.',
        description: 'Your score is locked. Opening the results banks your BB Coins, and your friend still needs to review before the next round can move on.',
        callToAction: 'Check the score and let the BB Coin reveal finish.',
      };
    }

    if (round.status === 'attempted') {
      return {
        headline: 'Your take is saved. Time to guess.',
        description: 'The imitation is locked in. Now type the phrase you think you heard.',
        callToAction: 'Tap reveal score when you are ready.',
      };
    }

    return {
      headline: `Your turn against ${round.senderUsername}.`,
      description: 'Listen to the reversed prompt, record your imitation, then make your guess.',
      callToAction: 'Start with the reversed prompt.',
    };
  }

  if (round.status === 'complete') {
    return {
      headline: `${round.recipientUsername} finished the round.`,
      description: 'See the score, bank your own BB Coins, and continue the thread after both players open results.',
      callToAction: 'Open the review to settle your reward.',
    };
  }

  if (round.status === 'attempted') {
    return {
      headline: `${round.recipientUsername} finished the imitation.`,
      description: 'Their take is saved. They still need to submit the guess to lock the score.',
      callToAction: 'You can already preview the imitation below.',
    };
  }

  return {
    headline: `Waiting on ${round.recipientUsername}.`,
    description: 'They need to record an imitation before the round can finish.',
    callToAction: 'They will play the reversed prompt next.',
  };
}
