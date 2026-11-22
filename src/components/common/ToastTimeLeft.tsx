import { useLayoutEffect, useRef, useState } from 'react';

import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { toastTimeLeft } from '../../redux/toastTimers';
import { RADIUS } from '../../styles/scale';
import { corners } from '../../styles/corners';

// KAN-979 (pick A). A line along the toast's bottom edge, inside its border,
// as long as the share of the toast's own time still left.
const LINE_PX = 3;

// The share of toast `id`'s time still left, or null with no timer.
const shareLeft = (id: number): number | null => {
  const time = toastTimeLeft(id);
  return time === null ? null : time.left / time.duration;
};

interface ToastTimeLeftProps {
  id: number;
}

export const ToastTimeLeft: React.FC<ToastTimeLeftProps> = ({ id }) => {
  const COLORS = useThemeColors();
  const bar = useRef<HTMLSpanElement>(null);
  const [hasTimer] = useState(() => toastTimeLeft(id) !== null);

  // Drawn from the timer every frame, not by a CSS animation: the timer is
  // the one clock, so a hold stops the line and a toast drawn again carries
  // on, and nothing here runs as an animation (a page with a toast still
  // counts as settled). A toast that has left keeps its last length.
  useLayoutEffect(() => {
    if (!hasTimer) return undefined;
    let frame = 0;
    const draw = () => {
      const share = shareLeft(id);
      if (share !== null && bar.current !== null) {
        bar.current.style.transform = `scaleX(${share})`;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [id, hasTimer]);

  if (!hasTimer) return null;

  const lineStyle = css`
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    ${corners(RADIUS.PANEL_INNER)}
    /* Pick D: a faint track the full width, which the line shrinks over, so
       the room at the bottom always reads as the line's. */
    &::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${LINE_PX}px;
      background: ${COLORS.DIVIDER_COLOR};
    }
    & > span {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${LINE_PX}px;
      background: ${COLORS.LABEL_L3_COLOR};
      transform-origin: left;
    }
    /* Only the front toast shows its time (Justine): in an opened stack the
       older ones' lines read as clutter. Each still counts down. */
    [data-toast]:not([data-front]) > & {
      display: none;
    }
    /* Justine's pick: no line at all; the toast still leaves on time. */
    @media (prefers-reduced-motion: reduce) {
      display: none;
    }
  `;

  return (
    // A div, not a span: specs and styles read a toast's message as its span.
    <div data-time-left aria-hidden="true" css={lineStyle}>
      <span ref={bar} />
    </div>
  );
};
