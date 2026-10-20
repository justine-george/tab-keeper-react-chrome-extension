import { useEffect, useRef } from 'react';

import type { PopoverAxis } from './usePopoverList';

// A press on the run's card counts as inside: its buttons must not close a menu open under it.
const PRESS_INSIDE = '[data-coach-mark]';

export type MenuDismissReason = 'outside' | 'escape';

/**
 * KAN-708. A menu's list behaviour with no trigger in it: focus into the list on open,
 * roving arrows, Esc, and a press outside. Whoever opened the menu decides where focus goes.
 */
export function useMenuList({
  count,
  axis,
  isOpen,
  wrapperRef,
  onDismiss,
  onWalk,
}: {
  count: number;
  axis: PopoverAxis;
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
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const isInside =
        target !== null &&
        (wrapperRef.current?.contains(target) === true ||
          target.closest(PRESS_INSIDE) !== null);
      if (!isInside) onDismissRef.current('outside');
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
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
      focusItem(indexOfFocused() + 1);
      return;
    }
    if (e.key === prevKey) {
      e.preventDefault();
      onWalk?.();
      focusItem(indexOfFocused() - 1);
    }
  };

  const registerItem = (index: number) => (el: HTMLElement | null) => {
    itemRefs.current[index] = el;
  };

  return { registerItem, handleKeyDown };
}
