import { useEffect, useRef } from 'react';

import { swallowPress } from './swallowPress';
import type { PopoverAxis } from './usePopoverList';

// A press on the run's card counts as inside: its buttons must not close a menu open under it.
const PRESS_INSIDE = '[data-coach-mark]';
// KAN-778. A press here closes the open menu and opens this one.
const OTHER_MENU_TRIGGER = '[aria-haspopup="menu"]';

export type MenuDismissReason = 'outside' | 'escape';

// KAN-708. A trigger-less menu's list: focus in on open, roving arrows, Esc, press outside; the opener decides where focus goes.
export function useMenuList({
  count,
  axis,
  isOpen,
  wrapperRef,
  onDismiss,
  onWalk,
  rowCount = 0,
}: {
  count: number;
  axis: PopoverAxis;
  /** KAN-775. The first `rowCount` items sit side by side above a vertical list: one stop for ↑/↓, walked with ←/→. */
  rowCount?: number;
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
      // KAN-778. A right press goes on to open its row's menu (KAN-708 pick 3); another menu's trigger opens it.
      const isLeftClick = e.button === 0 && !e.ctrlKey;
      if (isLeftClick && target?.closest(OTHER_MENU_TRIGGER) == null) {
        swallowPress(e);
      }
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

  // KAN-775. The row counts as one stop at its first item; the list's items are a stop each.
  const hasRow = axis === 'vertical' && rowCount > 0;
  const stepFrom = (index: number, by: 1 | -1): number => {
    if (!hasRow) return index + by;
    const stops = count - rowCount + 1;
    const stop = index < rowCount ? 0 : index - rowCount + 1;
    const next = (((stop + by) % stops) + stops) % stops;
    return next === 0 ? 0 : next + rowCount - 1;
  };
  const walkRow = (index: number, by: 1 | -1) =>
    itemRefs.current[
      (((index + by) % rowCount) + rowCount) % rowCount
    ]?.focus();

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
    const inRow = hasRow && focused >= 0 && focused < rowCount;
    if (inRow && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      onWalk?.();
      walkRow(focused, e.key === 'ArrowRight' ? 1 : -1);
    }
  };

  const registerItem = (index: number) => (el: HTMLElement | null) => {
    itemRefs.current[index] = el;
  };

  return { registerItem, handleKeyDown };
}
