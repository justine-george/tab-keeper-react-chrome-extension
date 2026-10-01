// KAN-350 (S3 A), KAN-361 (N1 B). A New window target is a place a dragged
// or carried tab or group can be let go to make a new window of the session
// on screen. It is lit -- the hover fill and a solid border -- while the
// landing is in it.
//
// Written straight to the DOM, as a band's drop-target mark is
// (useTabDropGeometry's onDropTargetChange): it changes as the pointer moves,
// and React never renders this attribute, so a re-render cannot drop it.
import { css, type SerializedStyles } from '@emotion/react';

import type { ThemeColors } from '../../../hooks/useThemeColors';
import type { NewWindowPlace } from '../../../redux/slices/tabContainerDataStateSlice';
import { RADIUS } from '../../../styles/scale';

// The window a landing names when it makes a new window: placed first, by
// the session header's target (KAN-361), or last, by the list's trailing
// block (KAN-366 B). Neither is a uuid, so neither can be a stored window's
// id. The drop routes on them (useTabDrop, useGroupDrop, dropCarried); the
// engine only names them.
export const NEW_FIRST_WINDOW = 'new-window:first';
export const NEW_LAST_WINDOW = 'new-window:last';

// Where the new window a landing in `windowId` makes is placed: first for
// the header's target, last for the list's trailing block (KAN-366 B).
// Undefined for every other window, which is no new window -- so it also
// answers "does this landing make one?".
export function newWindowPlacement(
  windowId: string | undefined
): NewWindowPlace | undefined {
  if (windowId === NEW_FIRST_WINDOW) return 'first';
  if (windowId === NEW_LAST_WINDOW) return 'last';
  return undefined;
}

// The targets that name a new window, each by its `data-new-window-target`
// value: `first` in the session header, `last` the list's trailing block
// (TabGroupDetailsContainer, KAN-366), which a carried tab's or group's
// phantom rests in. Found in the document, since the header's is outside the
// list.
const NEW_FIRST_TARGET = '[data-new-window-target="first"]';
const TARGETS = [
  { windowId: NEW_FIRST_WINDOW, selector: NEW_FIRST_TARGET },
  { windowId: NEW_LAST_WINDOW, selector: '[data-new-window-target="last"]' },
];

// A test of whether a point is on `target` as it is drawn now, or null when
// it is not drawn -- a target the user cannot see is no landing. Viewport
// space.
export function newWindowTargetHit(
  target: Element | null
): ((x: number, y: number) => boolean) | null {
  if (target === null || getComputedStyle(target).visibility !== 'visible') {
    return null;
  }
  const b = target.getBoundingClientRect();
  return (x, y) => x >= b.left && x < b.right && y >= b.top && y < b.bottom;
}

// The session header's target (HeroContainerRight), found in `doc` and read
// now (newWindowTargetHit). A drag reads it once, at activation, after the
// marker that shows it (setDragNewWindow) is on. It sits outside the
// scrolling list, so a list scrolling under the pointer never moves it.
export function measureNewFirstWindowTarget(
  doc: Document
): ((x: number, y: number) => boolean) | null {
  return newWindowTargetHit(doc.querySelector(NEW_FIRST_TARGET));
}

// What a New window target's box looks like, wherever it is drawn: the
// session header's toolbar row (KAN-361 N1 B, HeroContainerRight) and the
// list's trailing block, lit (WindowEntryContainer). One look in one place,
// so the two cannot drift apart. A dashed box, and lit -- the hover fill and a solid
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
// names and unlights every other, each found in `list`'s document by its
// value.
export function markNewWindowTarget(
  windowId: string | undefined,
  list: HTMLElement | null
): void {
  if (list === null) return;
  for (const target of TARGETS) {
    const el = list.ownerDocument.querySelector(target.selector);
    if (windowId === target.windowId) el?.setAttribute('data-landing', '');
    else el?.removeAttribute('data-landing');
  }
}
