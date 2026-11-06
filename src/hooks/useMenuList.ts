import { useEffect, useRef } from 'react';

import { swallowPress } from './swallowPress';
import type { PopoverAxis } from './usePopoverList';

// A press on the run's card counts as inside: its buttons must not close a menu open under it.
const PRESS_INSIDE = '[data-coach-mark]';

export type MenuDismissReason = 'outside' | 'escape';

// KAN-708. A trigger-less menu's list: focus in on open, roving arrows, Esc, press outside; the opener decides where focus goes.
export function useMenuList({
  count,
  axis,
  isOpen,
  wrapperRef,
  onDismiss,
  onWalk,
  rows = [],
}: {
  count: number;
  axis: PopoverAxis;
  /** KAN-775, KAN-936. How many items each row above a vertical list holds, top down: a row is one stop for ↑/↓, walked with ←/→. */
  rows?: readonly number[];
  isOpen: boolean;
  wrapperRef: React.RefObject<HTMLElement | null>;
  onDismiss: (reason: MenuDismissReason) => void;
  onWalk?: () => void;
}) {
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  // The outside-press listener must not re-bind on every render for a fresh closure.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  // Opening moves focus into the list, which is what makes it operable
  // without a pointer at all.
  useEffect(() => {
    if (isOpen) itemRefs.current[0]?.focus();
  }, [isOpen]);

  // KAN-699. An item that goes while it holds focus leaves focus on the page, out of reach of Esc and the arrows.
  useEffect(() => {
    if (isOpen && document.activeElement === document.body) {
      itemRefs.current[0]?.focus();
    }
  }, [isOpen, count]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const isInside =
        target !== null &&
        (wrapperRef.current?.contains(target) === true ||
          target.closest(PRESS_INSIDE) !== null);
      if (isInside) return;
      onDismissRef.current('outside');
      // KAN-778. A right press goes on to open its row's menu (KAN-708 pick 3).
      if (e.button === 0 && !e.ctrlKey) swallowPress(e);
    };
    // Capture at window: ahead of every listener that could act on the press.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [isOpen, wrapperRef]);

  const focusItem = (index: number) => {
    if (count === 0) return;
    // Wraps in both directions, so the list has no dead ends.
    itemRefs.current[((index % count) + count) % count]?.focus();
  };

  const indexOfFocused = () =>
    itemRefs.current.findIndex((el) => el === document.activeElement);

  const prevKey = axis === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = axis === 'vertical' ? 'ArrowDown' : 'ArrowRight';

  // KAN-775, KAN-936. Each row is one stop, at its first item; the list's items are a stop each.
  const rowStarts = rows.map((_, row) =>
    rows.slice(0, row).reduce((sum, size) => sum + size, 0)
  );
  const listStart = rows.reduce((sum, size) => sum + size, 0);
  const stops = [
    ...rowStarts,
    ...Array.from({ length: count - listStart }, (_, i) => listStart + i),
  ];
  const hasRow = axis === 'vertical' && rows.length > 0;
  // Which of these ascending starts an index sits at or past; -1 for none.
  const lastAtOrBefore = (starts: number[], index: number): number =>
    starts.filter((start) => start <= index).length - 1;
  const stepFrom = (index: number, by: 1 | -1): number => {
    if (!hasRow) return index + by;
    const stop = lastAtOrBefore(stops, index);
    return stops[(stop + by + stops.length) % stops.length];
  };
  // The row an index sits in, or null on the list.
  const rowOf = (index: number): { start: number; size: number } | null => {
    if (index < 0 || index >= listStart) return null;
    const row = lastAtOrBefore(rowStarts, index);
    return { start: rowStarts[row], size: rows[row] };
  };
  const walkRow = (
    index: number,
    { start, size }: { start: number; size: number },
    by: 1 | -1
  ) => itemRefs.current[start + ((index - start + by + size) % size)]?.focus();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      // An unprevented Esc closes the extension popup too.
      e.preventDefault();
      onDismiss('escape');
      return;
    }
    if (e.key === nextKey) {
      e.preventDefault();
      onWalk?.();
      focusItem(stepFrom(indexOfFocused(), 1));
      return;
    }
    if (e.key === prevKey) {
      e.preventDefault();
      onWalk?.();
      focusItem(stepFrom(indexOfFocused(), -1));
      return;
    }
    const focused = indexOfFocused();
    const row = hasRow ? rowOf(focused) : null;
    if (row !== null && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      onWalk?.();
      walkRow(focused, row, e.key === 'ArrowRight' ? 1 : -1);
    }
  };

  const registerItem = (index: number) => (el: HTMLElement | null) => {
    itemRefs.current[index] = el;
  };

  return { registerItem, handleKeyDown };
}
