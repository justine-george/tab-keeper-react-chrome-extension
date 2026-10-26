// KAN-815. A saved tab, group or window let go over Currently open opens a
// copy in Chrome, in the background: at a slot of a live window, or in a new
// unfocused window. The saved session is never changed, so there is no toast
// and no Undo (as Open). The answer is synchronous -- whether Chrome was asked
// -- because the carry ends in the same call (RowDragArea's finish); the
// Chrome work runs after it returns and never throws.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { pickOf, sourceWindowOf } from './carriedItem';
import type { CarriedItem, CarriedPick } from './carriedItem';
import { noteReviewMoment } from './reviewAsk';
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

// The new window a pick opens in: unfocused, and never a saved state, which
// windows.update applies after create and can take focus (spec builder call
// 1). Null when the window no longer holds the tab or group.
export function copyWindowSpec(
  window: windowGroupData,
  pick: CarriedPick
): WindowSpec | null {
  const kind = window.incognito === true ? { incognito: true as const } : {};
  switch (pick.kind) {
    case 'tab': {
      const tab = window.tabs.find((t) => t.tabId === pick.tabId);
      if (!tab) return null;
      return { tabs: [unsplit(tab)], focused: false, bounds: null, ...kind };
    }
    case 'group': {
      const found = groupOf(window, pick.groupId);
      if (!found) return null;
      return {
        tabs: found.tabs.map(unpinned),
        groups: [found.group],
        focused: false,
        bounds: null,
        ...kind,
      };
    }
    case 'window': {
      const spec = toWindowSpec(window, false);
      delete spec.state;
      return spec;
    }
  }
}

export const openCarriedCopy =
  (item: CarriedItem, place: CopyPlace, goToURLText: string): Thunk<boolean> =>
  (dispatch, getState) => {
    if (item.source !== 'saved') return false;
    const state = getState();
    const window = sourceWindowOf(state.tabContainerDataState.tabGroups, item);
    if (!window) return false;
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
      if (!spec) return false;
      const request: RestoreSessionRequest = {
        type: RESTORE_SESSION_MESSAGE,
        specs: [spec],
        goToURLText,
        closeOtherWindows: false,
        pinTabKeeper: state.settingsDataState.pinTabKeeperInNewWindows,
      };
      // The worker's restore sends no answer: counted when asked, as Open.
      noteRestore();
      void chrome.runtime.sendMessage(request);
      return true;
    } else if (place.kind === 'tab' && pick.kind === 'tab') {
      const tab = window.tabs.find((t) => t.tabId === pick.tabId);
      if (!tab) return false;
      opened = openTabCopy(unsplit(tab), place.slot).then(
        (id) => id !== undefined
      );
    } else if (place.kind === 'group' && pick.kind === 'group') {
      const found = groupOf(window, pick.groupId);
      if (!found) return false;
      opened = openGroupCopy(
        found.tabs,
        found.group,
        place.slot,
        goToURLText
      ).then((ids) => ids.some((id) => id !== undefined));
    } else {
      return false;
    }

    // A window closed mid-carry refuses every tab, and is no restore.
    void opened.then((any) => {
      if (any) noteRestore();
    });
    return true;
  };
