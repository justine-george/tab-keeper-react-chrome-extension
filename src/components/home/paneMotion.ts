import { flushSync } from 'react-dom';

import { PANE_SIDE } from '../../styles/paneInset';
import { DURATION, EASE } from '../../styles/scale';

// KAN-810 (his pick B, refined over 8 rounds). The tab view's folds and the
// rail's drawer move, so you can see where a pane went, instead of swapping:
//
// - Currently open folds to its rail (KAN-808's button) by riding the saved
//   session's growing edge out of the window; it comes back the same way.
// - The saved session folds (Currently open's button) by holding still and
//   fading while Currently open slides over it; it comes back the same way.
//   From the open drawer, the drawer itself widens into the column.
// (The drawer slides in and out on itself, in OpenNowRail: a press while it
// moves still lands, which a transition would not allow.)
//
// Durations are scale.ts's: FOLD for a fold, HANDOFF for the fades inside it.
//
// Same-document View Transitions: the browser pictures the page before and
// after the change, and the CSS below moves those pictures. Each pane is one
// picture, so whatever sits at its right edge, or differs between its two
// layouts, needs a rule of its own, or it pops at the start or the end.
// Every rule here answers one such pop.

export type PaneMotionKind = 'openNow' | 'saved';
export type PaneMotionDirection = 'fold' | 'unfold';

const { FOLD, HANDOFF } = DURATION;
const MOVE = `${FOLD} ${EASE.IN_OUT}`;
// The last two hand-offs of a fold, and the first two of an unfold.
const LAST = `calc(${FOLD} - ${HANDOFF})`;
const NEXT_TO_LAST = `calc(${FOLD} - 2 * ${HANDOFF})`;
// A pane's box borders, kept by a strip of its other picture that rides its edge.
const STRIP = '10px';

// The latest motion's token: a press during a motion skips the first, whose
// end must not clear the second's attributes.
let current = 0;

// KAN-812. A tour card on screen, placed: none of this motion while it is
// (his call). The panes' pictures would paint over the card and its dim.
export const COACH_CARD_SHOWN = '[data-coach-mark]:not([aria-hidden])';

/**
 * Runs `update`, the React state change that folds or unfolds a pane, as a
 * view transition of `kind`. Instant where there is no API (jsdom), the
 * user asked for reduced motion, or a tour card is on screen: `update` runs
 * synchronously, as it would without this.
 */
export function runPaneMotion(
  update: () => void,
  kind: PaneMotionKind,
  direction: PaneMotionDirection
): void {
  const start = document.startViewTransition?.bind(document);
  if (
    start === undefined ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.querySelector(COACH_CARD_SHOWN) !== null
  ) {
    update();
    return;
  }
  const token = ++current;
  const root = document.documentElement;
  root.dataset.paneMove = kind;
  root.dataset.paneMoveDir = direction;
  // An open drawer, not one already sliding out.
  if (
    kind === 'saved' &&
    document.querySelector('[data-pane-layer="drawer"]:not([data-leaving])')
  )
    root.dataset.paneMoveFrom = 'drawer';
  else delete root.dataset.paneMoveFrom;
  // flushSync: the browser pictures the new page as soon as this returns.
  const transition = start(() => flushSync(update));
  void transition.finished.finally(() => {
    if (token !== current) return;
    delete root.dataset.paneMove;
    delete root.dataset.paneMoveDir;
    delete root.dataset.paneMoveFrom;
  });
}

const on = (kind: PaneMotionKind, direction?: PaneMotionDirection) =>
  `html[data-pane-move='${kind}']${
    direction ? `[data-pane-move-dir='${direction}']` : ''
  }`;

