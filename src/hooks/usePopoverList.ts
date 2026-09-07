import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The behaviour every popover in this app has to get right, in one place.
 *
 * Extracted when the group colour picker became OverflowMenu's second
 * consumer. Duplicating outside-click, Escape, focus-return and roving focus
 * is precisely what building a shared component was meant to avoid, and the
 * two differ only in which arrow keys walk the list.
 *
 * NOT built on the native Popover API: jsdom 30 implements none of it, so a
 * popover-based surface throws in every component test and ships with no
 * coverage. See the note on OverflowMenu.
 */
export type PopoverAxis = 'vertical' | 'horizontal';

export function usePopoverList({
  count,
  axis,
  onOpenChange,
}: {
  count: number;
  axis: PopoverAxis;
  onOpenChange?: (isOpen: boolean) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  // Every open/close goes through here, so onOpenChange cannot fall out of
  // step with the state it reports.
  const setOpen = useCallback(
    (next: boolean) => {
      setIsOpen((current) => {
        if (current !== next) onOpenChange?.(next);
        return next;
      });
    },
    [onOpenChange]
  );

  // Focus goes back where it came from, or a keyboard user is dropped at
  // <body> and loses their place.
  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) {
        const trigger =
          triggerRef.current?.querySelector<HTMLElement>('[role="button"]');
        (trigger ?? triggerRef.current)?.focus();
      }
    },
    [setOpen]
  );

  // Opening moves focus into the list, which is what makes it operable
  // without a pointer at all.
  useEffect(() => {
    if (isOpen) itemRefs.current[0]?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, close]);

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
      close(true);
      return;
    }
    if (e.key === nextKey) {
      e.preventDefault();
      focusItem(indexOfFocused() + 1);
      return;
    }
    if (e.key === prevKey) {
      e.preventDefault();
      focusItem(indexOfFocused() - 1);
    }
  };

  const registerItem = (index: number) => (el: HTMLElement | null) => {
    itemRefs.current[index] = el;
  };

  return {
    isOpen,
    setOpen,
    close,
    wrapperRef,
    triggerRef,
    registerItem,
    handleKeyDown,
  };
}
