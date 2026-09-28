// KAN-321 O1/O1a. Every Open now width number, for a viewport of a given
// width. The grid, the grip's aria values and its arrow keys all read these,
// so what is drawn and what a screen reader hears cannot disagree.
//
// Side by side only (>= 1100px, not folded): the rail and the drawer (O2)
// have their own fixed widths and never call this.

const LIST_WIDTH = 356;
const SAVED_MIN_WIDTH = 480;
// Today's narrowest default. The even split alone would go under it between
// 1100 and 1176px, because the saved session's 480px caps it there.
const DEFAULT_FLOOR = 340;

export const OPEN_NOW_MIN_WIDTH = 300;
export const OPEN_NOW_KEY_STEP = 16;

// The widest Open now can be while the saved session keeps its 480px.
const savedSessionCap = (viewportWidth: number): number =>
  viewportWidth - LIST_WIDTH - SAVED_MIN_WIDTH;

// D1: an even split of the space right of the list, unless that would leave
// the saved session under 480px; never under today's 340.
export function defaultOpenNowWidth(viewportWidth: number): number {
  const evenSplit = Math.floor((viewportWidth - LIST_WIDTH) / 2);
  return Math.max(
    DEFAULT_FLOOR,
    Math.min(evenSplit, savedSessionCap(viewportWidth))
  );
}

// L1. The max is never below the default, so the default is always a width
// the drag can reach; below 1176px that makes the range 300..340.
export function openNowWidthLimits(viewportWidth: number): {
  min: number;
  max: number;
} {
  return {
    min: OPEN_NOW_MIN_WIDTH,
    max: Math.max(
      defaultOpenNowWidth(viewportWidth),
      savedSessionCap(viewportWidth)
    ),
  };
}

// What the column is drawn at: the stored choice (or the default), clamped to
// this window's limits. The stored value itself is never rewritten here.
export function shownOpenNowWidth(
  stored: number | null,
  viewportWidth: number
): number {
  const { min, max } = openNowWidthLimits(viewportWidth);
  const wanted = stored ?? defaultOpenNowWidth(viewportWidth);
  return Math.min(max, Math.max(min, Math.round(wanted)));
}
