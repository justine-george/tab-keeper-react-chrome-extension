import {
  PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

// KAN-582. How long the pointer stays on an unselected saved row before its actions show.
export const ROW_ACTIONS_DWELL_MS = 2000;

type Point = { x: number; y: number };

/**
 * Whether a saved row shows its action strip, and which of its buttons may be pressed.
 *
 * `engaged` (selected, or the tour's row) shows the strip at once; any other row shows it after
 * ROW_ACTIONS_DWELL_MS on the row, and hides it when the pointer leaves. When the strip appears under
 * a pointer already on the row (the dwell ends, or a click selects the row), the button under it is
 * not pressable until the pointer leaves that button: `pressable` is false and the row's click handles it.
 */
export function useRowActionReveal(engaged: boolean) {
  const [dwelled, setDwelled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const point = useRef<Point | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const covered = useRef<Element | null>(null);
  const shown = engaged || dwelled;
  const wasShown = useRef(shown);

  const stopDwell = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopDwell, []);

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
      stopDwell();
      timer.current = setTimeout(() => setDwelled(true), ROW_ACTIONS_DWELL_MS);
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
      stopDwell();
      point.current = null;
      covered.current = null;
      setDwelled(false);
    },
  };

  const pressable = (button: Element) =>
    covered.current === null ||
    !(covered.current.contains(button) || button.contains(covered.current));

  return { shown, strip, rowEvents, pressable };
}
