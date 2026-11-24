// KAN-280 O2. Below 1100px wide, side by side, Open now's column is the
// 44px rail. MainContainer's grid sizes the column from this query and
// OpenNowColumn picks the rail from it, so the track and what fills it
// cannot disagree.
export const OPEN_NOW_RAIL_QUERY = '(max-width: 1099px)';

// KAN-999. A rail is an outlined card this wide: Currently open's, and the
// folded saved session's.
export const RAIL_CARD_PX = 44;

// The rail's column: below 1100px, and folded by the saved session's button (KAN-808).
export const OPEN_NOW_RAIL_PX = 44;

// KAN-999. The folded saved session's column: its card and the 8px gap to
// Currently open (the list's own padding is the gap on its left).
export const SAVED_CARD_COLUMN_PX = 52;
