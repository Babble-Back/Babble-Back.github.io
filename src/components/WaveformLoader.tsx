import { useEffect, useId, useMemo, useRef, useState } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const TARGET_FRAME_MS = 1000 / 36;

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
  segmentCount: 240,
  smallAmplitude: 2.6,
  activeAmplitude: 12,
  waveformFrequency: 28,
  travelSpeed: 2,
  activeArcWidth: Math.PI / 3.9,
} as const;

interface WaveformPathConfig {
  activeAmplitude: number;
  activeArcWidth: number;
  baseRadius?: number;
  segmentCount: number;
  size: number;
  smallAmplitude: number;
  strokeWidth: number;
  travelSpeed: number;
  waveformFrequency: number;
}

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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrappedAngularDistance(left: number, right: number) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

function triangleWave(phase: number) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

function toPolarPoint(radius: number, theta: number, center: number) {
  return {
    x: center + radius * Math.cos(theta - Math.PI / 2),
    y: center + radius * Math.sin(theta - Math.PI / 2),
  };
}

function buildWaveformPath(config: WaveformPathConfig, timeSeconds: number) {
  const center = config.size / 2;
  const safeOuterRadius = center - config.strokeWidth * 0.5 - 0.5;
  const baseRadiusFallback =
    safeOuterRadius - config.smallAmplitude - config.activeAmplitude - 1.25;
  const resolvedBaseRadius = clamp(
    config.baseRadius ?? baseRadiusFallback,
    config.strokeWidth,
    safeOuterRadius,
  );
  const segmentTotal = Math.max(96, Math.min(720, Math.round(config.segmentCount)));
  const waveformFrequency = Math.max(3, config.waveformFrequency);
  const travelSpeed = Math.max(0, config.travelSpeed);
  const activeArcWidth = clamp(config.activeArcWidth, Math.PI / 16, Math.PI * 1.35);
  const activeCenter = (timeSeconds * travelSpeed + Math.PI * 0.16) % FULL_CIRCLE;
  const activeSigma = Math.max(activeArcWidth / 2.35, 0.001);
  const subtlePulse = 0.94 + 0.06 * Math.sin(timeSeconds * 1.55);
  const minRadius = config.strokeWidth * 0.85;
  const commands = new Array<string>(segmentTotal + 1);

  for (let index = 0; index <= segmentTotal; index += 1) {
    const theta = (index / segmentTotal) * FULL_CIRCLE;
    const wrappedDistance = wrappedAngularDistance(theta, activeCenter);

    // A wrapped gaussian envelope keeps one arc visibly louder while the rest stays restrained.
    const envelope = Math.exp(-0.5 * Math.pow(wrappedDistance / activeSigma, 2));
    const baseCarrierPhase =
      theta * waveformFrequency +
      0.24 * Math.sin(theta * 3.3 - timeSeconds * 0.85);
    const activeCarrierPhase =
      theta * waveformFrequency * 1.14 +
      envelope * 1.15 -
      wrappedDistance * 0.65;

    const smallWaveOffset =
      config.smallAmplitude *
      subtlePulse *
      (triangleWave(baseCarrierPhase) * 0.76 +
        Math.sin(baseCarrierPhase * 1.92 - timeSeconds * 1.4) * 0.24);
    const activeWaveOffset =
      config.activeAmplitude *
      envelope *
      (0.92 + 0.14 * Math.sin(timeSeconds * 3.15 - wrappedDistance * 5.5)) *
      (triangleWave(activeCarrierPhase) * 0.68 +
        Math.sin(activeCarrierPhase * 2.08 - timeSeconds * 2.4) * 0.32);
    const radius = clamp(
      resolvedBaseRadius + smallWaveOffset + activeWaveOffset,
      minRadius,
      safeOuterRadius,
    );
    const point = toPolarPoint(radius, theta, center);
    const command = index === 0 ? 'M' : 'L';

    commands[index] = `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return `${commands.join(' ')} Z`;
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
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = animated && !prefersReducedMotion;

  const pathConfig = useMemo<WaveformPathConfig>(
    () => ({
      activeAmplitude,
      activeArcWidth,
      baseRadius,
      segmentCount,
      size,
      smallAmplitude,
      strokeWidth,
      travelSpeed,
      waveformFrequency,
    }),
    [
      activeAmplitude,
      activeArcWidth,
      baseRadius,
      segmentCount,
      size,
      smallAmplitude,
      strokeWidth,
      travelSpeed,
      waveformFrequency,
    ],
  );

  const staticPath = useMemo(() => buildWaveformPath(pathConfig, 0), [pathConfig]);
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
        pathElement.setAttribute('d', buildWaveformPath(pathConfig, now / 1000));
        lastFrameAt = now;
      }

      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathConfig, shouldAnimate]);

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
          <stop offset="0%" stopColor="#ff4b63" />
          <stop offset="20%" stopColor="#f12cb4" />
          <stop offset="42%" stopColor="#9a78ff" />
          <stop offset="47%" stopColor="#4aa8ff" />
          <stop offset="68%" stopColor="#ff8a3d" />
          <stop offset="84%" stopColor="#ffd547" />
          <stop offset="100%" stopColor="#6ecf5b" />
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
