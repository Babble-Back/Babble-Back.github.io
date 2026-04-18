import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildCircularPath, clamp, FULL_CIRCLE, getBaseRadius, triangleWave } from './waveformRing';

const TARGET_FRAME_MS = 1000 / 36;

export interface WaveformLoaderProps {
  size?: number;
  strokeWidth?: number;
  animated?: boolean;
  className?: string;
  segmentCount?: number;
  intensity?: number;
  waveSpeed?: number;
}

export const DEFAULT_WAVEFORM_LOADER_TUNING = {
  segmentCount: 180,
  intensity: 1,
  waveSpeed: 0.0062,
} as const;

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setPrefersReducedMotion(mediaQuery.matches);

    onChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange);

      return () => {
        mediaQuery.removeEventListener('change', onChange);
      };
    }

    mediaQuery.addListener(onChange);

    return () => {
      mediaQuery.removeListener(onChange);
    };
  }, []);

  return prefersReducedMotion;
}

function buildSimulatedPlaybackRadii(
  now: number,
  size: number,
  strokeWidth: number,
  intensity: number,
  segmentCount: number,
  waveSpeed: number,
) {
  const { baseRadius, safeOuterRadius } = getBaseRadius(size, strokeWidth, intensity, 'playback');
  const radii = new Array<number>(segmentCount);
  const minRadius = strokeWidth * 0.9;
  const driftPhase = now * waveSpeed;
  const crestCenter = (driftPhase * 0.82) % FULL_CIRCLE;

  for (let i = 0; i < segmentCount; i += 1) {
    const theta = (i / segmentCount) * FULL_CIRCLE;
    const angularDistance = Math.abs(
      Math.atan2(Math.sin(theta - crestCenter), Math.cos(theta - crestCenter)),
    );
    const envelope = Math.exp(-0.5 * (angularDistance / 0.74) ** 2);
    const ridgePhase = theta * 26 - driftPhase;
    const ridge = Math.max(0, triangleWave(ridgePhase)) ** 0.52;
    const spatialWeight = 0.82 + 0.18 * Math.cos(theta * 2.6 - now * 0.0011);
    const drift = 0.84 + 0.16 * Math.sin(now * 0.0016 + theta * 5.6);
    const emphasized = 0.48 + envelope * 0.52;
    const spikyEnergy = emphasized * (0.64 + ridge * 0.92);
    const offset = 24 * intensity * spikyEnergy * spatialWeight * drift;
    radii[i] = clamp(baseRadius + offset, minRadius, safeOuterRadius);
  }

  return radii;
}

export function WaveformLoader({
  size = 120,
  strokeWidth = 4,
  animated = true,
  className,
  segmentCount = DEFAULT_WAVEFORM_LOADER_TUNING.segmentCount,
  intensity = DEFAULT_WAVEFORM_LOADER_TUNING.intensity,
  waveSpeed = DEFAULT_WAVEFORM_LOADER_TUNING.waveSpeed,
}: WaveformLoaderProps) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = animated && !prefersReducedMotion;

  const resolvedSegmentCount = useMemo(
    () => Math.max(96, Math.min(320, Math.round(segmentCount))),
    [segmentCount],
  );
  const staticPath = useMemo(() => {
    const { baseRadius } = getBaseRadius(size, strokeWidth, intensity, 'playback');
    return buildCircularPath(size, Array.from({ length: resolvedSegmentCount }, () => baseRadius));
  }, [intensity, resolvedSegmentCount, size, strokeWidth]);
  const composedClassName = ['waveform-loader', className].filter(Boolean).join(' ');

  useEffect(() => {
    if (shouldAnimate) {
      return;
    }

    const pathElement = pathRef.current;

    if (!pathElement) {
      return;
    }

    pathElement.setAttribute('d', staticPath);
  }, [shouldAnimate, staticPath]);

  useEffect(() => {
    if (!shouldAnimate || typeof window === 'undefined') {
      return;
    }

    const pathElement = pathRef.current;

    if (!pathElement) {
      return;
    }

    let frameId = 0;
    let lastFrameAt = 0;

    const draw = (now: number) => {
      if (!lastFrameAt || now - lastFrameAt >= TARGET_FRAME_MS) {
        const radii = buildSimulatedPlaybackRadii(
          now,
          size,
          strokeWidth,
          intensity,
          resolvedSegmentCount,
          waveSpeed,
        );
        pathElement.setAttribute('d', buildCircularPath(size, radii));
        lastFrameAt = now;
      }

      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [intensity, resolvedSegmentCount, shouldAnimate, size, strokeWidth, waveSpeed]);

  return (
    <svg
      aria-label="Loading"
      className={composedClassName}
      height={size}
      role="img"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={size * 0.08}
          x2={size * 0.92}
          y1={size * 0.12}
          y2={size * 0.88}
        >
          <stop offset="0%" stopColor="#2ad6d9" />
          <stop offset="18%" stopColor="#1b8dff" />
          <stop offset="36%" stopColor="#6b5cff" />
          <stop offset="54%" stopColor="#f12cb4" />
          <stop offset="74%" stopColor="#ff7b4f" />
          <stop offset="100%" stopColor="#b6de3f" />
        </linearGradient>
      </defs>

      <path
        ref={pathRef}
        d={staticPath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
