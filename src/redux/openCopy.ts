// KAN-815. A saved tab, group or window let go over Currently open opens a
// copy in Chrome: in the background at a slot of a live window, or in a new
// window in front (KAN-853). The saved session is never changed, so there is no toast
// and no Undo (as Open). Whether Chrome was asked is known at once, because
// the carry ends in the same call (RowDragArea's finish); whether it opened
// the copy comes later, and never throws.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { pickOf, sourceWindowOf } from './carriedItem';
import type { CarriedItem, CarriedPick } from './carriedItem';
import { expectNewWindow } from './newWindowFollow';
import { noteReviewMoment } from './reviewAsk';
import { whileMovingTabs } from './undoHistory';
import { toWindowSpec } from './slices/tabContainerDataStateSlice';
import type {
  tabData,
  windowGroupData,
} from './slices/tabContainerDataStateSlice';
import type { RootState } from './store';
import { openGroupCopy, openTabCopy } from '../utils/functions/openCopies';
import type {
  GroupCopySlot,
  TabCopySlot,
} from '../utils/functions/openNowMoves';
import { isSampleSession } from '../utils/functions/sampleSession';
import { RESTORE_SESSION_MESSAGE } from '../utils/functions/windows';
import type {
  RestoreSessionRequest,
  TabGroupSpec,
  WindowSpec,
} from '../utils/functions/windows';

type Thunk<R> = ThunkAction<R, RootState, unknown, UnknownAction>;

export type CopyPlace =
  | { kind: 'tab'; slot: TabCopySlot }
  | { kind: 'group'; slot: GroupCopySlot }
  | { kind: 'newWindow' };

// A split re-forms only from a whole window (Open's rule); a lone tab opens plain.
function unsplit(tab: tabData): tabData {
  const copy = { ...tab };
  delete copy.splitId;
  return copy;
}

// A group's tabs never open pinned: Chrome's groups hold none.
function unpinned(tab: tabData): tabData {
  const copy = unsplit(tab);
  delete copy.pinned;
  return copy;
}

function groupOf(
  window: windowGroupData,
  groupId: string
): { tabs: tabData[]; group: TabGroupSpec } | null {
  const look = window.chromeTabGroups?.find((g) => g.groupId === groupId);
  const tabs = window.tabs.filter((tab) => tab.chromeGroupId === groupId);
  if (!look || tabs.length === 0) return null;
  return {
    tabs,
    group: { groupId: look.groupId, title: look.title, color: look.color },
  };
}

// The new window a pick opens in: in front (KAN-853), and never a saved state
// (spec builder call 1). Null when the window no longer holds the tab or group.
export function copyWindowSpec(
  window: windowGroupData,
  pick: CarriedPick
): WindowSpec | null {
  const kind = window.incognito === true ? { incognito: true as const } : {};
  switch (pick.kind) {
    case 'tab': {
      const tab = window.tabs.find((t) => t.tabId === pick.tabId);
      if (!tab) return null;
      return { tabs: [unsplit(tab)], focused: true, bounds: null, ...kind };
    }
    case 'group': {
      const found = groupOf(window, pick.groupId);
      if (!found) return null;
      return {
        tabs: found.tabs.map(unpinned),
        groups: [found.group],
        focused: true,
        bounds: null,
        ...kind,
      };
    }
    case 'window': {
      const spec = toWindowSpec(window, true);
      delete spec.state;
      return spec;
    }
  }
}

// Null when Chrome was not asked; else whether it opened the copy. A new
// window's restore sends no answer, so it is taken as opened. A copy at a slot
// runs as Tab Keeper's own move (KAN-850): Open now reads it at once.
export const openCarriedCopy =
  (
    item: CarriedItem,
    place: CopyPlace,
    goToURLText: string
  ): Thunk<Promise<boolean> | null> =>
  (dispatch, getState) => {
    if (item.source !== 'saved') return null;
    const state = getState();
    const window = sourceWindowOf(state.tabContainerDataState.tabGroups, item);
    if (!window) return null;
    const pick = pickOf(item);

    // As every Open does (KAN-149), except for the sample (KAN-7).
    const noteRestore = () => {
      if (!isSampleSession(item.ref.tabGroupId)) {
        dispatch(noteReviewMoment({ kind: 'restored' }));
      }
    };

    // Whether Chrome opened anything at the slot.
    let opened: Promise<boolean>;
    if (place.kind === 'newWindow') {
      const spec = copyWindowSpec(window, pick);
      if (!spec) return null;
      const request: RestoreSessionRequest = {
        type: RESTORE_SESSION_MESSAGE,
        specs: [spec],
        goToURLText,
        closeOtherWindows: false,
        pinTabKeeper: state.settingsDataState.pinTabKeeperInNewWindows,
      };
      // The worker's restore sends no answer: counted when asked, as Open.
      noteRestore();
      expectNewWindow();
      void chrome.runtime.sendMessage(request);
      return Promise.resolve(true);
    } else if (place.kind === 'tab' && pick.kind === 'tab') {
      const tab = window.tabs.find((t) => t.tabId === pick.tabId);
      if (!tab) return null;
      opened = whileMovingTabs(() =>
        openTabCopy(unsplit(tab), place.slot)
      ).then((id) => id !== undefined);
    } else if (place.kind === 'group' && pick.kind === 'group') {
      const found = groupOf(window, pick.groupId);
      if (!found) return null;
      opened = whileMovingTabs(() =>
        openGroupCopy(found.tabs, found.group, place.slot, goToURLText)
      ).then((ids) => ids.some((id) => id !== undefined));
    } else {
      return null;
    }

    // A window closed mid-carry refuses every tab, and is no restore.
    return opened.then((any) => {
      if (any) noteRestore();
      return any;
    });
  };
