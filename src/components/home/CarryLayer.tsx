// KAN-350. Drives a carry while the pointer is outside every area that can
// take it, and draws the card that follows the pointer (D1 A).
//
// Mounted once, in MainContainer, outside every pane: a carry exists because
// the area it started in may unmount mid-gesture, so what finishes it must not
// be able to.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { useThemeColors } from '../../hooks/useThemeColors';
import { RADIUS, TYPE } from '../../styles/scale';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';
import { formatTabCount } from '../../utils/functions/local';
import { isCarriedStillThere } from '../../utils/functions/carriedView';
import { createClickSuppressor } from './rightpane/rowDrag/clickSuppressor';
import type { RootState } from '../../redux/store';
import {
  carryReceiverAt,
  currentCarry,
  endCarry,
  moveCarry,
  useCarry,
  type CarryCard,
  type CarryReceiver,
} from '../../redux/carry';
import { useDragCard } from '../../redux/dragCard';

// Where the card sits from the pointer: just below and to the right of the
// arrow's tip, as the mock draws it.
const CARD_OFFSET_X = 8;
const CARD_OFFSET_Y = 4;
// Above the toast (1000): the card is under the pointer, and a toast arriving
// mid-carry must not cover what is being carried.
const CARD_Z_INDEX = 1100;

