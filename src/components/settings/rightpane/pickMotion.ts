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
 * the new colors; for a language, to the new words with a soft blur.
 *
 * Script animations, not CSS transitions: a theme change switches every CSS
 * transition off for two frames (useDocumentTheme, KAN-22), so a transition
 * on the check would never run.
 */
const CHECK_FADE_MS = 120;
const CHECK_POP_MS = 200;
const PAGE_FADE_MS = 250;
// The words' soft blur, as a button swaps its two labels (Button's faceStyle).
const WORDS_BLUR_PX = 2;
// The longest the old page waits for the new language to be drawn.
const LANGUAGE_WAIT_MS = 500;

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

type PageFade = 'theme' | 'language';
let latestFade = 0;

// The change runs inside a view transition that pictures the whole page,
// flagged on <html> with its kind while it runs.
function fadePage(kind: PageFade, update: () => void | Promise<void>): void {
  const start = document.startViewTransition?.bind(document);
  if (start === undefined || prefersReducedMotion()) {
    void update();
    return;
  }
  const token = ++latestFade;
  const root = document.documentElement;
  root.dataset.pageFade = kind;
  const transition = start(update);
  // A second pick mid-fade owns the flag now.
  void transition.finished.finally(() => {
    if (token === latestFade) delete root.dataset.pageFade;
  });
}

/** A theme pick: the page cross-fades to the new colors, dialog included. */
export function pickTheme(update: () => void): void {
  // flushSync: the browser pictures the new page as soon as this returns.
  fadePage('theme', () => flushSync(update));
}

let shown: { language: string; resolve: () => void }[] = [];

/** The page has drawn `language`: a language pick waiting on it may go on. */
export function noteLanguageShown(language: string): void {
  const ready = shown.filter((w) => w.language === language);
  shown = shown.filter((w) => w.language !== language);
  for (const w of ready) w.resolve();
}

const languageShown = (language: string): Promise<void> =>
  new Promise((resolve) => {
    shown.push({ language, resolve });
    // Never hold the old page longer than this, drawn or not.
    setTimeout(resolve, LANGUAGE_WAIT_MS);
  });

/**
 * A language pick: the old page stays up until the new words are drawn, then
 * blurs over to them while the new cell's check pops in. The current language
 * picked again moves nothing.
 */
export function pickLanguage(
  cells: HTMLElement | null,
  language: string,
  from: string,
  choose: () => Promise<unknown>
): void {
  if (language === from) {
    void choose();
    return;
  }
  fadePage('language', async () => {
    // Listening first: the page can draw the new words before choose settles.
    const drawn = languageShown(language);
    await choose();
    await drawn;
    if (prefersReducedMotion()) return;
    const check = cells?.querySelector<HTMLElement>(
      '[aria-pressed="true"] > div[aria-hidden="true"]'
    );
    if (check && canAnimate(check)) popIn(check);
  });
}

/** The page fade's CSS, for a <Global> in both views. */
export const pickMotionCss = `
  /* The full view pictures only its panes (paneMotion); a pick pictures the page as one. */
  html[data-page-fade] { view-transition-name: root; }
  html[data-page-fade] [data-pane] { view-transition-name: none; }
  html[data-page-fade]::view-transition-old(root),
  html[data-page-fade]::view-transition-new(root) {
    animation-duration: ${PAGE_FADE_MS}ms;
    animation-timing-function: ease-out;
    animation-fill-mode: both;
  }
  html[data-page-fade='language']::view-transition-old(root) { animation-name: page-blur-out; }
  html[data-page-fade='language']::view-transition-new(root) { animation-name: page-blur-in; }
  @keyframes page-blur-out { to { opacity: 0; filter: blur(${WORDS_BLUR_PX}px); } }
  @keyframes page-blur-in { from { opacity: 0; filter: blur(${WORDS_BLUR_PX}px); } }
`;
