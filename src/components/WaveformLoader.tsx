import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  buildCircularPath,
  clamp,
  FULL_CIRCLE,
  getBaseRadius,
  triangleWave,
  wrappedAngularDistance,
} from './waveformCircle';

const TARGET_FRAME_MS = 1000 / 48;

export interface WaveformLoaderProps {
  size?: number;
  strokeWidth?: number;
  animated?: boolean;
  className?: string;
  baseRadius?: number;
  segmentCount?: number;
  smallAmplitude?: number;
  activeAmplitude?: number;
  waveformFrequency?: number;
  travelSpeed?: number;
  activeArcWidth?: number;
}

export const DEFAULT_WAVEFORM_LOADER_TUNING = {
  segmentCount: 180,
  smallAmplitude: 1.4,
  activeAmplitude: 24,
  waveformFrequency: 26,
  travelSpeed: 1,
  activeArcWidth: Math.PI / 4,
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
      return () => mediaQuery.removeEventListener('change', onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  return prefersReducedMotion;
}

export function WaveformLoader({
  size = 120,
  strokeWidth = 4,
  animated = true,
  className,
  baseRadius,
  segmentCount = DEFAULT_WAVEFORM_LOADER_TUNING.segmentCount,
  smallAmplitude = DEFAULT_WAVEFORM_LOADER_TUNING.smallAmplitude,
  activeAmplitude = DEFAULT_WAVEFORM_LOADER_TUNING.activeAmplitude,
  waveformFrequency = DEFAULT_WAVEFORM_LOADER_TUNING.waveformFrequency,
  travelSpeed = DEFAULT_WAVEFORM_LOADER_TUNING.travelSpeed,
  activeArcWidth = DEFAULT_WAVEFORM_LOADER_TUNING.activeArcWidth,
}: WaveformLoaderProps) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement | null>(null);
  const lastFrameAtRef = useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = animated && !prefersReducedMotion;
  const resolvedSegmentCount = useMemo(
    () => clamp(Math.round(segmentCount), prefersReducedMotion ? 96 : 140, 240),
    [prefersReducedMotion, segmentCount],
  );

  const initialPath = useMemo(() => {
    const fallbackBase = getBaseRadius(size, strokeWidth, 1, 'playback').baseRadius;
    const resolvedBase = clamp(baseRadius ?? fallbackBase, strokeWidth + 3, size / 2);
    const radii = Array.from({ length: resolvedSegmentCount }, () => resolvedBase);
    return buildCircularPath(size, radii);
  }, [baseRadius, resolvedSegmentCount, size, strokeWidth]);

  useEffect(() => {
    const pathElement = pathRef.current;
    if (!pathElement || typeof window === 'undefined') {
      return;
    }

    if (!shouldAnimate) {
      pathElement.setAttribute('d', initialPath);
      return;
    }

    let frameId = 0;

    const draw = (now: number) => {
      if (!lastFrameAtRef.current || now - lastFrameAtRef.current >= TARGET_FRAME_MS) {
        const { baseRadius: fallbackBaseRadius, safeOuterRadius } = getBaseRadius(size, strokeWidth, 1, 'playback');
        const resolvedBase = clamp(baseRadius ?? fallbackBaseRadius, strokeWidth * 0.9, safeOuterRadius);
        const activeCenter = now * 0.0018 * Math.max(0.2, travelSpeed);
        const arcSigma = Math.max(clamp(activeArcWidth, Math.PI / 12, Math.PI / 2.2) / 2.35, 0.001);
        const carrierFrequency = Math.max(8, waveformFrequency);
        const minRadius = strokeWidth * 0.9;

        const radii = new Array<number>(resolvedSegmentCount);

        for (let i = 0; i < resolvedSegmentCount; i += 1) {
          const theta = (i / resolvedSegmentCount) * FULL_CIRCLE;
          const wrappedDistance = wrappedAngularDistance(theta, activeCenter);
          const envelope = Math.exp(-0.5 * Math.pow(wrappedDistance / arcSigma, 2));
          const syntheticEnergy = clamp(
            0.12 +
              0.88 * envelope +
              0.2 * Math.max(0, triangleWave(theta * carrierFrequency - now * 0.0062)),
            0,
            1,
          );

          const ridgePhase = theta * carrierFrequency - now * 0.0062;
          const ridge = Math.max(0, triangleWave(ridgePhase)) ** 0.52;
          const spatialWeight = 0.82 + 0.18 * Math.cos(theta * 2.6 - now * 0.0011);
          const drift = 0.84 + 0.16 * Math.sin(now * 0.0016 + theta * 5.6);
          const emphasized = 0.34 * syntheticEnergy + 0.66 * syntheticEnergy ** 0.68;
          const spikyEnergy = emphasized * (0.64 + ridge * 0.92);
          const offset =
            smallAmplitude * (0.7 + 0.3 * Math.sin(now * 0.0025 + theta * 4.4)) +
            activeAmplitude * spikyEnergy * spatialWeight * drift;

          radii[i] = clamp(resolvedBase + offset, minRadius, safeOuterRadius);
        }

        pathElement.setAttribute('d', buildCircularPath(size, radii));
        lastFrameAtRef.current = now;
      }

      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    activeAmplitude,
    activeArcWidth,
    baseRadius,
    initialPath,
    resolvedSegmentCount,
    shouldAnimate,
    size,
    smallAmplitude,
    strokeWidth,
    travelSpeed,
    waveformFrequency,
  ]);

  const composedClassName = ['waveform-loader', className].filter(Boolean).join(' ');

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
        d={initialPath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
