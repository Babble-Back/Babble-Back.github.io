import { useId, type CSSProperties } from 'react';

interface StarRatingProps {
  value: number;
  max?: number;
  large?: boolean;
  label?: string;
  starStyles?: CSSProperties[];
}

const STAR_PATH =
  'M12 1.9 14.9 8.2 21.8 9 16.6 13.7 18 20.6 12 17.1 6 20.6 7.4 13.7 2.2 9 9.1 8.2 12 1.9Z';
const STAR_FACET_PATHS = [
  'M12 12 12 2.6 14.8 8.2Z',
  'M12 12 14.8 8.2 21 9.1Z',
  'M12 12 21 9.1 16.6 13.6Z',
  'M12 12 16.6 13.6 17.9 20.2Z',
  'M12 12 17.9 20.2 12 17Z',
  'M12 12 12 17 6.1 20.2Z',
  'M12 12 6.1 20.2 7.4 13.6Z',
  'M12 12 7.4 13.6 3 9.1Z',
  'M12 12 3 9.1 9.2 8.2Z',
  'M12 12 9.2 8.2 12 2.6Z',
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function StarRating({
  value,
  max = 3,
  large = false,
  label,
  starStyles,
}: StarRatingProps) {
  const clipSeed = useId();
  const clampedValue = clamp(value, 0, max);

  return (
    <span
      aria-label={label}
      className={`star-rating ${large ? 'star-rating-large' : ''}`}
      role={label ? 'img' : undefined}
    >
      {Array.from({ length: max }, (_, index) => {
        const fillPercent = clamp(clampedValue - index, 0, 1) * 100;
        const clipId = `${clipSeed}-star-${index}`;
        const gradientId = `${clipSeed}-gradient-${index}`;
        const shineId = `${clipSeed}-shine-${index}`;
        const glowId = `${clipSeed}-glow-${index}`;
        const facetGradientId = `${clipSeed}-facet-gradient-${index}`;

        return (
          <span className="star-rating-star" key={clipId} style={starStyles?.[index]}>
            <svg aria-hidden="true" className="star-rating-icon" viewBox="0 0 24 24">
              <defs>
                <clipPath id={clipId}>
                  <rect height="24" width={`${fillPercent}%`} x="0" y="0" />
                </clipPath>
                <linearGradient
                  id={gradientId}
                  x1="4"
                  x2="20"
                  y1="3"
                  y2="21"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0" stopColor="#fff56b" />
                  <stop offset="0.42" stopColor="#ffe600" />
                  <stop offset="1" stopColor="#ff9f00" />
                </linearGradient>
                <radialGradient id={shineId} cx="10" cy="8" r="11" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
                  <stop offset="0.45" stopColor="#fff08b" stopOpacity="0.5" />
                  <stop offset="1" stopColor="#fff08b" stopOpacity="0" />
                </radialGradient>
                <linearGradient
                  id={facetGradientId}
                  x1="3"
                  x2="21"
                  y1="4"
                  y2="20"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0" stopColor="#fffad0" stopOpacity="0.95" />
                  <stop offset="0.5" stopColor="#ffd43c" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#ff8c00" stopOpacity="0.4" />
                </linearGradient>
                <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow
                    dx="0"
                    dy="0.2"
                    floodColor="#ff5f00"
                    floodOpacity="0.95"
                    stdDeviation="0.5"
                  />
                  <feDropShadow
                    dx="0"
                    dy="0"
                    floodColor="#fff173"
                    floodOpacity="0.95"
                    stdDeviation="1.2"
                  />
                </filter>
              </defs>
              <path className="star-rating-empty" d={STAR_PATH} />
              <g
                className="star-rating-fill"
                clipPath={`url(#${clipId})`}
                filter={`url(#${glowId})`}
              >
                <path d={STAR_PATH} fill={`url(#${gradientId})`} />
                <path d={STAR_PATH} fill={`url(#${shineId})`} />
                {STAR_FACET_PATHS.map((facet) => (
                  <path key={facet} d={facet} fill={`url(#${facetGradientId})`} />
                ))}
                <path d={STAR_PATH} fill="none" stroke="#ff8c00" strokeWidth="1.35" />
              </g>
            </svg>
          </span>
        );
      })}
    </span>
  );
}
