import type { IconName } from '../../common/iconNames';

// The glyph of what shows or folds the saved session: its card while folded,
// Currently open's fold button while not. The run's card names them too.
export const FOLD_ICON = {
  // KAN-999 (his pick I4): folded, the saved session's card wears a folder.
  // KAN-794 (his pick B): unfolded, a panel, so it reads as the layout.
  folded: 'folder',
  unfolded: 'left_panel_close',
} as const satisfies Record<'folded' | 'unfolded', IconName>;

// KAN-808 (his pick B). The saved session's button that folds Open now: the
// same panel, mirrored, so the two fold buttons read as a pair.
export const OPEN_NOW_FOLD_ICON = {
  folded: 'right_panel_open',
  unfolded: 'right_panel_close',
} as const satisfies Record<'folded' | 'unfolded', IconName>;
