import { flushSync } from 'react-dom';

import {
  canAnimate,
  prefersReducedMotion,
} from '../../modals/getStartedMotion';
import { EASE } from '../../../styles/scale';

/**
 * KAN-1024, KAN-1031. How a pick moves in a picker: a theme or toolbar icon
 * tile, or a language cell.
 *
 * The check pops in on the new choice; on a tile the old check fades where it
 * is and the frames change at once. For a theme, the whole page cross-fades to
 * the new colors.
 *
 * Script animations, not CSS transitions: a theme change switches every CSS
 * transition off for two frames (useDocumentTheme, KAN-22), so a transition
 * on the check would never run.
 */
const CHECK_FADE_MS = 120;
const CHECK_POP_MS = 200;
const PAGE_FADE_MS = 250;

// Half size to full, fading in.
function popIn(check: HTMLElement): void {
  check.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: CHECK_FADE_MS,
    easing: 'ease-out',
  });
  check.animate([{ transform: 'scale(0.5)' }, { transform: 'none' }], {
    duration: CHECK_POP_MS,
    easing: EASE.OUT,
  });
}

/** One tile's marker, as its pick turns it on or off. */
export function moveMarker(
  isOn: boolean,
  frame: HTMLElement | null,
  check: HTMLElement | null
): void {
  if (prefersReducedMotion()) return;
  if (check !== null && canAnimate(check)) {
    if (isOn) popIn(check);
    else {
      // Hidden at rest: shown until it has faded.
      check.animate(
        [
          { opacity: 1, visibility: 'visible' },
          { opacity: 0, visibility: 'visible' },
        ],
        { duration: CHECK_FADE_MS, easing: 'ease-out' }
      );
    }
  }
  if (frame !== null) {
    // The hover's colour transition would fade the frame: off for the pick, set
    // before the browser restyles the tile, back once the new frame is painted.
    frame.style.transition = 'none';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => (frame.style.transition = ''))
    );
  }
}

let latestFade = 0;

/**
 * A theme pick: the page cross-fades to the new colors, dialog included. The
 * change runs inside a view transition that pictures the whole page, flagged
 * on <html> while it runs.
 */
export function pickTheme(update: () => void): void {
  const start = document.startViewTransition?.bind(document);
  if (start === undefined || prefersReducedMotion()) {
    update();
    return;
  }
  const token = ++latestFade;
  const root = document.documentElement;
  root.dataset.pageFade = '';
  // flushSync: the browser pictures the new page as soon as this returns.
  const transition = start(() => flushSync(update));
  // A second pick mid-fade owns the flag now.
  void transition.finished.finally(() => {
    if (token === latestFade) delete root.dataset.pageFade;
  });
}

/**
 * KAN-1031. A language pick: the new cell's check pops in, drawn in the same
 * commit as the cell. The words change at once, as before: a page fade between
 * languages doubled every word and brightened the full view mid-fade.
 */
export function popPressedCheck(cells: HTMLElement | null): void {
  if (prefersReducedMotion()) return;
  const check = cells?.querySelector<HTMLElement>(
    '[aria-pressed="true"] > div[aria-hidden="true"]'
  );
  if (check && canAnimate(check)) popIn(check);
}

/** The theme pick's page fade, for a <Global> in both views. */
export const pickMotionCss = `
  /* The full view pictures only its panes (paneMotion); a theme pick pictures the page as one. */
  html[data-page-fade] { view-transition-name: root; }
  html[data-page-fade] [data-pane] { view-transition-name: none; }
  html[data-page-fade]::view-transition-old(root),
  html[data-page-fade]::view-transition-new(root) {
    animation-duration: ${PAGE_FADE_MS}ms;
    animation-timing-function: ease-out;
  }
`;
