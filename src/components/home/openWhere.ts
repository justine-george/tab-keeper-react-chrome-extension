import type { OpenSavedWindowsIn } from '../../redux/slices/settingsDataStateSlice';
import type { IconName } from '../common/iconNames';

// KAN-892. What Open says, and what the ⋮ menus offer, for each way Open saved windows can go.

// The way the setting did not pick: the ⋮ menus' item.
export const otherWay = (w: OpenSavedWindowsIn): OpenSavedWindowsIn =>
  w === 'this-window' ? 'new-window' : 'this-window';

export const windowOpenLabelKey = (
  w: OpenSavedWindowsIn
): 'Open in new window' | 'Open in this window' =>
  w === 'this-window' ? 'Open in this window' : 'Open in new window';

export const sessionOpenLabelKey = (
  w: OpenSavedWindowsIn
): 'Open session' | 'Open session in this window' =>
  w === 'this-window' ? 'Open session in this window' : 'Open session';

// A menu item's glyph for that way; new window keeps the Open button's.
export const openWayIcon = (w: OpenSavedWindowsIn): IconName =>
  w === 'this-window' ? 'tab' : 'reopen_window';
