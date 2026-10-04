import { css, keyframes } from '@emotion/react';

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

const stroked = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'square' as const,
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

export function TowardToolbarGlyph({ size }: { size: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      {...stroked}
      strokeWidth="2.2"
      aria-hidden="true"
      focusable="false"
      css={box(size)}
    >
      <path d="M5 19L18 6M8 6h10v10" />
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
