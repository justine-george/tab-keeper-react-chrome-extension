import { css, keyframes } from '@emotion/react';

import { POINT_UP_DOODLE } from './pointUpDoodle';

// KAN-7. Glyphs the icon subset lacks, inline; each takes the colour it sits in.

const box = (size: string) => css`
  display: block;
  flex-shrink: 0;
  width: ${size};
  height: ${size};
`;

// Chrome's puzzle-piece button, traced from a real toolbar (KAN-932): a square
// outline, notched at the left, with solid bumps on the top and right.
export function PuzzleGlyph({ size }: { size: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      css={box(size)}
    >
      <path d="M3 5.2H18a1 1 0 0 1 1 1V21.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V17C3.6 16.5 5 15.6 5 13.8C5 12 3.6 11.1 2 10.6V6.2a1 1 0 0 1 1-1Z" />
      <path
        fill="currentColor"
        stroke="none"
        d="M7.6 5.2C7.8 2.8 9 1.2 10.5 1.2C12 1.2 13.2 2.8 13.4 5.2ZM19 11C21.3 11.2 23 12.4 23 13.8C23 15.2 21.3 16.4 19 16.6Z"
      />
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