/** The motions' CSS, for a <Global> in the tab view. */
export const paneMotionCss = `
  [data-pane='detail'] { view-transition-name: pane-detail; }
  [data-pane='open-now'] { view-transition-name: pane-open-now; }
  /* From the open drawer, the drawer is Currently open: it widens into the column. */
  html[data-pane-move-from='drawer'] [data-pane-layer='drawer'] { view-transition-name: pane-open-now; }
  html[data-pane-move-from='drawer'] [data-pane='open-now']:has([data-pane-layer='drawer']) { view-transition-name: none; }

  /* Controls at a moving edge ride it, each its own layer. */
  ${on('openNow')} [data-pane-layer='saved-title-action'] { view-transition-name: pane-saved-title-action; }
  ${on('openNow')} [data-pane-layer='saved-add-window'] { view-transition-name: pane-saved-add-window; }
  ${on('saved')} [data-pane='open-now'] [data-pane-layer='open-now-fold'] { view-transition-name: pane-open-now-fold; }
  ${on('saved')} [data-pane='open-now'] [data-pane-layer='open-now-back'] { view-transition-name: pane-open-now-back; }
  ${on('saved')} [data-pane-layer='open-now-close'] { view-transition-name: pane-open-now-close; }
  /* The / chip moves between the two search fields with the press. */
  ${on('saved')} [data-pane='open-now'] [data-pane-layer='search-chip'] { view-transition-name: pane-open-now-chip; }
  ${on('saved')} [data-pane='sessions'] [data-pane-layer='search-chip'] { view-transition-name: pane-sessions-chip; }
  /* Currently open's resize grip leaves as a move starts and comes back once its pane has. */
  html[data-pane-move] [data-resize-grip] { view-transition-name: pane-open-now-grip; }

  /* Presses pass through to the live page underneath, already in its final state. */
  ::view-transition { pointer-events: none; }
  /* Only the panes are pictured; the rest of the page stays live, so a press on the session list lands mid-move. */
  :root { view-transition-name: none; }
  ::view-transition-group(*) { animation-duration: ${FOLD}; animation-timing-function: ${EASE.IN_OUT}; }
  ::view-transition-group(pane-detail), ::view-transition-group(pane-open-now) { overflow: clip; }
  ::view-transition-old(pane-detail), ::view-transition-new(pane-detail),
  ::view-transition-old(pane-open-now), ::view-transition-new(pane-open-now) {
    width: 100%; height: 100%; object-fit: none; object-position: left top; animation: none; mix-blend-mode: normal;
  }

  /* An explicit stack: a layer that exists only after the change would otherwise land on top. */
  ${on('saved')}::view-transition-group(pane-open-now) { z-index: 1; background: var(--app-background); }
  ::view-transition-group(pane-saved-title-action), ::view-transition-group(pane-saved-add-window),
  ::view-transition-group(pane-open-now-fold), ::view-transition-group(pane-open-now-back),
  ::view-transition-group(pane-open-now-close), ::view-transition-group(pane-open-now-chip),
  ::view-transition-group(pane-sessions-chip),
  ::view-transition-group(pane-open-now-grip) { z-index: 2; }

  /* Folding Currently open. The saved session grows: its new picture is revealed as its box widens. */
  ${on('openNow', 'fold')}::view-transition-old(pane-detail),
  ${on('openNow', 'unfold')}::view-transition-new(pane-detail) {
    opacity: 1; z-index: 1; mask-image: linear-gradient(to left, #000 ${STRIP}, transparent ${STRIP});
  }
  /* Its right edge: a strip of its other picture rides the edge. Beside the rail the
     session sits ${PANE_SIDE} in from its column's edge, beside Currently open flush, so
     the strip slides that far, and the sliver it leaves is page, not pane. */
  ${on('openNow')}::view-transition-group(pane-detail) { background: var(--app-background); }
  ${on('openNow', 'fold')}::view-transition-old(pane-detail) { animation: pane-edge-in ${MOVE} both; }
  ${on('openNow', 'unfold')}::view-transition-new(pane-detail) { animation: pane-edge-out ${MOVE} both; }
  ${on('openNow', 'fold')}::view-transition-new(pane-detail) {
    mask-image: linear-gradient(to left, transparent var(--pane-edge), #000 var(--pane-edge));
    animation: pane-edge-mask-in ${MOVE} both;
  }
  ${on('openNow', 'unfold')}::view-transition-old(pane-detail) {
    mask-image: linear-gradient(to left, transparent var(--pane-edge), #000 var(--pane-edge));
    animation: pane-edge-mask-out ${MOVE} both;
  }
  /* Currently open rides the edge out of the window and fades there; then the rail appears where it lives. */
  ${on('openNow', 'fold')}::view-transition-old(pane-open-now) { animation: pane-fade-out ${HANDOFF} ${NEXT_TO_LAST} ease-in both; }
  ${on('openNow', 'fold')}::view-transition-new(pane-open-now) { object-position: right top; animation: pane-fade-in ${HANDOFF} ${LAST} ease-out both; }
  /* The reverse: the rail fades where it lives, then Currently open fades in as it slides out. */
  ${on('openNow', 'unfold')}::view-transition-old(pane-open-now) { object-position: right top; animation: pane-fade-out ${HANDOFF} ease-out both; }
  ${on('openNow', 'unfold')}::view-transition-new(pane-open-now) { animation: pane-fade-in ${HANDOFF} ${HANDOFF} ease-out both; }

  /* Folding the saved session. It holds still and fades while an opaque Currently open slides over it. */
  ${on('saved', 'fold')}::view-transition-old(pane-detail) { animation: pane-fade-out ${FOLD} ${EASE.IN} both; }
  ${on('saved', 'unfold')}::view-transition-new(pane-detail) { animation: pane-fade-in ${FOLD} ${EASE.OUT} both; }
  /* Folded, Currently open has no left padding; beside the session it keeps ${PANE_SIDE}. Its content slides that far. */
  ${on('saved', 'fold')}::view-transition-new(pane-open-now) { animation: pane-left-out ${MOVE} both; }
  ${on('saved', 'unfold')}::view-transition-old(pane-open-now) { animation: pane-left-in ${MOVE} both; }
  /* Its right edge, at the window's, from a strip of its other picture. */
  ${on('saved', 'fold')}::view-transition-old(pane-open-now),
  ${on('saved', 'unfold')}::view-transition-new(pane-open-now) {
    z-index: 1; object-position: right top; mask-image: linear-gradient(to left, #000 ${STRIP}, transparent ${STRIP}); animation: none;
  }

  /* Its close button has no place in the column it widens into. */
  ::view-transition-old(pane-open-now-close):only-child { animation: pane-fade-out ${HANDOFF} ease-out both; }
  ::view-transition-old(pane-open-now-grip) { animation: pane-fade-out ${HANDOFF} ease-out both; }
  ::view-transition-new(pane-open-now-grip) { animation: pane-fade-in ${HANDOFF} ${LAST} ease-out both; }

  @property --pane-edge { syntax: '<length>'; inherits: false; initial-value: 0px; }
  /* Four-value positions: object-position drops the three-value form, and the keyframes with it. */
  @keyframes pane-edge-in { from { object-position: right 0px top 0px; } to { object-position: right ${PANE_SIDE} top 0px; } }
  @keyframes pane-edge-out { from { object-position: right ${PANE_SIDE} top 0px; } to { object-position: right 0px top 0px; } }
  @keyframes pane-edge-mask-in { from { --pane-edge: 0px; } to { --pane-edge: ${PANE_SIDE}; } }
  @keyframes pane-edge-mask-out { from { --pane-edge: ${PANE_SIDE}; } to { --pane-edge: 0px; } }
  @keyframes pane-left-out { from { object-position: ${PANE_SIDE} 0px; } to { object-position: 0px 0px; } }
  @keyframes pane-left-in { from { object-position: 0px 0px; } to { object-position: ${PANE_SIDE} 0px; } }
  @keyframes pane-fade-out { to { opacity: 0; } }
  @keyframes pane-fade-in { from { opacity: 0; } }
`;
