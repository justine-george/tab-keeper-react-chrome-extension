import { RefObject, useLayoutEffect } from 'react';

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
    const write = () =>
      targetEl.style.setProperty(
        SCROLLBAR_WIDTH_VAR,
        `${barWidth(scrollerEl)}px`
      );
    write();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(write);
    observer.observe(scrollerEl);
    return () => observer.disconnect();
  }, [scroller, target]);
}
