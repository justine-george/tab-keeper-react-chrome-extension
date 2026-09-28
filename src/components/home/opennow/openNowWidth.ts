// KAN-321 O1/O1a. Every Open now width number, for a viewport of a given
// width. The grid, the grip's aria values and its arrow keys all read these,
// so what is drawn and what a screen reader hears cannot disagree.
//
// The numbers mean something side by side only (>= 1100px, not folded).
// MainContainer still computes the width on every tab-view render, at any
// width; below 1100px the rail's media query (O2) and folded the 0 track (O4)
// override it, so there it is computed and never drawn.

const LIST_WIDTH = 356;
// Both panes right of the list, the saved session and Open now, keep at least
// this much: the saved session through the max, Open now through the min.
// Where the window cannot give both of them this (1316px and narrower), the
// range is empty and Open now stays at its default.
const PANE_MIN_WIDTH = 480;
// Today's narrowest default. The even split alone would go under it between
// 1100 and 1176px, because the saved session's 480px caps it there.
const DEFAULT_FLOOR = 340;

export const OPEN_NOW_KEY_STEP = 16;

// The widest Open now can be while the saved session keeps its 480px.
const savedSessionCap = (viewportWidth: number): number =>
  viewportWidth - LIST_WIDTH - PANE_MIN_WIDTH;

// D1: an even split of the space right of the list, unless that would leave
// the saved session under 480px; never under today's 340.
export function defaultOpenNowWidth(viewportWidth: number): number {
  const evenSplit = Math.floor((viewportWidth - LIST_WIDTH) / 2);
  return Math.max(
    DEFAULT_FLOOR,
    Math.min(evenSplit, savedSessionCap(viewportWidth))
  );
}

// L1. Both panes keep 480px: the min is 480 and the max leaves the saved
// session 480. Neither ever crosses the default -- the min is never above
// it, the max never below it -- so the default is always a width the drag
// can reach. At 1316px and narrower that makes min = max = the default: an
// empty range (isOpenNowResizable).
export function openNowWidthLimits(viewportWidth: number): {
  min: number;
  max: number;
} {
  const defaultWidth = defaultOpenNowWidth(viewportWidth);
  return {
    min: Math.min(PANE_MIN_WIDTH, defaultWidth),
    max: Math.max(defaultWidth, savedSessionCap(viewportWidth)),
  };
}

// Whether this window leaves a range to drag through: only then is there a
// grip (MainContainer). Where it doesn't, every width shows as the default.
export function isOpenNowResizable(viewportWidth: number): boolean {
  const { min, max } = openNowWidthLimits(viewportWidth);
  return min < max;
}

// Any width, as a whole px inside this window's limits. The one clamp: the
// shown width, a drag's live width and the arrow keys all go through it.
export function clampOpenNowWidth(
  width: number,
  viewportWidth: number
): number {
  const { min, max } = openNowWidthLimits(viewportWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}

// What the column is drawn at: the width the user chose -- stored, or a
// drag's live width -- or the default when there is neither, clamped to this
// window's limits. Never rewrites what it's given.
export function shownOpenNowWidth(
  chosen: number | null,
  viewportWidth: number
): number {
  return clampOpenNowWidth(
    chosen ?? defaultOpenNowWidth(viewportWidth),
    viewportWidth
  );
}
