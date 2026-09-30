// KAN-350. Drives a carry while the pointer is outside every area that can
// take it, and draws the card that follows the pointer (D1 A).
//
// Mounted once, in MainContainer, outside every pane: a carry exists because
// the area it started in may unmount mid-gesture, so what finishes it must not
// be able to.
import { useEffect, useRef } from 'react';
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
            {(card.title || t('Unnamed group')) +
              ' · ' +
              formatTabCount(card.tabCount, t)}
          </span>
        </>
      );
    case 'window':
      return (
        <>
          <Icon type="tab" style={NON_INTERACTIVE_ICON_STYLE} />
          <span data-carry-card-name="" css={nameStyle}>
            {t('Window') +
              ' ' +
              card.windowNumber +
              ' · ' +
              formatTabCount(card.tabCount, t)}
          </span>
        </>
      );
  }
}

export function CarryLayer() {
  const carry = useCarry();
  const COLORS = useThemeColors();
  const tabGroups = useSelector(
    (state: RootState) => state.tabContainerDataState.tabGroups
  );

  // The receiver that owns the pointer, if any (Ruling 2).
  const owning = useRef<CarryReceiver | null>(null);

  // The click Chrome synthesizes after a release, aimed at whatever is under
  // the pointer -- a session row, Open now, the header. Swallowed by the
  // engine's rule (RowDragArea, KAN-177/335/337): ONE click, the one that
  // follows this press's release, disarmed by the next press. Infinity while
  // a cancelled press has yet to be released.
  const suppressClickUntil = useRef(0);

  // Bound for the life of the layer, not the carry: after Esc the carry is
  // over but its press is not, and the click that follows that press's
  // release still has to be eaten.
  useEffect(() => {
    const onUp = () => {
      if (suppressClickUntil.current === Number.POSITIVE_INFINITY)
        suppressClickUntil.current = performance.now() + 400;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClickUntil.current === Number.POSITIVE_INFINITY) return;
      if (performance.now() >= suppressClickUntil.current) return;
      suppressClickUntil.current = 0;
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointerDownCapture = () => {
      suppressClickUntil.current = 0;
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
    };
  }, []);

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
      suppressClickUntil.current = performance.now() + 400;
      route(e.clientX, e.clientY);
      const taker = owning.current;
      try {
        taker?.take();
      } finally {
        // Taken or not, the release ends the gesture: a receiver that
        // committed has done so, and one that refused, or none hit, is a
        // cancel. In a `finally` so a throwing receiver cannot leave the hold
        // on for the rest of the page.
        release();
        endCarry();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || currentCarry()?.owner !== 'layer') return;
      // The press is still down: its click follows a release still to come.
      suppressClickUntil.current = Number.POSITIVE_INFINITY;
      release();
      endCarry();
    };
    // Chrome dispatches no click after a pointercancel; armed anyway, as the
    // engine does, and the next press disarms it.
    const onCancel = () => {
      if (currentCarry()?.owner !== 'layer') return;
      suppressClickUntil.current = performance.now() + 400;
      release();
      endCarry();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      // However the layer stopped driving -- the carry ended some other way,
      // or an area adopted it -- no receiver owns the pointer any more.
      release();
    };
  }, [carrying, owner]);

  // A change on THIS page that takes the carried item away -- ⌘Z, a delete --
  // ends the carry: there is nothing left to move. Other pages' changes wait
  // for the release, held by the drag hold the carry keeps on.
  const carried = carry?.carried ?? null;
  useEffect(() => {
    if (carried !== null && !isCarriedStillThere(tabGroups, carried)) {
      endCarry();
    }
  }, [tabGroups, carried]);

  if (carry === null) return null;

  return createPortal(
    <div
      data-carry-card=""
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
        transform: `translate(${carry.x + CARD_OFFSET_X}px, ${
          carry.y + CARD_OFFSET_Y
        }px)`,
      }}
    >
      <CardBody card={carry.card} />
    </div>,
    document.body
  );
}
