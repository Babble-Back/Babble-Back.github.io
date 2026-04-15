import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { StarRating } from '../../../components/StarRating';
import { difficultyMultiplier } from '../../../lib/rounds';
import type { RewardSequenceReward } from '../types';

interface RoundRewardSequenceProps {
  baseCoins: number;
  reward: RewardSequenceReward;
  onDisplayedCoinsChange: (amount: number) => void;
  onAnimationComplete?: () => void;
  startCompleted?: boolean;
  children?: ReactNode;
}

interface Point {
  x: number;
  y: number;
}

interface ParticleSpec {
  id: string;
  lift: number;
  delay: number;
  duration: number;
  size: number;
  endOffsetX: number;
  endOffsetY: number;
  spin: number;
}

interface ParticleRender {
  id: string;
  style: CSSProperties;
}

const MAX_STARS = 3;
const REWARD_TIMING_SCALE = 2;
const STAR_SLAM_DURATION_MS = 500 * REWARD_TIMING_SCALE;
const STAR_STAGGER_MS = 280 * REWARD_TIMING_SCALE;
const ZERO_STAR_REVEAL_DURATION_MS = 260 * REWARD_TIMING_SCALE;
const DIFFICULTY_SLAM_DURATION_MS = 460 * REWARD_TIMING_SCALE;
const MULTIPLIER_COUNT_DELAY_MS = 110 * REWARD_TIMING_SCALE;
const MULTIPLIER_COUNT_DURATION_MS = 360 * REWARD_TIMING_SCALE;
const BURST_DURATION_MS = 620 * REWARD_TIMING_SCALE;
const TARGET_MARKER_SIZE_PX = 44;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value: number) {
  const nextValue = 1 - Math.pow(1 - value, 3);
  return clamp(nextValue);
}

function easeOutBack(value: number, overshoot = 1.24) {
  const adjustedValue = clamp(value) - 1;
  return adjustedValue * adjustedValue * ((overshoot + 1) * adjustedValue + overshoot) + 1;
}

function quadraticBezier(start: number, control: number, end: number, progress: number) {
  const inverseProgress = 1 - progress;
  return (
    inverseProgress * inverseProgress * start +
    2 * inverseProgress * progress * control +
    progress * progress * end
  );
}

