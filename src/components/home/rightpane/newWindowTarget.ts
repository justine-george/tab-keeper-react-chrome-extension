// KAN-350 (S3 A), KAN-361 (N1 B). A New window target is a place a dragged
// or carried tab or group can be let go to make a new window of the session
// on screen. It is lit -- the hover fill and a solid border -- while the
// landing is in it.
//
// Written straight to the DOM, as a band's drop-target mark is
// (useTabDropGeometry's onDropTargetChange): it changes as the pointer moves,
// and React never renders this attribute, so a re-render cannot drop it.
import { css, type SerializedStyles } from '@emotion/react';

import { CARRY_NEW_WINDOW_ID } from '../../../utils/functions/carriedView';
import type { ThemeColors } from '../../../hooks/useThemeColors';
import { RADIUS } from '../../../styles/scale';

// The window a landing names when it makes a new window: placed first, by
// the session header's target (KAN-361), or last (KAN-366). Neither is a
// uuid, so neither can be a stored window's id. The drop routes on them
// (useTabDrop, useGroupDrop, dropCarried); the engine only names them.
export const NEW_FIRST_WINDOW = 'new-window:first';
export const NEW_LAST_WINDOW = 'new-window:last';

// The targets that name a new window, each by its `data-new-window-target`
// value: `first` in the session header, `last` at the list's end (KAN-366).
// Found in the document, since the header's is outside the list. The
// synthetic window a carry draws in the list (CARRY_NEW_WINDOW_ID) carries
// the attribute with no value.
const NEW_FIRST_TARGET = '[data-new-window-target="first"]';
const PLACED_TARGETS = [
  { windowId: NEW_FIRST_WINDOW, selector: NEW_FIRST_TARGET },
  { windowId: NEW_LAST_WINDOW, selector: '[data-new-window-target="last"]' },
];
const IN_LIST_TARGET = '[data-new-window-target=""]';

// Where the session header's target is drawn (HeroContainerRight), read now:
// a test of whether a point is on it, or null when it is not drawn. A drag
// reads it once, at activation, after the marker that shows it
// (setDragNewWindow) is on -- a target the user cannot see is no landing.
// Viewport space: it sits outside the scrolling list, so a list scrolling
// under the pointer never moves it.
export function measureNewFirstWindowTarget(
  doc: Document
): ((x: number, y: number) => boolean) | null {
  const el = doc.querySelector(NEW_FIRST_TARGET);
  if (el === null || getComputedStyle(el).visibility !== 'visible') {
    return null;
  }
  const b = el.getBoundingClientRect();
  return (x, y) => x >= b.left && x < b.right && y >= b.top && y < b.bottom;
}

// What a New window target's box looks like, wherever it is drawn: the
// in-list window (WindowEntryContainer) and the session header's toolbar row
// (KAN-361 N1 B, HeroContainerRight). One look in one place, so the two
// cannot drift apart. A dashed box, and lit -- the hover fill and a solid
// border -- while the landing is in it. Where it sits and how tall it is are
// the caller's; its name is NewWindowTargetLabel.
export function newWindowTargetBoxStyle(COLORS: ThemeColors): SerializedStyles {
  return css`
    border-width: 1.5px;
    border-style: dashed;
    border-color: ${COLORS.LABEL_L2_COLOR};
    border-radius: ${RADIUS.SQUARE};
    &[data-landing] {
      background-color: ${COLORS.HOVER_COLOR};
      border-style: solid;
    }
  `;
}

// A drag area's onLandingWindowChange: lights the target the landing window
// names and unlights every other -- the synthetic window's, found in `list`;
// NEW_FIRST_WINDOW's and NEW_LAST_WINDOW's, found in `list`'s document by
// their value.
export function markNewWindowTarget(
  windowId: string | undefined,
  list: HTMLElement | null
): void {
  if (list === null) return;
  const mark = (target: Element | null, lit: boolean) => {
    if (lit) target?.setAttribute('data-landing', '');
    else target?.removeAttribute('data-landing');
  };
  mark(list.querySelector(IN_LIST_TARGET), windowId === CARRY_NEW_WINDOW_ID);
  for (const placed of PLACED_TARGETS) {
    mark(
      list.ownerDocument.querySelector(placed.selector),
      windowId === placed.windowId
    );
  }
}
