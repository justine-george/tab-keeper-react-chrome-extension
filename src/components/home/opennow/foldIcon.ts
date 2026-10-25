import type { IconName } from '../../common/iconNames';

// The fold button's glyph in each state, read by the button and by the run's card that names it.
export const FOLD_ICON = {
  // KAN-794 (his pick B): a panel, so it reads as the layout, not as back.
  folded: 'left_panel_open',
  unfolded: 'left_panel_close',
} as const satisfies Record<'folded' | 'unfolded', IconName>;
