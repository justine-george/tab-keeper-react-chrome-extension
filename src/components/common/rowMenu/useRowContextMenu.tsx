import React, { useEffect, useId, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { OverflowMenuItem } from '../MenuPanel';
import { RowContextMenu, type RowMenuCloseReason } from './RowContextMenu';
import {
  closeRowMenu,
  getRowMenu,
  openRowMenu,
  useOwnRowMenu,
  type RowMenuKind,
} from './rowMenuStore';
import { selectRunHere } from '../../../redux/firstRun';
import { useMacKeys } from '../../../hooks/useIsMac';

export type RowMenuProps = {
  onContextMenu: React.MouseEventHandler;
  onKeyDown: React.KeyboardEventHandler;
  onMouseDownCapture: React.MouseEventHandler;
  onClickCapture: React.MouseEventHandler;
  'data-row-menu-held'?: '';
};

// KAN-708. Chrome's menu stays on these: copy and paste.
const TEXT_FIELD =
  'input, textarea, [contenteditable]:not([contenteditable="false"])';
// KAN-708. R1: a menu answers for itself, whether a ⋮ in the row or this hook's own.
const MENU = '[role="menu"]';

const isWithin = (target: EventTarget, selector: string): boolean =>
  target instanceof Element && target.closest(selector) !== null;

export const isTouch = (e: React.MouseEvent): boolean =>
  typeof PointerEvent !== 'undefined' &&
  e.nativeEvent instanceof PointerEvent &&
  e.nativeEvent.pointerType === 'touch';

export const isMovingRows = (): boolean => {
  const root = document.documentElement;
  return (
    root.hasAttribute('data-dragging') || root.hasAttribute('data-carrying')
  );
};

export const isMenuKey = (e: React.KeyboardEvent): boolean =>
  e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);

// KAN-708. A Ctrl+press on a Mac is a right-click there; its click must not act on the control. Spread both on it.
export function useMacCtrlClickGuard(): {
  onMouseDownCapture: React.MouseEventHandler;
  onClickCapture: React.MouseEventHandler;
  forget: () => void;
} {
  const isMac = useMacKeys();
  const pressed = useRef(false);
  return {
    // KAN-708. A press in a menu is never marked, so its item's click always lands (R1).
    onMouseDownCapture: (e) => {
      pressed.current =
        isMac && e.button === 0 && e.ctrlKey && !isWithin(e.target, MENU);
    },
    onClickCapture: (e) => {
      if (!pressed.current) return;
      pressed.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    forget: () => {
      pressed.current = false;
    },
  };
}

// KAN-708. What a right-click or menu key on a row gets. 'chromeHere': Chrome's menu, and no enclosing row answers.
type Answer = 'chrome' | 'chromeHere' | 'suppress' | 'open';

// KAN-708. Right-click, Shift+F10 or the Menu key opens a row's ⋮ items; spread rowProps(id) on rows, render menu outside them all (R1).
// KAN-708. Portalled, its React events still reach the consumer's ancestors: an enclosing drag row ignores them only via its handleSelector.
export function useRowContextMenu({
  kind,
  ariaLabel,
  itemsFor,
}: {
  kind: RowMenuKind;
  ariaLabel: (id: string) => string;
  itemsFor: (id: string) => OverflowMenuItem[] | null;
}): {
  rowProps: (id: string) => RowMenuProps;
  heldId: string | null;
  menu: React.ReactElement | null;
} {
  const owner = useId();
  const tourRuns = useSelector(selectRunHere) !== null;
  const macGuard = useMacCtrlClickGuard();
  const ownTarget = useOwnRowMenu(owner);

  // KAN-708. Where Esc puts focus back: whatever had it when the menu opened.
  const focusReturn = useRef<Element | null>(null);

  const answerFor = (
    e: React.SyntheticEvent,
    id: string,
    via: 'pointer' | 'touch' | 'key'
  ): Answer => {
    if (isWithin(e.target, MENU)) return 'chrome';
    if (isWithin(e.target, TEXT_FIELD) || via === 'touch') return 'chrome';
    if (tourRuns || isMovingRows()) return 'suppress';
    const open = getRowMenu();
    // KAN-708. The keyboard opened it already; this is the contextmenu that may follow the same key press. A key is never one.
    if (
      via === 'pointer' &&
      open?.owner === owner &&
      open.ids[0] === id &&
      !open.byPointer
    ) {
      return 'suppress';
    }
    // KAN-708. Stopped here, or an enclosing row would open its own menu for this one.
    if (itemsFor(id) === null) return 'chromeHere';
    return 'open';
  };

  // KAN-708. Counts opens, so each one is a new menu even on the same row and point.
  const [opens, setOpens] = useState(0);

  const openAt = (
    id: string,
    at: { x: number; y: number },
    byPointer: boolean
  ) => {
    setOpens((n) => n + 1);
    focusReturn.current = document.activeElement;
    openRowMenu({ owner, kind, ids: [id], at, byPointer });
  };

  const rowProps = (id: string): RowMenuProps => ({
    onContextMenu: (e) => {
      const answer = answerFor(e, id, isTouch(e) ? 'touch' : 'pointer');
      if (answer === 'chrome') return;
      e.stopPropagation();
      if (answer === 'chromeHere') return;
      e.preventDefault();
      if (answer === 'open') openAt(id, { x: e.clientX, y: e.clientY }, true);
    },
    onKeyDown: (e) => {
      if (!isMenuKey(e)) {
        // KAN-708. A keyboard click follows no press, so a stale Ctrl+press must not swallow it.
        macGuard.forget();
        return;
      }
      const answer = answerFor(e, id, 'key');
      if (answer === 'chrome') return;
      e.stopPropagation();
      if (answer === 'chromeHere') return;
      e.preventDefault();
      if (answer !== 'open') return;
      const anchor = e.target instanceof Element ? e.target : e.currentTarget;
      const rect = anchor.getBoundingClientRect();
      openAt(id, { x: rect.left, y: rect.bottom }, false);
    },
    onMouseDownCapture: macGuard.onMouseDownCapture,
    onClickCapture: macGuard.onClickCapture,
    ...(ownTarget?.ids[0] === id ? { 'data-row-menu-held': '' } : {}),
  });

  const heldId = ownTarget?.ids[0] ?? null;
  // KAN-708. Read from the live row each render, so the menu never acts on a stale copy.
  const items = heldId === null ? null : itemsFor(heldId);
  const itemsGone = ownTarget !== null && items === null;

  // KAN-708. The row went away (deleted, moved out by sync, filtered out) or its ⋮ hid.
  useEffect(() => {
    if (itemsGone) closeRowMenu();
  }, [itemsGone]);

  useEffect(
    () => () => {
      if (getRowMenu()?.owner === owner) closeRowMenu();
    },
    [owner]
  );

  const onClose = (reason: RowMenuCloseReason) => {
    if (ownTarget === null || getRowMenu() !== ownTarget) return;
    closeRowMenu();
    if (reason !== 'escape') return;
    const el = focusReturn.current;
    if (el instanceof HTMLElement && el.isConnected) {
      el.focus(ownTarget.byPointer ? { focusVisible: false } : undefined);
    }
  };

  const menu =
    ownTarget === null || items === null ? null : (
      <RowContextMenu
        // KAN-708. A new open is a new menu: focus goes to its first item again.
        key={opens}
        target={ownTarget}
        ariaLabel={ariaLabel(ownTarget.ids[0])}
        items={items}
        onClose={onClose}
      />
    );

  return { rowProps, heldId, menu };
}
