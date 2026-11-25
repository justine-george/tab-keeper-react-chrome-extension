import type { IconName } from '../../common/iconNames';

// The glyph of what shows or folds the saved session: its card while folded,
// Currently open's fold button while not. The run's card names them too.
export const FOLD_ICON = {
  // KAN-999 (his pick I4): folded, the saved session's card wears a folder.
  folded: 'folder',
  // KAN-1000 (his pick B2): « points at the saved session it pushes aside.
  unfolded: 'keyboard_double_arrow_left',
} as const satisfies Record<'folded' | 'unfolded', IconName>;

// KAN-1000 (his pick B2). The saved session's button that folds Open now:
// » points at Open now; folded, « brings it back.
export const OPEN_NOW_FOLD_ICON = {
  folded: 'keyboard_double_arrow_left',
  unfolded: 'keyboard_double_arrow_right',
} as const satisfies Record<'folded' | 'unfolded', IconName>;
