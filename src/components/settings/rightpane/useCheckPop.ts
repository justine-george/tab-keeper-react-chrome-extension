import { useLayoutEffect, useRef, type RefObject } from 'react';

import { popPressedCheck } from './pickMotion';

/**
 * KAN-1031. A cell grid's check pops in when `picked` changes, in the commit
 * that draws the new cell; never on the grid's first paint.
 */
export function useCheckPop(
  cells: RefObject<HTMLElement | null>,
  picked: string
): void {
  // The pick last drawn: a change from it is a pick (StrictMode's second run
  // of the effect sees no change).
  const drawn = useRef(picked);
  useLayoutEffect(() => {
    if (drawn.current === picked) return;
    drawn.current = picked;
    popPressedCheck(cells.current);
  }, [cells, picked]);
}
