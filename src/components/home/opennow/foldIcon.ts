import type { IconName } from '../../common/iconNames';

// The fold button's glyph in each state, read by the button and by the run's card that names it.
export const FOLD_ICON = {
  folded: 'keyboard_double_arrow_right',
  unfolded: 'keyboard_double_arrow_left',
} as const satisfies Record<'folded' | 'unfolded', IconName>;
