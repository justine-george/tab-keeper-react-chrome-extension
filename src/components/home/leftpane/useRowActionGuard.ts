import { PointerEvent, useLayoutEffect, useRef } from 'react';

type Point = { x: number; y: number };

/**
 * KAN-582. Which of a saved row's action buttons may be pressed.
 *
 * When the strip appears (`shown` turns true) under a pointer already on the row -- a click that
 * selects the row draws it there -- the button under the pointer is not pressable until the pointer
 * leaves that button, so a double-click selects instead of pressing it. `pressable` is false for it;
 * the row's own click handles that press. Leaving the row lifts the hold.
 */
export function useRowActionGuard(shown: boolean) {
  const point = useRef<Point | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const covered = useRef<Element | null>(null);
  const wasShown = useRef(shown);

  useLayoutEffect(() => {
    const appeared = shown && !wasShown.current;
    wasShown.current = shown;
    if (!appeared || point.current === null) return;
    const under = document
      .elementFromPoint(point.current.x, point.current.y)
      ?.closest('[data-row-actions] > *');
    covered.current = under && strip.current?.contains(under) ? under : null;
  }, [shown]);

  const rowEvents = {
    onPointerEnter: (e: PointerEvent) => {
      point.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: PointerEvent) => {
      point.current = { x: e.clientX, y: e.clientY };
      if (
        covered.current !== null &&
        !(e.target instanceof Node && covered.current.contains(e.target))
      )
        covered.current = null;
    },
    onPointerLeave: () => {
      point.current = null;
      covered.current = null;
    },
  };

  const pressable = (button: Element) =>
    covered.current === null ||
    !(covered.current.contains(button) || button.contains(covered.current));

  return { strip, rowEvents, pressable };
}
