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
  const shown = useRef(false);
  useLayoutEffect(() => {
    if (shown.current) popPressedCheck(cells.current);
    shown.current = true;
  }, [cells, picked]);
}