function getDifficultyLabel(difficulty: RewardSequenceReward['difficulty']) {
  return difficulty.toUpperCase();
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

function getCoinDisplayTargetPoint() {
  const exactTarget = document.querySelector<HTMLElement>('[data-coin-display-target="true"]');

  if (exactTarget) {
    return getCenterPoint(exactTarget);
  }

  const fallbackTarget = document.querySelector<HTMLElement>('[data-coin-display="true"]');
  return getCenterPoint(fallbackTarget);
}

function pointsEqual(left: Point | null, right: Point | null) {
  if (!left || !right) {
    return left === right;
  }

  return left.x === right.x && left.y === right.y;
}

function createParticleSpecs(rewardAmount: number) {
  const count = rewardAmount === 0 ? 0 : Math.max(10, Math.min(18, rewardAmount + 8));

  return Array.from({ length: count }, (_, index): ParticleSpec => ({
    id: `reward-particle-${index}`,
    lift: 90 + (index % 5) * 16,
    delay: index * 18,
    duration: 310 + (index % 4) * 48,
    size: 18 + (index % 3) * 4,
    endOffsetX: (index % 2 === 0 ? -1 : 1) * (12 + (index % 4) * 7),
    endOffsetY: -10 + (index % 5) * 6,
    spin: (index % 2 === 0 ? -1 : 1) * (80 + index * 11),
  }));
}

function getStarStageDurationMs(starCount: number) {
  return starCount > 0
    ? STAR_SLAM_DURATION_MS + Math.max(0, starCount - 1) * STAR_STAGGER_MS
    : ZERO_STAR_REVEAL_DURATION_MS;
}

function getBurstStartMs(starCount: number) {
  const starStageDurationMs = getStarStageDurationMs(starCount);
  return (
    starStageDurationMs +
    Math.max(DIFFICULTY_SLAM_DURATION_MS, MULTIPLIER_COUNT_DELAY_MS + MULTIPLIER_COUNT_DURATION_MS)
  );
}

function getTotalDurationMs(starCount: number) {
  return getBurstStartMs(starCount) + BURST_DURATION_MS;
}

export function RoundRewardSequence({
  baseCoins,
  reward,
  onDisplayedCoinsChange,
  onAnimationComplete,
  startCompleted = false,
  children,
}: RoundRewardSequenceProps) {
  const starStageDurationMs = getStarStageDurationMs(reward.stars);
  const burstStartMs = getBurstStartMs(reward.stars);
  const totalDurationMs = getTotalDurationMs(reward.stars);
  const [elapsedMs, setElapsedMs] = useState(startCompleted ? totalDurationMs : 0);
  const [burstOrigin, setBurstOrigin] = useState<Point | null>(null);
  const [targetPoint, setTargetPoint] = useState<Point | null>(null);
  const sequenceCardRef = useRef<HTMLDivElement | null>(null);
  const coinBurstOriginRef = useRef<HTMLSpanElement | null>(null);
  const hasCompletedAnimationRef = useRef(startCompleted);
  const difficultyStageStartMs = starStageDurationMs;
  const difficultyProgress = clamp(
    (elapsedMs - difficultyStageStartMs) / DIFFICULTY_SLAM_DURATION_MS,
  );
  const multiplierProgress = clamp(
    (elapsedMs - difficultyStageStartMs - MULTIPLIER_COUNT_DELAY_MS) /
      MULTIPLIER_COUNT_DURATION_MS,
  );
  const burstProgress = clamp((elapsedMs - burstStartMs) / BURST_DURATION_MS);
  const difficultyMultiplierValue = difficultyMultiplier[reward.difficulty];
  const isSequenceFinished = elapsedMs >= totalDurationMs;
  const targetPulseScale = 0.94 + burstProgress * 0.32;
  const particles = useMemo(() => createParticleSpecs(reward.rewardAmount), [reward.rewardAmount]);
  const displayedCoinTotal =
    reward.rewardAmount === 0
      ? baseCoins
      : baseCoins + Math.round(reward.rewardAmount * easeOutCubic(burstProgress));
  const starEntryProgresses = useMemo(
    () =>
      Array.from({ length: MAX_STARS }, (_, index) =>
        index >= reward.stars
          ? 0
          : clamp((elapsedMs - index * STAR_STAGGER_MS) / STAR_SLAM_DURATION_MS),
      ),
    [elapsedMs, reward.stars],
  );
  const displayedStarValue = useMemo(
    () =>
      starEntryProgresses.reduce(
        (total, progress, index) =>
          total + (index >= reward.stars ? 0 : clamp(easeOutBack(progress, 1.12 + index * 0.16))),
        0,
      ),
    [reward.stars, starEntryProgresses],
  );
  const landedStarCount = starEntryProgresses.reduce(
    (total, progress, index) => total + (index < reward.stars && progress >= 0.72 ? 1 : 0),
    0,
  );
  const isStarImpactActive = starEntryProgresses.some((progress, index) => {
    if (index >= reward.stars) {
      return false;
    }

    return progress > 0.56 && progress < 0.82;
  });
  const isDifficultyImpactActive = difficultyProgress > 0.16 && difficultyProgress < 0.44;
  const displayedRewardCounter =
    multiplierProgress > 0
      ? Math.round(
          reward.stars + (reward.rewardAmount - reward.stars) * easeOutCubic(multiplierProgress),
        )
      : landedStarCount;
  const counterScale =
    multiplierProgress > 0 && multiplierProgress < 1
      ? 1 + (1 - Math.abs(multiplierProgress - 0.5) / 0.5) * 0.08
      : isStarImpactActive
        ? 1.03
        : 1;
  const starStyles = useMemo<CSSProperties[]>(
    () =>
      Array.from({ length: MAX_STARS }, (_, index) => {
        if (index >= reward.stars) {
          return {
            opacity: 0.48,
            transform: 'translate3d(0, 0, 0) scale(0.92)',
          };
        }

        const progress = starEntryProgresses[index];

        if (progress <= 0) {
          return {
            opacity: 0,
            transform: `translate3d(0, ${-(72 + index * 28)}px, 0) scale(0.34) rotate(${
              -12 - index * 4
            }deg)`,
          };
        }

        const motionProgress = easeOutBack(progress, 1.26 + index * 0.24);
        const dropDistance = 72 + index * 28;

        return {
          opacity: Math.min(1, 0.14 + progress * 1.24),
          transform: `translate3d(0, ${-dropDistance + motionProgress * dropDistance}px, 0) scale(${
            0.42 + motionProgress * 0.58
          }) rotate(${(1 - Math.min(motionProgress, 1.1)) * (-12 - index * 4)}deg)`,
          filter: `drop-shadow(0 ${10 + index * 4}px ${18 + index * 6}px rgba(255, 172, 52, ${
            0.18 + progress * 0.28
          }))`,
        };
      }),
    [reward.stars, starEntryProgresses],
  );

  useEffect(() => {
    hasCompletedAnimationRef.current = startCompleted;
    setElapsedMs(startCompleted ? totalDurationMs : 0);
    setBurstOrigin(null);
    setTargetPoint(null);
  }, [startCompleted, totalDurationMs, reward.id]);

  useEffect(() => {
    if (startCompleted) {
      return;
    }

    let animationFrameId = 0;
    let startTimeMs = 0;

    const animate = (timestampMs: number) => {
      if (!startTimeMs) {
        startTimeMs = timestampMs;
      }

      const nextElapsedMs = Math.min(timestampMs - startTimeMs, totalDurationMs);
      setElapsedMs(nextElapsedMs);

      if (nextElapsedMs < totalDurationMs) {
        animationFrameId = window.requestAnimationFrame(animate);
      }
    };

    animationFrameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [startCompleted, totalDurationMs, reward.id]);

  useEffect(() => {
    onDisplayedCoinsChange(displayedCoinTotal);
  }, [displayedCoinTotal, onDisplayedCoinsChange]);

  useEffect(() => {
    if (elapsedMs < totalDurationMs || hasCompletedAnimationRef.current) {
      return;
    }

    hasCompletedAnimationRef.current = true;
    onAnimationComplete?.();
  }, [elapsedMs, onAnimationComplete, totalDurationMs]);

  useEffect(() => {
    if (burstProgress === 0 && burstOrigin && targetPoint) {
      return;
    }

    if (burstProgress === 0) {
      return;
    }

    const originElement = coinBurstOriginRef.current ?? sequenceCardRef.current;
    const nextOrigin = getCenterPoint(originElement);
    const nextTarget = getCoinDisplayTargetPoint();

    if (nextOrigin && !pointsEqual(nextOrigin, burstOrigin)) {
      setBurstOrigin(nextOrigin);
    }

    if (nextTarget && !pointsEqual(nextTarget, targetPoint)) {
      setTargetPoint(nextTarget);
    }
  }, [burstOrigin, burstProgress, targetPoint]);

  const particleStyles = useMemo<ParticleRender[]>(() => {
    if (!burstOrigin || !targetPoint || burstProgress === 0) {
      return [];
    }

    const burstElapsedMs = burstProgress * BURST_DURATION_MS;

    return particles.reduce<ParticleRender[]>((result, particle) => {
      const progress = clamp((burstElapsedMs - particle.delay) / particle.duration);

      if (progress <= 0) {
        return result;
      }

      const easedProgress = easeOutCubic(progress);
      const endX = targetPoint.x + particle.endOffsetX;
      const endY = targetPoint.y + particle.endOffsetY;
      const controlX = (burstOrigin.x + endX) / 2 + particle.endOffsetX * 0.4;
      const controlY = Math.min(burstOrigin.y, endY) - particle.lift;
      const x = quadraticBezier(burstOrigin.x, controlX, endX, easedProgress);
      const y = quadraticBezier(burstOrigin.y, controlY, endY, easedProgress);
      const opacity = progress > 0.84 ? 1 - (progress - 0.84) / 0.16 : 1;
      const scale = 0.82 + (1 - progress) * 0.28;

      result.push({
        id: particle.id,
        style: {
          width: `${particle.size}px`,
          height: `${particle.size}px`,
          opacity,
          transform: `translate(${x - particle.size / 2}px, ${y - particle.size / 2}px) scale(${scale}) rotate(${particle.spin * easedProgress}deg)`,
        },
      });

      return result;
    }, []);
  }, [burstOrigin, burstProgress, particles, targetPoint]);

  return (
    <div
      className={`reward-sequence-inline${
        isStarImpactActive || isDifficultyImpactActive ? ' is-shaking' : ''
      }`}
      role="presentation"
    >
      {!isSequenceFinished && targetPoint ? (
        <div
          className="reward-sequence-target"
          style={{
            width: `${TARGET_MARKER_SIZE_PX}px`,
            height: `${TARGET_MARKER_SIZE_PX}px`,
            transform: `translate(${targetPoint.x - TARGET_MARKER_SIZE_PX / 2}px, ${
              targetPoint.y - TARGET_MARKER_SIZE_PX / 2
            }px) scale(${targetPulseScale})`,
          }}
        />
      ) : null}

      <div className="reward-sequence-card" ref={sequenceCardRef}>
        <div className="reward-sequence-hero">
          <div className="reward-sequence-stars">
            <StarRating
              large
              label={`${reward.stars} stars`}
              starStyles={starStyles}
              value={displayedStarValue}
            />
          </div>

          <div
            className={`reward-sequence-difficulty${difficultyProgress > 0 ? ' is-visible' : ''}`}
            style={{
              opacity: difficultyProgress === 0 ? 0 : 1,
              transform: `translate3d(0, ${
                -160 * (1 - easeOutBack(difficultyProgress, 1.48))
              }px, 0) scale(${0.72 + easeOutBack(difficultyProgress, 1.36) * 0.28})`,
            }}
          >
            {getDifficultyLabel(reward.difficulty)} x{difficultyMultiplierValue}
          </div>

          <div
            aria-label={`${displayedRewardCounter.toLocaleString()} BB Coins`}
            className="reward-sequence-coins"
            style={{
              transform: `scale(${counterScale})`,
            }}
          >
            <span className="reward-sequence-coin-icon-anchor" ref={coinBurstOriginRef}>
              <img
                alt=""
                aria-hidden="true"
                className="reward-sequence-coin-icon"
                src={`${import.meta.env.BASE_URL}bbcoin.png`}
              />
            </span>
            <strong className="reward-sequence-coin-value">
              {Math.max(0, displayedRewardCounter).toLocaleString()}
            </strong>
          </div>
        </div>

        {children ? <div className="reward-sequence-extra">{children}</div> : null}
      </div>

      {!isSequenceFinished
        ? particleStyles.map((particle) => (
            <img
              alt=""
              aria-hidden="true"
              className="reward-coin-particle"
              key={particle.id}
              src={`${import.meta.env.BASE_URL}bbcoin.png`}
              style={particle.style}
            />
          ))
        : null}
    </div>
  );
}
