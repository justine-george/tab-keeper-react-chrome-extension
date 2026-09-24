// KAN-280 O2. Below 1100px wide, side by side, Open now's column is the
// 44px rail. MainContainer's grid sizes the column from this query and
// OpenNowColumn picks the rail from it, so the track and what fills it
// cannot disagree.
export const OPEN_NOW_RAIL_QUERY = '(max-width: 1099px)';
