import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const TARGET_FRAME_MS = 1000 / 48;

export type PlaybackStartKind = 'new' | 'resume';

export interface WaveformPlayButtonProps {
  src?: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  autoPlay?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  intensity?: number;
  mode?: 'playback' | 'record';
  isActive?: boolean;
  onPress?: () => void;
  onPlayRequest?: (kind: PlaybackStartKind) => boolean | void | Promise<boolean | void>;
  activeAriaLabel?: string;
  inactiveAriaLabel?: string;
  liveStream?: MediaStream | null;
  disabled?: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toPolarPoint(radius: number, theta: number, center: number) {
  return {
    x: center + radius * Math.cos(theta - Math.PI / 2),
    y: center + radius * Math.sin(theta - Math.PI / 2),
  };
}

function triangleWave(phase: number) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(media.matches);

    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return prefersReducedMotion;
}

function buildCircularPath(size: number, strokeWidth: number, radii: number[]) {
  const center = size / 2;
  const segmentTotal = radii.length;
  const commands = new Array<string>(segmentTotal + 1);

  for (let i = 0; i <= segmentTotal; i += 1) {
    const index = i % segmentTotal;
    const theta = (index / segmentTotal) * FULL_CIRCLE;
    const point = toPolarPoint(radii[index], theta, center);
    commands[i] = `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return `${commands.join(' ')} Z`;
}

function getBaseRadius(size: number, strokeWidth: number, intensity: number, mode: 'playback' | 'record') {
  const center = size / 2;
  const safeOuterRadius = center - strokeWidth * 0.5 - 0.5;
  const effectiveIntensity = mode === 'record' ? 1 : intensity;
  const maxAmplitude = 16 * clamp(effectiveIntensity, 0.4, 4);
  return {
    baseRadius: clamp(safeOuterRadius - maxAmplitude - 1, strokeWidth + 3, safeOuterRadius),
    safeOuterRadius,
  };
}

export function WaveformPlayButton({
  src,
  size = 80,
  strokeWidth = 4,
  className,
  autoPlay = false,
  onPlay,
  onPause,
  onEnd,
  intensity = 1,
  mode = 'playback',
  isActive = false,
  onPress,
  onPlayRequest,
  activeAriaLabel = 'Stop recording',
  inactiveAriaLabel = 'Start recording',
  liveStream = null,
  disabled = false,
}: WaveformPlayButtonProps) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frequencyRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothedRef = useRef<Float32Array | null>(null);
  const motionTargetRef = useRef(0);
  const motionProgressRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAuthorizingPlay, setIsAuthorizingPlay] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const segmentCount = useMemo(() => (prefersReducedMotion ? 96 : 180), [prefersReducedMotion]);

  const initialPath = useMemo(() => {
    const { baseRadius } = getBaseRadius(size, strokeWidth, intensity, mode);
    const radii = Array.from({ length: segmentCount }, () => baseRadius);
    return buildCircularPath(size, strokeWidth, radii);
  }, [segmentCount, size, strokeWidth, intensity, mode]);

  useEffect(() => {
    if (mode !== 'playback' || !src) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      motionTargetRef.current = 0;
      return;
    }

    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = src;
    audio.crossOrigin = 'anonymous';

    const handlePlay = () => {
      motionTargetRef.current = 1;
      setIsPlaying(true);
      onPlay?.();
    };

    const handlePause = () => {
      motionTargetRef.current = 0;
      setIsPlaying(false);
      onPause?.();
    };

    const handleEnded = () => {
      motionTargetRef.current = 0;
      setIsPlaying(false);
      onEnd?.();
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, [mode, src, onEnd, onPause, onPlay]);

  useEffect(() => {
    if (mode !== 'playback' || !autoPlay || !audioRef.current) {
      return;
    }

    void audioRef.current.play().catch(() => {
      // Ignore autoplay restrictions.
    });
  }, [autoPlay, mode, src]);

  const initializePlaybackAudioGraph = () => {
    const audio = audioRef.current;
    if (!audio || typeof window === 'undefined') {
      return;
    }

    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      audioContextRef.current = new AudioContextCtor();
    }

    if (!analyserRef.current && audioContextRef.current) {
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.42;
      analyserRef.current = analyser;
      frequencyRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      smoothedRef.current = new Float32Array(segmentCount);
    }

    if (!sourceRef.current && analyserRef.current && audioContextRef.current) {
      sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
    }
  };

  const initializeLiveAudioGraph = () => {
    if (typeof window === 'undefined' || !liveStream) {
      return;
    }

    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }
      audioContextRef.current = new AudioContextCtor();
    }

    if (!analyserRef.current && audioContextRef.current) {
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.26;
      analyserRef.current = analyser;
      frequencyRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      smoothedRef.current = new Float32Array(segmentCount);
    }

    if (!sourceRef.current && analyserRef.current && audioContextRef.current) {
      sourceRef.current = audioContextRef.current.createMediaStreamSource(liveStream);
      sourceRef.current.connect(analyserRef.current);
    }
  };

  useEffect(() => {
    if (!smoothedRef.current || smoothedRef.current.length === segmentCount) {
      return;
    }

    smoothedRef.current = new Float32Array(segmentCount);
  }, [segmentCount]);

  useEffect(() => {
    const pathElement = pathRef.current;
    if (!pathElement || typeof window === 'undefined') {
      return;
    }

    const draw = (now: number) => {
      if (!lastFrameAtRef.current || now - lastFrameAtRef.current > TARGET_FRAME_MS) {
        const { baseRadius, safeOuterRadius } = getBaseRadius(size, strokeWidth, intensity, mode);
        const progressTarget = motionTargetRef.current;
        const previousProgress = motionProgressRef.current;
        const easing = progressTarget > previousProgress ? 0.16 : 0.1;
        const progress = previousProgress + (progressTarget - previousProgress) * easing;
        motionProgressRef.current = progress;

        const radii = new Array<number>(segmentCount);
        const analyser = analyserRef.current;
        const frequencyData = frequencyRef.current;
        const smoothed = smoothedRef.current;

        const hasAnimatedAudio = mode === 'playback' ? isPlaying : isActive;

        if (analyser && frequencyData && smoothed && hasAnimatedAudio && !prefersReducedMotion) {
          analyser.getByteFrequencyData(frequencyData);
          const amplitude = (mode === 'record' ? 42 : 24) * intensity * progress;
          const minRadius = strokeWidth * 0.9;

          for (let i = 0; i < segmentCount; i += 1) {
            const frequencyIndex = Math.floor((i / segmentCount) * frequencyData.length);
            const normalized = frequencyData[frequencyIndex] / 255;
            const current = smoothed[i] ?? 0;
            const smoothValue = current + (normalized - current) * 0.58;
            smoothed[i] = smoothValue;

            const theta = (i / segmentCount) * FULL_CIRCLE;
            const ridgePhase = theta * (mode === 'record' ? 33 : 26) - now * (mode === 'record' ? 0.0084 : 0.0062);
            const ridge = Math.max(0, triangleWave(ridgePhase)) ** 0.52;
            const spatialWeight = 0.82 + 0.18 * Math.cos(theta * 2.6 - now * 0.0011);
            const drift = 0.84 + 0.16 * Math.sin(now * 0.0016 + theta * 5.6);
            const emphasized = mode === 'record'
              ? 0.12 * smoothValue + 0.88 * smoothValue ** 0.56
              : 0.34 * smoothValue + 0.66 * smoothValue ** 0.68;
            const spikyEnergy = emphasized * (mode === 'record' ? 0.92 + ridge * 1.2 : 0.64 + ridge * 0.92);
            const offset = amplitude * spikyEnergy * spatialWeight * drift;
            radii[i] = clamp(baseRadius + offset, minRadius, safeOuterRadius);
          }
        } else {
          for (let i = 0; i < segmentCount; i += 1) {
            const subtlePulse = prefersReducedMotion
              ? 0.85 + 0.15 * Math.sin(now * 0.001 + i * 0.11)
              : 1;
            const settle = (1.8 + 2.2 * motionProgressRef.current) * subtlePulse;
            radii[i] = clamp(baseRadius + settle, strokeWidth * 0.9, safeOuterRadius);
          }
        }

        pathElement.setAttribute('d', buildCircularPath(size, strokeWidth, radii));
        lastFrameAtRef.current = now;
      }

      rafRef.current = window.requestAnimationFrame(draw);
    };

    rafRef.current = window.requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    };
  }, [initialPath, intensity, isActive, isPlaying, mode, prefersReducedMotion, segmentCount, size, strokeWidth]);

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || disabled || isAuthorizingPlay) {
      return;
    }

    if (audio.paused || audio.ended) {
      const playbackStartKind: PlaybackStartKind =
        audio.currentTime > 0.05 && !audio.ended ? 'resume' : 'new';

      if (onPlayRequest) {
        setIsAuthorizingPlay(true);

        try {
          const playWasAuthorized = await onPlayRequest(playbackStartKind);

          if (playWasAuthorized === false) {
            return;
          }
        } finally {
          setIsAuthorizingPlay(false);
        }
      }

      initializePlaybackAudioGraph();

      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      await audio.play();
      return;
    }

    audio.pause();
  };

  useEffect(() => {
    if (mode !== 'record') {
      return;
    }

    motionTargetRef.current = isActive ? 1 : 0;
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    initializeLiveAudioGraph();

    if (audioContextRef.current?.state === 'suspended') {
      void audioContextRef.current.resume().catch(() => {
        // Ignore resume failures without user gesture.
      });
    }
  }, [isActive, liveStream, mode, segmentCount]);

  const showActiveState = mode === 'playback' ? isPlaying : isActive;

  const composedClassName = [
    'waveform-play-button',
    showActiveState ? 'is-playing' : '',
    mode === 'record' ? 'is-record-control' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      aria-label={mode === 'playback' ? (isPlaying ? 'Pause audio' : 'Play audio') : showActiveState ? activeAriaLabel : inactiveAriaLabel}
      className={composedClassName}
      disabled={disabled || isAuthorizingPlay}
      onClick={() => {
        if (mode === 'record') {
          onPress?.();
          return;
        }

        void togglePlayback().catch(() => {
          // Playback can fail without user gesture or with invalid audio URL.
        });
      }}
      style={{ '--wpb-size': `${size}px` } as CSSProperties}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="waveform-play-button-svg"
        height={size}
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

        <g className="waveform-play-button-icon-svg">
          <polygon
            className="waveform-icon-play-shape"
            fill={`url(#${gradientId})`}
            points={`${size * 0.435},${size * 0.375} ${size * 0.435},${size * 0.625} ${size * 0.635},${size * 0.5}`}
          />

          <g className="waveform-icon-pause-shape" fill={`url(#${gradientId})`}>
            <rect
              height={size * 0.245}
              rx={size * 0.03}
              width={size * 0.068}
              x={size * 0.416}
              y={size * 0.377}
            />
            <rect
              height={size * 0.245}
              rx={size * 0.03}
              width={size * 0.068}
              x={size * 0.516}
              y={size * 0.377}
            />
          </g>

          <circle
            className="waveform-icon-record-shape"
            cx={size * 0.5}
            cy={size * 0.5}
            fill={`url(#${gradientId})`}
            r={size * 0.125}
          />

          <rect
            className="waveform-icon-stop-shape"
            fill={`url(#${gradientId})`}
            height={size * 0.23}
            rx={size * 0.05}
            width={size * 0.23}
            x={size * 0.385}
            y={size * 0.385}
          />
        </g>
      </svg>
    </button>
  );
}
