// KAN-815. A saved tab, pair (KAN-942), group or window let go over Currently open opens a
// copy in Chrome: in the background at a slot of a live window, or in a new
// window in front (KAN-853); a window also in the background at the end of an
// open one (KAN-892). The saved session is never changed. What it opened is
// kept as an undo step (KAN-893). Whether Chrome was asked is known at once,
// because the carry ends in the same call (RowDragArea's finish); whether it
// opened the copy comes later, and never throws.
import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';

import { pickOf, sourceWindowOf } from './carriedItem';
import type { CarriedItem, CarriedPick } from './carriedItem';
import { expectNewWindow } from './newWindowFollow';
import { noteReviewMoment } from './reviewAsk';
import { showToast } from './slices/globalStateSlice';
import { selectSkipsTabsAlreadyOpen } from './slices/settingsDataStateSlice';
import {
  keepOpenedStep,
  whileKeepingStep,
  whileMovingTabs,
} from './undoHistory';
import { toWindowSpec } from './slices/tabContainerDataStateSlice';
import type {
  tabData,
  windowGroupData,
} from './slices/tabContainerDataStateSlice';
import type { RootState } from './store';
import {
  openGroupCopy,
  openPairCopy,
  openTabCopy,
} from '../utils/functions/openCopies';
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
import { recordOpened } from '../utils/functions/runOpenedCopy';
import type { ReopenAt } from '../utils/functions/openedCopy';
import {
  isMadeWindowList,
  RESTORE_SESSION_MESSAGE,
} from '../utils/functions/windows';
import type {
  MadeWindow,
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

// The window the worker's restore made; null when it made none, failed, or could not be reached.
async function askNewWindow(
  request: RestoreSessionRequest
): Promise<MadeWindow | null> {
  try {
    const answer: unknown = await chrome.runtime.sendMessage(request);
    return (isMadeWindowList(answer) && answer[0]) || null;
  } catch (error) {
    console.warn('Could not open the copy in a new window:', error);
    return null;
  }
}

// A lone half opens plain: a split needs its two tabs.
function unsplit(tab: tabData): tabData {
  const copy = { ...tab };
  delete copy.splitId;
  return copy;
}

// A group's tabs never open pinned: Chrome's groups hold none.
function unpinned(tab: tabData): tabData {
  const copy = { ...tab };
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

// A pair's two tabs, head first; null when either is gone.
function halvesOf(
  window: windowGroupData,
  pick: Extract<CarriedPick, { kind: 'pair' }>
): [tabData, tabData] | null {
  const first = window.tabs.find((t) => t.tabId === pick.tabId);
  const second = window.tabs.find((t) => t.tabId === pick.partnerTabId);
  return first === undefined || second === undefined ? null : [first, second];
}

// The new window a pick opens in: in front (KAN-853). Null when the window no
// longer holds the tab, pair or group.
export function copyWindowSpec(
  window: windowGroupData,
  pick: CarriedPick
): WindowSpec | null {
  const kind = window.incognito === true ? { incognito: true as const } : {};
  switch (pick.kind) {
    // KAN-942. The worker's restore splits it (splitPairs).
    case 'pair': {
      const halves = halvesOf(window, pick);
      if (!halves) return null;
      return { tabs: halves, focused: true, bounds: null, ...kind };
    }
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
          stacksOnTwin: true,
        })
      );
    // Each drop is its own event, so twin toasts stack (KAN-401).
    // Every page was there: the open copies light up and the drop is done.
    const sayAlreadyOpen = (windowId: number, ids: number[]) => {
      announceArrival(windowId, ids);
      dispatch(
        showToast({
          toastText:
            ids.length === 1
              ? TOAST_MESSAGES.THIS_WINDOW_ALREADY_HAS_THIS_TAB
              : TOAST_MESSAGES.THIS_WINDOW_ALREADY_HAS_THESE_TABS,
          stacksOnTwin: true,
        })
      );
    };

    // KAN-893. The tabs a drop opened, kept as one undo step; `saved` runs parallel to `ids`.
    const hasTabGroups = state.globalState.hasTabGroupsPermission;
    const keep = async (
      ids: readonly (number | undefined)[],
      saved: readonly tabData[],
      reopen: ReopenAt,
      extra: { group?: TabGroupSpec; madeWindow?: MadeWindow } = {}
    ) => {
      const { group = null, madeWindow } = extra;
      keepOpenedStep(dispatch, {
        kind: 'opened',
        tabs: await recordOpened(ids, saved, hasTabGroups),
        group,
        madeWindow:
          madeWindow === undefined
            ? null
            : {
                windowId: madeWindow.windowId,
                stubTabId: madeWindow.stubTabId,
              },
        reopen,
        goToURLText,
      });
    };
    const atSlot = (slot: {
      windowId: number;
      index: number;
      groupId?: number;
    }): ReopenAt => ({
      at: 'slot',
      windowId: slot.windowId,
      index: slot.index,
      groupId: slot.groupId ?? null,
    });

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
        answers: true,
      };
      // Counted when asked, as Open: the carry ends before the worker answers.
      noteRestore();
      expectNewWindow();
      void whileKeepingStep(async () => {
        const made = await askNewWindow(request);
        if (made !== null) {
          await keep(
            made.tabIds,
            spec.tabs,
            { at: 'newWindow', spec },
            { madeWindow: made }
          );
        }
      });
      return Promise.resolve(true);
    } else if (place.kind === 'intoWindow' && pick.kind === 'window') {
      // Nothing takes focus (spec D), a fallback new window included.
      const spec = toWindowSpec(window, false);
      const request: OpenIntoWindowRequest = {
        type: OPEN_INTO_WINDOW_MESSAGE,
        windowId: place.windowId,
        specs: [spec],
        goToURLText,
        activate: false,
        pinTabKeeper: state.settingsDataState.pinTabKeeperInNewWindows,
        skipTabsAlreadyOpen: skips,
      };
      opened = whileMovingTabs(async () => {
        const answer = await askIntoWindow(request);
        const { ids, savedTabIds, madeWindows } = answer;
        const byId = new Map(spec.tabs.map((tab) => [tab.tabId, tab]));
        const saved = savedTabIds.flatMap((id) => byId.get(id) ?? []);
        if (ids.length > 0 && saved.length === ids.length) {
          const reopen = {
            at: 'windowEnd',
            windowId: place.windowId,
            spec: { ...spec, tabs: saved },
          } as const;
          await keep(ids, saved, reopen);
        } else if (ids.length === 0 && madeWindows[0] !== undefined) {
          // Its window closed mid-carry: the worker opened it in a new one instead, undone as a New window drop.
          const made = madeWindows[0];
          await keep(
            made.tabIds,
            spec.tabs,
            { at: 'newWindow', spec },
            { madeWindow: made }
          );
        }
        return answer;
      }).then(({ ids, leftOut, alreadyOpen }): Outcome => {
        if (ids.length > 0) {
          announceArrival(place.windowId, ids);
          if (leftOut > 0) sayLeftOut(leftOut);
          return 'opened';
        }
        // Every tab left out; fewer means the rest were refused.
        if (alreadyOpen.length === 0 || leftOut < window.tabs.length)
          return 'nothing';
        sayAlreadyOpen(place.windowId, alreadyOpen);
        return 'alreadyOpen';
      });
    } else if (place.kind === 'tab' && pick.kind === 'tab') {
      const tab = window.tabs.find((t) => t.tabId === pick.tabId);
      if (!tab) return null;
      const plain = unsplit(tab);
      opened = whileMovingTabs(async (): Promise<Outcome> => {
        const copy = skips
          ? openCopyOf(plain, await pagesOpenIn(place.slot.windowId))
          : undefined;
        if (copy !== undefined) {
          sayAlreadyOpen(place.slot.windowId, [copy]);
          return 'alreadyOpen';
        }
        const id = await openTabCopy(plain, place.slot);
        if (id === undefined) return 'nothing';
        await keep([id], [plain], atSlot(place.slot));
        return 'opened';
      });
    } else if (place.kind === 'tab' && pick.kind === 'pair') {
      const halves = halvesOf(window, pick);
      if (!halves) return null;
      opened = whileMovingTabs(async (): Promise<Outcome> => {
        // KAN-906. Left out only when both halves are open.
        const rest = skips
          ? leaveOutOpenTabs(halves, await pagesOpenIn(place.slot.windowId))
          : { tabs: halves, alreadyOpen: [] };
        if (rest.tabs.length === 0) {
          sayAlreadyOpen(place.slot.windowId, rest.alreadyOpen);
          return 'alreadyOpen';
        }
        const ids = await openPairCopy(...halves, place.slot);
        if (!ids.some((id) => id !== undefined)) return 'nothing';
        await keep(ids, halves, atSlot(place.slot));
        return 'opened';
      });
    } else if (place.kind === 'group' && pick.kind === 'group') {
      const found = groupOf(window, pick.groupId);
      if (!found) return null;
      opened = whileMovingTabs(async (): Promise<Outcome> => {
        const rest = skips
          ? leaveOutOpenTabs(found.tabs, await pagesOpenIn(place.slot.windowId))
          : { tabs: found.tabs, leftOut: 0, alreadyOpen: [] };
        if (rest.tabs.length === 0) {
          sayAlreadyOpen(place.slot.windowId, rest.alreadyOpen);
          return 'alreadyOpen';
        }
        const ids = await openGroupCopy(
          rest.tabs,
          found.group,
          place.slot,
          goToURLText
        );
        if (!ids.some((id) => id !== undefined)) return 'nothing';
        await keep(ids, rest.tabs, atSlot(place.slot), { group: found.group });
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
