import { RefObject, useLayoutEffect } from 'react';

import {
  ROW_GUTTER_BESIDE_BAR_PX,
  ROW_GUTTER_END_VAR,
  ROW_GUTTER_PX,
} from '../styles/rowHighlight';

// Where useScrollbarWidthVar writes the bar's width.
export const SCROLLBAR_WIDTH_VAR = '--scrollbar-width';

// The width the scroller's vertical bar takes: 0 while nothing scrolls.
function barWidth(scroller: HTMLElement): number {
  const style = getComputedStyle(scroller);
  const borders =
    (parseFloat(style.borderLeftWidth) || 0) +
    (parseFloat(style.borderRightWidth) || 0);
  return Math.max(0, scroller.offsetWidth - scroller.clientWidth - borders);
}

// KAN-336. Writes the scroller's bar width to SCROLLBAR_WIDTH_VAR on target,
// so a row outside the scroller can give up the same width as the rows
// inside it. A style write, not state: nothing re-renders, and the bar
// appearing (which resizes the scroller's content box) updates it before the
// frame paints.
export function useScrollbarWidthVar(
  scroller: RefObject<HTMLElement>,
  target: RefObject<HTMLElement>
) {
  useLayoutEffect(() => {
    const scrollerEl = scroller.current;
    const targetEl = target.current;
    if (!scrollerEl || !targetEl) return;
    const write = () => {
      const bar = barWidth(scrollerEl);
      targetEl.style.setProperty(SCROLLBAR_WIDTH_VAR, `${bar}px`);
      // KAN-721 R6. Beside a scrollbar the rows' end gutter narrows by the
      // thumb's inset, so the fill sits 4px from the thumb.
      targetEl.style.setProperty(
        ROW_GUTTER_END_VAR,
        `${bar > 0 ? ROW_GUTTER_BESIDE_BAR_PX : ROW_GUTTER_PX}px`
      );
    };
    write();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(write);
    observer.observe(scrollerEl);
    return () => observer.disconnect();
  }, [scroller, target]);
}
