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

// KAN-413. A press on the tour's coach mark is inside: its Finish must not close the menu it points at.
const PRESS_INSIDE = '[data-coach-mark]';

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
  // Opened by a pointer click and not walked with the keys since: Esc then
  // returns focus without the ring (KAN-405 2A). A key on the trigger, or a
  // key-activated click (detail 0), means the keyboard.
  const pointerOpened = useRef(false);
  // KAN-413. An open asked for from outside leaves the focus where it was, once.
  const focusOnOpen = useRef(true);
  useEffect(() => {
    const el = triggerRef.current;
    if (el === null) return;
    const onClick = (e: MouseEvent) => {
      pointerOpened.current = e.detail > 0;
    };
    const onKeyDown = () => {
      pointerOpened.current = false;
    };
    el.addEventListener('click', onClick, true);
    el.addEventListener('keydown', onKeyDown, true);
    return () => {
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

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

  const focusTrigger = (options?: FocusOptions) => {
    const trigger =
      triggerRef.current?.querySelector<HTMLElement>('[role="button"]');
    (trigger ?? triggerRef.current)?.focus(options);
  };

  // Focus goes back where it came from, or a keyboard user is dropped at
  // <body> and loses their place.
  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) focusTrigger();
    },
    [setOpen]
  );

  const openWithoutFocus = useCallback(() => {
    if (isOpen) return;
    focusOnOpen.current = false;
    setOpen(true);
  }, [isOpen, setOpen]);

  // Opening moves focus into the list, which is what makes it operable
  // without a pointer at all.
  useEffect(() => {
    if (isOpen && focusOnOpen.current) itemRefs.current[0]?.focus();
    focusOnOpen.current = true;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const isInside =
        target !== null &&
        (wrapperRef.current?.contains(target) === true ||
          target.closest(PRESS_INSIDE) !== null);
      if (!isInside) close(false);
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
      // An unprevented Esc closes the extension popup too.
      e.preventDefault();
      setOpen(false);
      focusTrigger(pointerOpened.current ? { focusVisible: false } : undefined);
      return;
    }
    if (e.key === nextKey) {
      e.preventDefault();
      pointerOpened.current = false;
      focusItem(indexOfFocused() + 1);
      return;
    }
    if (e.key === prevKey) {
      e.preventDefault();
      pointerOpened.current = false;
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
    openWithoutFocus,
    wrapperRef,
    triggerRef,
    registerItem,
    handleKeyDown,
  };
}
