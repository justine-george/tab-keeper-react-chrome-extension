import type { OpenSavedWindowsIn } from '../../redux/slices/settingsDataStateSlice';
import type { IconName } from '../common/iconNames';

// KAN-892. What Open says, and what the ⋮ menus offer, for each way Open saved windows can go.

// The way the setting did not pick: the ⋮ menus' item.
export const otherWay = (w: OpenSavedWindowsIn): OpenSavedWindowsIn =>
  w === 'this-window' ? 'new-window' : 'this-window';

// Spec 7. A saved window of the other kind than this window opens in its
// own new window whichever way is picked: Open says so, and no other way is
// offered. `opensApart` is false while the kinds are unknown.
export const savedWindowOpenWays = (
  chosen: OpenSavedWindowsIn,
  opensApart: boolean
): { open: OpenSavedWindowsIn; other: OpenSavedWindowsIn | null } =>
  opensApart
    ? { open: 'new-window', other: null }
    : { open: chosen, other: otherWay(chosen) };

export const windowOpenLabelKey = (
  w: OpenSavedWindowsIn
): 'Open in new window' | 'Open in this window' =>
  w === 'this-window' ? 'Open in this window' : 'Open in new window';

export const sessionOpenLabelKey = (
  w: OpenSavedWindowsIn
): 'Open session' | 'Open session in this window' =>
  w === 'this-window' ? 'Open session in this window' : 'Open session';

// The session menus' other-way item: shorter than Open's tooltip, so the header ⋮ fits its pane (KAN-193, R10).
export const sessionMenuOpenLabelKey = (
  w: OpenSavedWindowsIn
): 'Open session in new windows' | 'Open session in this window' =>
  w === 'this-window'
    ? 'Open session in this window'
    : 'Open session in new windows';

// A menu item's glyph for that way; new window keeps the Open button's.
export const openWayIcon = (w: OpenSavedWindowsIn): IconName =>
  w === 'this-window' ? 'tab' : 'reopen_window';
