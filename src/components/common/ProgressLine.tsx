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
  );
}