function CardBody({ card }: { card: CarryCard }) {
  const { t } = useTranslation();
  const nameStyle = css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `;
  switch (card.kind) {
    case 'tab':
      return (
        <>
          <Icon
            faviconUrl={card.faviconUrl}
            type="globe"
            style={NON_INTERACTIVE_ICON_STYLE}
          />
          <span data-carry-card-name="" css={nameStyle}>
            {card.title}
          </span>
        </>
      );
    case 'group':
      return (
        <>
          <span
            data-carry-card-dot=""
            css={css`
              flex: none;
              width: 10px;
              height: 10px;
              border-radius: ${RADIUS.CIRCLE};
            `}
            // Chrome's own group colour, not app chrome: a fixed map, the
            // same one the band paints with.
            style={{ backgroundColor: card.color }}
          />
          <span data-carry-card-name="" css={nameStyle}>
            {t('CarryCardNameAndCount', {
              name: card.title || t('Unnamed group'),
              count: card.tabCount,
            })}
          </span>
        </>
      );
    case 'window':
      return (
        <>
          <Icon type="tab" style={NON_INTERACTIVE_ICON_STYLE} />
          <span data-carry-card-name="" css={nameStyle}>
            {/* Named as its header names it (WindowEntryContainer): by its
                title, and by nothing when that is empty -- then the count
                alone, rather than a count after a dangling separator. */}
            {card.title === ''
              ? formatTabCount(card.tabCount, t)
              : t('CarryCardNameAndCount', {
                  name: card.title,
                  count: card.tabCount,
                })}
          </span>
        </>
      );
  }
}

export function CarryLayer() {
  const carry = useCarry();
  const dragCard = useDragCard();
  const COLORS = useThemeColors();
  const tabGroups = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups
  );

  // The receiver that owns the pointer, if any (Ruling 2).
  const owning = useRef<CarryReceiver | null>(null);

  // The click Chrome synthesizes after a release, aimed at whatever is under
  // the pointer -- a session row, Open now, the header. Swallowed by the
  // engine's own rule (clickSuppressor.ts): ONE click, the one that follows
  // this press's release, disarmed by the next press.
  const [clicks] = useState(createClickSuppressor);

  // Bound for the life of the layer, not the carry: after Esc the carry is
  // over but its press is not, and the click that follows that press's
  // release still has to be eaten.
  useEffect(() => {
    const onUp = () => clicks.onPointerUp();
    const onClickCapture = (e: MouseEvent) => clicks.onClickCapture(e);
    const onPointerDownCapture = () => clicks.onPointerDownCapture();
    window.addEventListener('pointerup', onUp);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
    };
  }, [clicks]);

  const carrying = carry !== null;
  const owner = carry?.owner;

  useEffect(() => {
    if (!carrying) return;

    const release = () => {
      const r = owning.current;
      owning.current = null;
      r?.leave();
    };
    // The first receiver hit owns the pointer; one it stops being hears
    // leave, before the new one hears anything.
    const route = (x: number, y: number) => {
      const hit = carryReceiverAt(x, y);
      if (hit !== owning.current) {
        release();
        owning.current = hit;
      }
      hit?.hover(x, y);
    };

    // The card follows the pointer whoever owns the carry. Everything else is
    // the layer's only while it owns it: an area that adopted the carry
    // (Task 5) routes, releases and cancels its own drag.
    const onMove = (e: PointerEvent) => {
      moveCarry(e.clientX, e.clientY);
      if (currentCarry()?.owner === 'layer') route(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (currentCarry()?.owner !== 'layer') return;
      clicks.armForRelease();
      route(e.clientX, e.clientY);
      const taker = owning.current;
      let taken = false;
      try {
        taken = taker?.take() ?? false;
      } finally {
        // Taken or not, the release ends the gesture: a receiver that
        // committed has done so, and one that refused, or none hit, is a
        // cancel. In a `finally` so a throwing receiver cannot leave the hold
        // on for the rest of the page.
        release();
        endCarry(taken ? 'committed' : 'cancelled');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || currentCarry()?.owner !== 'layer') return;
      // The press is still down: its click follows a release still to come.
      clicks.armUntilRelease();
      release();
      endCarry('cancelled');
    };
    // Chrome dispatches no click after a pointercancel; armed anyway, as the
    // engine does, and the next press disarms it.
    const onCancel = () => {
      if (currentCarry()?.owner !== 'layer') return;
      clicks.armForRelease();
      release();
      endCarry('cancelled');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    // The move that gave the layer the carry -- a hand-off, or a hand-back
    // -- was dispatched before these listeners existed: routed now, at the
    // point the carry was given at, so the row under it is the target, and
    // its dwell starts, with that move rather than the next one.
    const now = currentCarry();
    if (now?.owner === 'layer') route(now.x, now.y);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      // However the layer stopped driving -- the carry ended some other way,
      // or an area adopted it -- no receiver owns the pointer any more.
      release();
    };
  }, [carrying, owner, clicks]);

  // A change on THIS page that takes the carried item away -- ⌘Z, a delete --
  // ends the carry: there is nothing left to move. Other pages' changes wait
  // for the release, held by the drag hold the carry keeps on. The press is
  // still down, so its click is eaten when it is released, as after Esc.
  const carried = carry?.carried ?? null;
  useEffect(() => {
    if (carried !== null && !isCarriedStillThere(tabGroups, carried)) {
      clicks.armUntilRelease();
      endCarry('cancelled');
    }
  }, [tabGroups, carried, clicks]);

  // The saved search panel opened mid-carry (only the keyboard can do that)
  // ends the carry: the session list is no receiver while it is open, and a
  // saved drag cannot start there (KAN-140). Cancelled as a removed item is,
  // with the press still down.
  const isSearchPanel = useSelector(
    (state: RootState) => state.globalState.isSearchPanel
  );
  useEffect(() => {
    if (carried !== null && isSearchPanel) {
      clicks.armUntilRelease();
      endCarry('cancelled');
    }
  }, [isSearchPanel, carried, clicks]);

  // A carry's card wins: at a hand-off the carry starts before the drag card
  // is hidden, so one element is on screen throughout and React keeps it.
  const shown = carry ?? dragCard;
  if (shown === null) return null;

  return createPortal(
    <div
      // `data-carry-card` means "a carry is on"; an in-list drag's card wears
      // `data-drag-card` instead.
      data-carry-card={carry === null ? undefined : ''}
      data-drag-card={carry === null ? '' : undefined}
      aria-hidden="true"
      css={css`
        position: fixed;
        left: 0;
        top: 0;
        z-index: ${CARD_Z_INDEX};
        box-sizing: border-box;
        width: 230px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border-radius: ${RADIUS.SQUARE};
        background-color: ${COLORS.PRIMARY_LIGHT};
        color: ${COLORS.TEXT_COLOR};
        box-shadow: ${COLORS.FLOATING_SHADOW};
        font-size: ${TYPE.BODY};
        pointer-events: none;
      `}
      style={{
        transform: `translate(${shown.x + CARD_OFFSET_X}px, ${
          shown.y + CARD_OFFSET_Y
        }px)`,
      }}
    >
      <CardBody card={shown.card} />
    </div>,
    document.body
  );
}
