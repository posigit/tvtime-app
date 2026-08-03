/* Fresh / Rotten icons (clean, iconic) — shared by reviews + score strip */

export function FreshIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      fill="none"
    >
      <circle cx="16" cy="18" r="11" fill="#fa320a" />
      <ellipse cx="12" cy="15" rx="2.2" ry="3" fill="#ff6b4a" opacity="0.55" />
      <path
        d="M16 8c0-3 2.5-5 5-5-1 2.5-1 4.5 0 6"
        stroke="#3d8b37"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 8c1.5-1 3-1.2 4.5-.5"
        stroke="#2f6b2a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function RottenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <path
        d="M8 12c-2 3-2 8 1 12 3 4 9 5 13 2 4-3 5-9 2-13-2-3-6-5-10-4-3 .5-5 1.5-6 3z"
        fill="#6ac04a"
      />
      <path
        d="M10 14c2 1 3 3 3 5M18 12c1 2 1 4 0 6M14 20c2 .5 4 0 5-1"
        stroke="#3d7a2a"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="12" cy="16" r="1.2" fill="#2d5a20" />
      <path
        d="M20 9c2-2 4-2 5-1"
        stroke="#3d8b37"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Popcorn bucket for the RT audience score (Popcornmeter). */
export function PopcornIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <circle cx="10" cy="10" r="3.4" fill="#f6e7c8" />
      <circle cx="16" cy="8" r="3.8" fill="#fdf3dd" />
      <circle cx="22" cy="10" r="3.4" fill="#f6e7c8" />
      <path d="M9 14 L12 27 H20 L23 14 Z" fill="#e0202e" />
      <path d="M13 14 L14.5 27 H17.5 L16 14 Z" fill="#fff" opacity="0.85" />
    </svg>
  );
}

/**
 * Metacritic's signature look: the score itself in a rounded square,
 * colored by band (green ≥ 61, yellow ≥ 40, red below).
 * `bare` renders just the colored square (tiny chip sizes).
 */
export function MetacriticIcon({
  className,
  score,
  bare = false,
}: {
  className?: string;
  score: number;
  bare?: boolean;
}) {
  const bg = score >= 61 ? "#66cc33" : score >= 40 ? "#ffcc33" : "#ff0000";
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <rect x="2" y="2" width="28" height="28" rx="7" fill={bg} />
      {!bare && (
        <text
          x="16"
          y="22"
          textAnchor="middle"
          fontSize={score >= 100 ? 13 : 15}
          fontWeight="800"
          fill="#fff"
          fontFamily="system-ui, sans-serif"
        >
          {score}
        </text>
      )}
    </svg>
  );
}

/** TMDB user score: a star in TMDB brand blue. */
export function TmdbIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <path
        d="M16 3.5l3.9 7.9 8.7 1.3-6.3 6.1 1.5 8.7L16 23.4l-7.8 4.1 1.5-8.7-6.3-6.1 8.7-1.3z"
        fill="#01b4e4"
      />
    </svg>
  );
}
