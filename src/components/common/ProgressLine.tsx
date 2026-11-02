import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { DURATION, EASE } from '../../styles/scale';

// A thin line along its parent's top edge, one fill scaled to n of total; no number on screen.
export default function ProgressLine({
  n,
  total,
  label,
}: {
  n: number;
  total: number;
  label: string;
}) {
  const COLORS = useThemeColors();
  // KAN-721. Fills the parent's padding box and clips to its corners, so the
  // line along a rounded card's top follows the curve (the card cannot clip:
  // the coach card's notch hangs outside it).
  const clipStyle = css`
    position: absolute;
    inset: 0;
    border-radius: inherit;
    corner-shape: inherit;
    overflow: hidden;
    pointer-events: none;
  `;
  const trackStyle = css`
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    overflow: hidden;
    background-color: ${COLORS.DIVIDER_COLOR};
  `;
  const fillStyle = css`
    height: 100%;
    background-color: ${COLORS.TEXT_COLOR};
    transform-origin: left center;
    transition: transform ${DURATION.MOVE} ${EASE.OUT};
    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `;
  return (
    <div css={clipStyle}>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={n}
        aria-valuetext={label}
        data-progress-line
        css={trackStyle}
      >
        <div
          data-progress-fill
          css={fillStyle}
          style={{ transform: `scaleX(${n / total})` }}
        />
      </div>
    </div>
  );
}
