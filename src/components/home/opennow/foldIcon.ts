import type { IconName } from '../../common/iconNames';

// KAN-999 (his pick I4): folded, the saved session's card wears a folder.
// The run's card names it too.
export const SAVED_CARD_ICON = 'folder' as const satisfies IconName;

// KAN-1000 (his pick B2). Each header's button points at the pane it pushes
// aside. Currently open's folds the saved session: « points at it; folded,
// » brings it back.
export const SAVED_FOLD_ICON = {
  folded: 'keyboard_double_arrow_right',
  unfolded: 'keyboard_double_arrow_left',
} as const satisfies Record<'folded' | 'unfolded', IconName>;

// The saved session's button that folds Open now: » points at Open now;
// folded, « brings it back.
export const OPEN_NOW_FOLD_ICON = {
  folded: 'keyboard_double_arrow_left',
  unfolded: 'keyboard_double_arrow_right',
} as const satisfies Record<'folded' | 'unfolded', IconName>;
