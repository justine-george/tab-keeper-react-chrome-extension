// KAN-321 O1/O1a and KAN-687. Every width in the tab view's grid: the saved
// list's and Open now's, from the window's width, the fold and the widths
// the user chose. The grid, both grips' aria values and their arrow keys all
// read these, so what is drawn and what a screen reader hears cannot
// disagree. The saved session (side by side) or Open now (folded) takes the
// rest.

// Today's list width, and its narrowest: the popup's 45% of 790px.
const LIST_MIN_WIDTH = 356;
// KAN-687 comment 11079: the widest a drag takes the list.
const LIST_MAX_WIDTH = 600;
// KAN-687 comment 11082: the list starts at a quarter of the window, never
// over 520, so even the widest window leaves the drag room to widen it.
const LIST_DEFAULT_SHARE = 0.25;
const LIST_DEFAULT_MAX = 520;
// The panes right of the list keep at least this much: the saved session
// through each grip's max, Open now through its min. Where the window cannot
// give both of them this (1316px and narrower), Open now stays at its default.
const PANE_MIN_WIDTH = 480;
// Open now's narrowest default. The even split alone would go under it
// between 1100 and 1176px, because the saved session's 480px caps it there.
const OPEN_NOW_DEFAULT_FLOOR = 340;
// Below this the full view is the rail or the drawer, and the list is 356.
// The same 1100px as OPEN_NOW_RAIL_QUERY.
const RESIZABLE_MIN_VIEWPORT = 1100;

export const RESIZE_KEY_STEP = 16;

export interface WidthRange {
  min: number;
  max: number;
}

export interface PaneWidths {
  list: number;
  listRange: WidthRange;
  openNow: number;
  openNowRange: WidthRange;
}

// What the user dragged each pane to, or null for its default.
export interface ChosenWidths {
  list: number | null;
  openNow: number | null;
}

// Any width, as a whole px inside a range. The one clamp: a shown width, a
// drag's live width and the arrow keys all go through it.
export function clampToRange(width: number, { min, max }: WidthRange): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function defaultListWidth(viewportWidth: number): number {
  return clampToRange(viewportWidth * LIST_DEFAULT_SHARE, {
    min: LIST_MIN_WIDTH,
    max: LIST_DEFAULT_MAX,
  });
}

// D1: an even split of what the list's default leaves, unless that would
// leave the saved session under 480px; never under 340. Read from the list's
// default, not its shown width, so a list drag does not move Open now.
export function defaultOpenNowWidth(viewportWidth: number): number {
  const rest = viewportWidth - defaultListWidth(viewportWidth);
  return Math.max(
    OPEN_NOW_DEFAULT_FLOOR,
    Math.min(Math.floor(rest / 2), rest - PANE_MIN_WIDTH)
  );
}

// L1: Open now keeps 480, unless its default is narrower, and leaves the
// saved session 480 beside a list this wide. Never an inverted range.
function openNowRange(viewportWidth: number, listWidth: number): WidthRange {
  const min = Math.min(PANE_MIN_WIDTH, defaultOpenNowWidth(viewportWidth));
  return {
    min,
    max: Math.max(min, viewportWidth - listWidth - PANE_MIN_WIDTH),
  };
}

// The list leaves the pane beside it 480: the saved session beside this
// Open now, or folded (null) Open now itself.
function listRange(
  viewportWidth: number,
  openNowWidth: number | null
): WidthRange {
  const beside = openNowWidth === null ? 0 : openNowWidth;
  return {
    min: LIST_MIN_WIDTH,
    max: Math.max(
      LIST_MIN_WIDTH,
      Math.min(LIST_MAX_WIDTH, viewportWidth - beside - PANE_MIN_WIDTH)
    ),
  };
}

// Open now resolves first, inside its range beside the narrowest list; the
// list then takes what that leaves. So where both chosen widths no longer
// fit, Open now keeps its width and the list gives way, and Open now's
// range beside the shown list always holds the width it already has: a
// width saved at the end of either range shows again unchanged.
export function paneWidths(
  viewportWidth: number,
  folded: boolean,
  chosen: ChosenWidths
): PaneWidths {
  const openNow = clampToRange(
    chosen.openNow ?? defaultOpenNowWidth(viewportWidth),
    openNowRange(viewportWidth, LIST_MIN_WIDTH)
  );
  const lists =
    viewportWidth < RESIZABLE_MIN_VIEWPORT
      ? { min: LIST_MIN_WIDTH, max: LIST_MIN_WIDTH }
      : listRange(viewportWidth, folded ? null : openNow);
  const list = clampToRange(
    chosen.list ?? defaultListWidth(viewportWidth),
    lists
  );
  return {
    list,
    listRange: lists,
    openNow,
    // Folded, Open now fills the saved session's column and its own width
    // waits, unchanged, for the unfold: no list width bounds it.
    openNowRange: openNowRange(viewportWidth, folded ? LIST_MIN_WIDTH : list),
  };
}

// Whether the window leaves Open now a range to drag through beside the
// narrowest list: only then is there a grip (above 1316px).
export function isOpenNowResizable(viewportWidth: number): boolean {
  const { min, max } = openNowRange(viewportWidth, LIST_MIN_WIDTH);
  return min < max;
}

// The same for the list, with Open now at its narrowest. Read from the
// window alone, so the grip does not come and go while Open now's is dragged.
export function isListResizable(
  viewportWidth: number,
  folded: boolean
): boolean {
  if (viewportWidth < RESIZABLE_MIN_VIEWPORT) return false;
  const beside = folded
    ? null
    : openNowRange(viewportWidth, LIST_MIN_WIDTH).min;
  const { min, max } = listRange(viewportWidth, beside);
  return min < max;
}
