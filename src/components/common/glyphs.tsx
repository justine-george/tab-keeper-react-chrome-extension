import { css, keyframes } from '@emotion/react';

import { POINT_UP_DOODLE } from './pointUpDoodle';

// KAN-7. Glyphs the icon subset lacks, inline; each takes the colour it sits in.

const box = (size: string) => css`
  display: block;
  flex-shrink: 0;
  width: ${size};
  height: ${size};
`;

// Material's "extension": Chrome's puzzle-piece button.
export function PuzzleGlyph({ size }: { size: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      css={box(size)}
    >
      <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z" />
    </svg>
  );
}

// KAN-521. Material's "favorite", for the About credit: a word in the line, so it carries a name.
export function HeartGlyph({ size, label }: { size: string; label: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label={label}
      focusable="false"
      css={css`
        display: inline-block;
        width: ${size};
        height: ${size};
        /* No margin: the sentence's own spaces set the gap, where the language has them. */
        vertical-align: -0.125em;
      `}
    >
      <path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z" />
    </svg>
  );
}

// Round ends: a square cap pokes the shaft's corner out past an arrow's head (KAN-411).
const stroked = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function NextStepGlyph({ size }: { size: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      {...stroked}
      strokeWidth="2.4"
      aria-hidden="true"
      focusable="false"
      css={box(size)}
    >
      <path d="M3 12h17M14 6l6 6-6 6" />
    </svg>
  );
}

export function PointUpGlyph() {
  return (
    <svg
      viewBox="0 0 16 30"
      width="16"
      height="30"
      {...stroked}
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 29V3M2 9l6-6 6 6" />
    </svg>
  );
}

// KAN-411. Hand-drawn, straight up, with a loose head; POINT_UP_DOODLE has its tip.
export function PointUpDoodleGlyph({
  width,
  height,
}: {
  width: string;
  height: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${POINT_UP_DOODLE.viewWidth} ${POINT_UP_DOODLE.viewHeight}`}
      {...stroked}
      // KAN-629. A marker line, about 4px at the guide's 50x84: 2.6 read as a hairline over the dim.
      strokeWidth="5"
      aria-hidden="true"
      focusable="false"
      css={css`
        display: block;
        flex-shrink: 0;
        width: ${width};
        height: ${height};
      `}
    >
      <path d="M30 92 C 22 70, 40 48, 31 12" />
      <path
        data-arrow-head
        d="M19 25 C 24 20, 28 15, 31 11 C 33 17, 37 22, 43 26"
      />
    </svg>
  );
}

const turn = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

// Turns, unless the user asked for less motion.
export function SpinnerGlyph({ size }: { size: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      {...stroked}
      strokeWidth="2.4"
      aria-hidden="true"
      focusable="false"
      css={css`
        ${box(size)}
        animation: ${turn} 1s linear infinite;
        @media (prefers-reduced-motion: reduce) {
          animation: none;
        }
      `}
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}
