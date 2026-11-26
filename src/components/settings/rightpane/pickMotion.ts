import { flushSync } from 'react-dom';

import {
  canAnimate,
  prefersReducedMotion,
} from '../../modals/getStartedMotion';
import { EASE } from '../../../styles/scale';

/**
 * KAN-1024. How a pick moves in a picture-tile picker (themes, toolbar icon).
 *
 * The check pops in on the new tile as the old one fades where it is; the
 * frames cross-fade; for a theme, the whole page cross-fades to the new colors.
 *
 * Script animations, not CSS transitions: a theme change switches every CSS
 * transition off for two frames (useDocumentTheme, KAN-22), so a transition
 * on the check or the frame would never run.
 */
const CHECK_FADE_MS = 120;
const CHECK_POP_MS = 200;
const FRAME_FADE_MS = 150;
const PAGE_FADE_MS = 250;

/** One tile's marker, as its pick turns it on or off. */
export function moveMarker(
  isOn: boolean,
  frame: HTMLElement | null,
  check: HTMLElement | null,
  colors: { line: string; ring: string }
): void {
  if (prefersReducedMotion()) return;
  if (check !== null && canAnimate(check)) {
    if (isOn) {
      check.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: CHECK_FADE_MS,
        easing: 'ease-out',
      });
      check.animate([{ transform: 'scale(0.5)' }, { transform: 'none' }], {
        duration: CHECK_POP_MS,
        easing: EASE.OUT,
      });
    } else {
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
  if (frame !== null && canAnimate(frame)) {
    const [from, to] = isOn
      ? [colors.line, colors.ring]
      : [colors.ring, colors.line];
    // The hover's colour transition would outrank this fade (transitions win
    // the cascade): off for the pick, set before the browser restyles the tile.
    frame.style.transition = 'none';
    const fade = frame.animate([{ borderColor: from }, { borderColor: to }], {
      duration: FRAME_FADE_MS,
      easing: 'ease-out',
    });
    const done = () => {
      if (frame.getAnimations().length === 0) frame.style.transition = '';
    };
    fade.addEventListener('finish', done);
    fade.addEventListener('cancel', done);
  }
}

let current = 0;

/** A theme pick: the page cross-fades to the new colors, dialog included. */
export function pickTheme(update: () => void): void {
  const start = document.startViewTransition?.bind(document);
  if (start === undefined || prefersReducedMotion()) {
    update();
    return;
  }
  const token = ++current;
  const root = document.documentElement;
  root.dataset.themePick = '';
  // flushSync: the browser pictures the new page as soon as this returns.
  const transition = start(() => flushSync(update));
  // A second pick mid-fade owns the flag now.
  void transition.finished.finally(() => {
    if (token === current) delete root.dataset.themePick;
  });
}

/** The page fade's CSS, for a <Global> in both views. */
export const pickMotionCss = `
  /* The full view pictures only its panes (paneMotion); a theme pick pictures the page as one. */
  html[data-theme-pick] { view-transition-name: root; }
  html[data-theme-pick] [data-pane] { view-transition-name: none; }
  html[data-theme-pick]::view-transition-old(root),
  html[data-theme-pick]::view-transition-new(root) {
    animation-duration: ${PAGE_FADE_MS}ms;
    animation-timing-function: ease-out;
  }
`;
