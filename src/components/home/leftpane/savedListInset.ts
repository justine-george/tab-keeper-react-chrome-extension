import { ICON } from '../../../styles/scale';

// The search glyph's ink starts 3/24 into its box and ends 21/24 in (Material Symbols "search").
export const SAVED_SEARCH_GLASS_INSET = `calc(8px - ${ICON.SMALL} * 3 / 24)`;
// Ink right edge + 10px: where the search text and every session title start.
export const SAVED_TEXT_INSET = `calc(8px + ${ICON.SMALL} * 18 / 24 + 10px)`;
export const SAVED_SEARCH_TEXT_PADDING = `calc(10px - ${ICON.SMALL} * 3 / 24)`;
