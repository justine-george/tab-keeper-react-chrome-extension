import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { dropOnTop } from './dropOnTop';
import {
  pairDrop,
  tabDrop,
  type PairDropParams,
  type TabDropParams,
} from './dropSpecs';
import { showToast } from './slices/globalStateSlice';
import {
  isLatestUndoStep,
  type tabContainerData,
  type tabData,
} from './slices/tabContainerDataStateSlice';
import type { RootState } from './store';
import { TOAST_MESSAGES } from '../utils/constants/common';
import { isTabPinnedIn } from '../utils/functions/pinnedRun';

// KAN-811. A pin changes how a restore opens the tab, and a drop one slot off changes it unseen; a move that keeps it stays silent (S5 A).

interface TabRef {
  tabGroupId: string;
  windowId: string;
  tabId: string;
}

const tabsOf = (
  sessions: readonly tabContainerData[],
  to: Omit<TabRef, 'tabId'>
): readonly tabData[] =>
  sessions
    .find((s) => s.tabGroupId === to.tabGroupId)
    ?.windows.find((w) => w.windowId === to.windowId)?.tabs ?? [];

// Reordered in its window, the tab is found by its id. Landed from elsewhere, it is new to the window: by its id, or, re-minted
// because the target session held that id, the new ids there. More new ids than arrived (another page's change landed with the drop) name no tab, and say nothing.
function landedTab(
  tabs: readonly tabData[],
  from: TabRef,
  to: Omit<TabRef, 'tabId'>,
  idsBefore: ReadonlySet<string>,
  arriving: number
): tabData | undefined {
  if (from.tabGroupId === to.tabGroupId && from.windowId === to.windowId) {
    return tabs.find((t) => t.tabId === from.tabId);
  }
  const arrived = tabs.filter((t) => !idsBefore.has(t.tabId));
  return (
    arrived.find((t) => t.tabId === from.tabId) ??
    (arrived.length === arriving ? arrived[0] : undefined)
  );
}

// Runs `drop` for the saved tab `from`, landing in window `to`, and says "Tab pinned." / "Tab unpinned." when its pin changed.
// Undo only while the drop is the newest step. `arriving`: the tabs it lands, two for a pair (KAN-942).
export const announcingPinChange =
  <R>(
    from: TabRef,
    to: Omit<TabRef, 'tabId'>,
    drop: ThunkAction<R, RootState, unknown, UnknownAction>,
    arriving = 1
  ): ThunkAction<R, RootState, unknown, UnknownAction> =>
  (dispatch, getState) => {
    const before = getState();
    const wasPinned = isTabPinnedIn(
      before.tabContainerDataState.tabGroups,
      from
    );
    const idsBefore = new Set(
      tabsOf(before.tabContainerDataState.tabGroups, to).map((t) => t.tabId)
    );
    const result = dispatch(drop);
    const landed = landedTab(
      tabsOf(getState().tabContainerDataState.tabGroups, to),
      from,
      to,
      idsBefore,
      arriving
    );
    if (landed !== undefined && (landed.pinned === true) !== wasPinned) {
      void dispatch(
        showToast({
          toastText: wasPinned
            ? TOAST_MESSAGES.TAB_UNPINNED
            : TOAST_MESSAGES.TAB_PINNED,
          announcesSavedChange: true,
          offersUndo: isLatestUndoStep(getState, before.undoRedo.present),
        })
      );
    }
    return result;
  };

// A saved tab let go among its own session's rows.
export const dropSavedTab = (
  params: TabDropParams
): ThunkAction<void, RootState, unknown, UnknownAction> =>
  announcingPinChange(
    {
      tabGroupId: params.tabGroupId,
      windowId: params.fromWindowId,
      tabId: params.tabId,
    },
    { tabGroupId: params.tabGroupId, windowId: params.toWindowId },
    dropOnTop(tabDrop(params))
  );

// KAN-942. A saved pair let go among its own session's rows.
export const dropSavedPair = (
  params: PairDropParams
): ThunkAction<void, RootState, unknown, UnknownAction> =>
  announcingPinChange(
    {
      tabGroupId: params.tabGroupId,
      windowId: params.fromWindowId,
      tabId: params.tabId,
    },
    { tabGroupId: params.tabGroupId, windowId: params.toWindowId },
    dropOnTop(pairDrop(params)),
    2
  );
