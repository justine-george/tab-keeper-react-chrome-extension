// KAN-815. A saved tab, group or window let go over Currently open opens a
// copy in Chrome: in the background at a slot of a live window, or in a new
// window in front (KAN-853); a window also in the background at the end of an
// open one (KAN-892). The saved session is never changed, so there is no toast
// and no Undo (as Open). Whether Chrome was asked is known at once, because
// the carry ends in the same call (RowDragArea's finish); whether it opened
// the copy comes later, and never throws.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { pickOf, sourceWindowOf } from './carriedItem';
import type { CarriedItem, CarriedPick } from './carriedItem';
import { expectNewWindow } from './newWindowFollow';
import { noteReviewMoment } from './reviewAsk';
import { showToast } from './slices/globalStateSlice';
import { selectSkipsTabsAlreadyOpen } from './slices/settingsDataStateSlice';
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
import { announceArrival } from '../utils/functions/arrival';
import { TOAST_MESSAGES } from '../utils/constants/common';
import {
  leaveOutOpenTabs,
  openCopyOf,
  openPagesOf,
} from '../utils/functions/skipOpen';
import type { OpenPages } from '../utils/functions/skipOpen';
import {
  isOpenIntoWindowAnswer,
  NOTHING_OPENED,
  OPEN_INTO_WINDOW_MESSAGE,
} from '../utils/functions/openIntoWindow';
import type {
  OpenIntoWindowAnswer,
  OpenIntoWindowRequest,
} from '../utils/functions/openIntoWindow';
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
  | { kind: 'newWindow' }
  // KAN-892 D. A whole window, at the end of that open window.
  | { kind: 'intoWindow'; windowId: number };

// The worker's answer; nothing opened when it opened them elsewhere, failed, or could not be reached.
async function askIntoWindow(
  request: OpenIntoWindowRequest
): Promise<OpenIntoWindowAnswer> {
  try {
    const answer: unknown = await chrome.runtime.sendMessage(request);
    return isOpenIntoWindowAnswer(answer) ? answer : NOTHING_OPENED;
  } catch (error) {
    console.warn('Could not open the saved window in that window:', error);
    return NOTHING_OPENED;
  }
}

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

// What a copy at a slot came to: opened, finished with every page already there, or nothing.
type Outcome = 'opened' | 'alreadyOpen' | 'nothing';

// The window's pages; none when Chrome cannot list it (closed mid-carry), so the copy asks as today and is refused.
async function pagesOpenIn(windowId: number): Promise<OpenPages> {
  try {
    return openPagesOf(await chrome.tabs.query({ windowId }));
  } catch {
    return openPagesOf([]);
  }
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

// The new window a pick opens in: in front (KAN-853). Null when the window no
// longer holds the tab or group.
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
    // As Open makes it: its saved state too (KAN-853).
    case 'window':
      return toWindowSpec(window, true);
  }
}

// Null when Chrome was not asked; else whether it opened the copy. A new
// window's restore sends no answer, so it is taken as opened. A copy at a slot
// or into a window runs as Tab Keeper's own move (KAN-850): Open now reads it
// at once.
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

    const skips = selectSkipsTabsAlreadyOpen(state);
    const sayLeftOut = (count: number) =>
      dispatch(
        showToast({
          toastText: TOAST_MESSAGES.DUPLICATE_TABS_LEFT_OUT,
          toastParams: { count },
        })
      );
    // Every page was there: the open copies light up and the drop is done.
    const sayAlreadyOpen = (windowId: number, ids: number[], text: string) => {
      announceArrival(windowId, ids);
      dispatch(showToast({ toastText: text }));
    };

    let opened: Promise<Outcome>;
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
    } else if (place.kind === 'intoWindow' && pick.kind === 'window') {
      // Nothing takes focus (spec D), a fallback new window included.
      const request: OpenIntoWindowRequest = {
        type: OPEN_INTO_WINDOW_MESSAGE,
        windowId: place.windowId,
        specs: [toWindowSpec(window, false)],
        goToURLText,
        activate: false,
        pinTabKeeper: state.settingsDataState.pinTabKeeperInNewWindows,
        skipTabsAlreadyOpen: skips,
      };
      opened = whileMovingTabs(() => askIntoWindow(request)).then(
        ({ ids, leftOut, alreadyOpen }): Outcome => {
          if (ids.length > 0) {
            announceArrival(place.windowId, ids);
            if (leftOut > 0) sayLeftOut(leftOut);
            return 'opened';
          }
          if (alreadyOpen.length === 0) return 'nothing';
          sayAlreadyOpen(
            place.windowId,
            alreadyOpen,
            TOAST_MESSAGES.THIS_WINDOW_ALREADY_HAS_THESE_TABS
          );
          return 'alreadyOpen';
        }
      );
    } else if (place.kind === 'tab' && pick.kind === 'tab') {
      const tab = window.tabs.find((t) => t.tabId === pick.tabId);
      if (!tab) return null;
      const plain = unsplit(tab);
      opened = whileMovingTabs(async (): Promise<Outcome> => {
        const copy = skips
          ? openCopyOf(plain, await pagesOpenIn(place.slot.windowId))
          : undefined;
        if (copy !== undefined) {
          sayAlreadyOpen(
            place.slot.windowId,
            [copy],
            TOAST_MESSAGES.THIS_WINDOW_ALREADY_HAS_THIS_TAB
          );
          return 'alreadyOpen';
        }
        return (await openTabCopy(plain, place.slot)) !== undefined
          ? 'opened'
          : 'nothing';
      });
    } else if (place.kind === 'group' && pick.kind === 'group') {
      const found = groupOf(window, pick.groupId);
      if (!found) return null;
      opened = whileMovingTabs(async (): Promise<Outcome> => {
        const rest = skips
          ? leaveOutOpenTabs(found.tabs, await pagesOpenIn(place.slot.windowId))
          : { tabs: found.tabs, leftOut: 0, alreadyOpen: [] };
        if (rest.tabs.length === 0) {
          sayAlreadyOpen(
            place.slot.windowId,
            rest.alreadyOpen,
            TOAST_MESSAGES.THIS_WINDOW_ALREADY_HAS_THESE_TABS
          );
          return 'alreadyOpen';
        }
        const ids = await openGroupCopy(
          rest.tabs,
          found.group,
          place.slot,
          goToURLText
        );
        if (!ids.some((id) => id !== undefined)) return 'nothing';
        if (rest.leftOut > 0) sayLeftOut(rest.leftOut);
        return 'opened';
      });
    } else {
      return null;
    }

    // A window closed mid-carry refuses every tab, and is no restore. A drop
    // with every page already there is a finished one: the carry clears.
    return opened.then((outcome) => {
      if (outcome === 'opened') noteRestore();
      return outcome !== 'nothing';
    });
  };
