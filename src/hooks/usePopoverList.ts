import { useCallback, useEffect, useRef, useState } from 'react';

import { useMenuList } from './useMenuList';
import {
  closeRowMenu,
  getRowMenu,
  subscribeRowMenu,
} from '../components/common/rowMenu/rowMenuStore';

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
  // Opened by a pointer click and not walked with the keys since: Esc then
  // returns focus without the ring (KAN-405 2A). A key on the trigger, or a
  // key-activated click (detail 0), means the keyboard.
  const pointerOpened = useRef(false);
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
      // KAN-708. One menu open at a time: opening this one closes a row's right-click menu.
      if (next) closeRowMenu();
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

  // KAN-708. One menu open at a time: a row's right-click menu opening closes this one.
  useEffect(() => {
    if (!isOpen) return;
    return subscribeRowMenu(() => {
      if (getRowMenu() !== null) close(false);
    });
  }, [isOpen, close]);

  const { registerItem, handleKeyDown } = useMenuList({
    count,
    axis,
    isOpen,
    wrapperRef,
    onDismiss: (reason) => {
      if (reason === 'outside') {
        close(false);
        return;
      }
      setOpen(false);
      focusTrigger(pointerOpened.current ? { focusVisible: false } : undefined);
    },
    onWalk: () => {
      pointerOpened.current = false;
    },
  });

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
