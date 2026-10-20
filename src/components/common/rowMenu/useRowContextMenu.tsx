import React, { useEffect, useId, useRef } from 'react';
import { useSelector } from 'react-redux';

import type { OverflowMenuItem } from '../MenuPanel';
import { RowContextMenu, type RowMenuCloseReason } from './RowContextMenu';
import {
  closeRowMenu,
  getRowMenu,
  openRowMenu,
  useRowMenuTarget,
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

// Chrome's menu stays on these: copy and paste.
const TEXT_FIELD =
  'input, textarea, [contenteditable]:not([contenteditable="false"])';
// R1: a menu answers for itself, whether a ⋮ in the row or this hook's own.
const MENU = '[role="menu"]';

const isWithin = (target: EventTarget, selector: string): boolean =>
  target instanceof Element && target.closest(selector) !== null;

const isTouch = (e: React.MouseEvent): boolean =>
  typeof PointerEvent !== 'undefined' &&
  e.nativeEvent instanceof PointerEvent &&
  e.nativeEvent.pointerType === 'touch';

const isMovingRows = (): boolean => {
  const root = document.documentElement;
  return (
    root.hasAttribute('data-dragging') || root.hasAttribute('data-carrying')
  );
};

const isMenuKey = (e: React.KeyboardEvent): boolean =>
  e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);

// What a right-click or menu key on a row gets: Chrome's menu, nothing at all, or the row's menu.
type Answer = 'chrome' | 'suppress' | 'open';

/**
 * KAN-708. Right-click, Shift+F10 or the Menu key on a row opens that row's ⋮ items at the pointer.
 *
 * Spread `rowProps(id)` on each row. Render `menu` OUTSIDE every element carrying rowProps (R1):
 * React events bubble through portals along the React tree.
 */
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
  const isMac = useMacKeys();
  const target = useRowMenuTarget();

  // Where Esc puts focus back: whatever had it when the menu opened.
  const focusReturn = useRef<Element | null>(null);
  // A Ctrl+press on a Mac is a right-click there; its click must not act on the row.
  const macCtrlPress = useRef(false);

  const answerFor = (
    e: React.SyntheticEvent,
    id: string,
    touch: boolean
  ): Answer => {
    if (isWithin(e.target, MENU)) return 'chrome';
    if (isWithin(e.target, TEXT_FIELD) || touch) return 'chrome';
    if (tourRuns || isMovingRows()) return 'suppress';
    const open = getRowMenu();
    // The keyboard opened it already; this is the contextmenu that may follow the same key press.
    if (open?.owner === owner && open.ids[0] === id && !open.byPointer) {
      return 'suppress';
    }
    if (itemsFor(id) === null) return 'chrome';
    return 'open';
  };

  const openAt = (
    id: string,
    at: { x: number; y: number },
    byPointer: boolean
  ) => {
    focusReturn.current = document.activeElement;
    openRowMenu({ owner, kind, ids: [id], at, byPointer });
  };

  const rowProps = (id: string): RowMenuProps => ({
    onContextMenu: (e) => {
      const answer = answerFor(e, id, isTouch(e));
      if (answer === 'chrome') return;
      e.preventDefault();
      e.stopPropagation();
      if (answer === 'open') openAt(id, { x: e.clientX, y: e.clientY }, true);
    },
    onKeyDown: (e) => {
      if (!isMenuKey(e)) {
        // A keyboard click follows no press, so a stale Ctrl+press must not swallow it.
        macCtrlPress.current = false;
        return;
      }
      const answer = answerFor(e, id, false);
      if (answer === 'chrome') return;
      e.preventDefault();
      e.stopPropagation();
      if (answer !== 'open') return;
      const anchor = e.target instanceof Element ? e.target : e.currentTarget;
      const rect = anchor.getBoundingClientRect();
      openAt(id, { x: rect.left, y: rect.bottom }, false);
    },
    // A press in a menu is never marked, so its item's click always lands (R1).
    onMouseDownCapture: (e) => {
      macCtrlPress.current =
        isMac && e.button === 0 && e.ctrlKey && !isWithin(e.target, MENU);
    },
    onClickCapture: (e) => {
      if (!macCtrlPress.current) return;
      macCtrlPress.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    ...(target?.owner === owner && target.ids[0] === id
      ? { 'data-row-menu-held': '' }
      : {}),
  });

  const ownTarget = target?.owner === owner ? target : null;
  const heldId = ownTarget?.ids[0] ?? null;
  // Read from the live row each render, so the menu never acts on a stale copy.
  const items = heldId === null ? null : itemsFor(heldId);
  const itemsGone = ownTarget !== null && items === null;

  // The row went away (deleted, moved out by sync, filtered out) or its ⋮ hid.
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
        // A new open is a new menu: focus goes to its first item again.
        key={`${ownTarget.ids.join(' ')}@${ownTarget.at.x},${ownTarget.at.y}`}
        target={ownTarget}
        ariaLabel={ariaLabel(ownTarget.ids[0])}
        items={items}
        onClose={onClose}
      />
    );

  return { rowProps, heldId, menu };
}
