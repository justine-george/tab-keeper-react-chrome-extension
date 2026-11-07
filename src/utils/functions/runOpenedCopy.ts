// KAN-893. ⌘Z or ⌘⇧Z for a saved copy dropped into Currently open. Undo
// closes exactly the tabs the drop opened, refusing when any moved, closed or
// left its page; redo opens them again from the step's own record. Page-side;
// never throws.
import { expectNewWindow } from '../../redux/newWindowFollow';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { announceArrival } from './arrival';
import { openGroupCopy, openPairCopy, openTabCopy } from './openCopies';
import type { OpenedCopy, OpenedTab, RenamedIds } from './openedCopy';
import {
  isOpenIntoWindowAnswer,
  OPEN_INTO_WINDOW_MESSAGE,
} from './openIntoWindow';
import type { OpenIntoWindowRequest } from './openIntoWindow';
import { readPlace } from './openNowMoves';
import type { LiveRun } from './openNowMoves';
import { forgetSettled, showsItsPage, watchSettling } from './settledPages';
import { isMadeWindowList, RESTORE_SESSION_MESSAGE } from './windows';
import type { RestoreSessionRequest } from './windows';

export interface OpenedCopyRun {
  hasTabGroups: boolean;
  // Settings → Pin Tab Keeper in new windows, for a New window redo.
  pinTabKeeper: boolean;
}

type Run = LiveRun<OpenedCopy>;

const REFUSED = Symbol('refused');

async function attempt<T>(call: () => Promise<T>): Promise<T | typeof REFUSED> {
  try {
    return await call();
  } catch {
    return REFUSED;
  }
}

// The tabs a copy just opened, by Chrome's order: where each landed and the
// address it was opened with. `saved` runs parallel to `ids`; a refused id, or
// a tab Chrome won't read, is left out. Their first loads are watched from here.
export async function recordOpened(
  ids: readonly (number | undefined)[],
  saved: readonly tabData[],
  hasTabGroups: boolean
): Promise<OpenedTab[]> {
  const withLook = hasTabGroups && Boolean(chrome.tabGroups);
  const opened: OpenedTab[] = [];
  for (const [i, tabId] of ids.entries()) {
    const savedTab = saved[i];
    if (tabId === undefined || savedTab === undefined) continue;
    const tab = await attempt(() => chrome.tabs.get(tabId));
    const place = await readPlace(tabId, withLook);
    if (tab === REFUSED || tab === undefined || place === null) continue;
    opened.push({
      tabId,
      place,
      openedUrl: tab.pendingUrl || tab.url || '',
      saved: savedTab,
    });
  }
  watchSettling(opened.map((t) => t.tabId));
  return opened.sort((a, b) => a.place.index - b.place.index);
}

export function runOpenedCopy(
  step: OpenedCopy,
  direction: 'undo' | 'redo',
  options: OpenedCopyRun
): Promise<Run> {
  return direction === 'undo' ? undo(step) : redo(step, options);
}

// Every tab where the drop left it (window, group, pin, order among them) and on its own page.
async function untouched(step: OpenedCopy): Promise<boolean> {
  let lastIndex = -1;
  for (const opened of step.tabs) {
    const tab = await attempt(() => chrome.tabs.get(opened.tabId));
    if (tab === REFUSED || tab === undefined) return false;
    const { place } = opened;
    if (
      tab.windowId !== place.windowId ||
      tab.groupId !== place.groupId ||
      tab.pinned !== place.pinned ||
      tab.index <= lastIndex ||
      !showsItsPage(tab, opened)
    ) {
      return false;
    }
    lastIndex = tab.index;
  }
  return true;
}

async function undo(step: OpenedCopy): Promise<Run> {
  if (!(await untouched(step))) return { outcome: 'changedSince' };
  const ids = step.tabs.map((t) => t.tabId);
  // The window the drop made goes too, with its stub, unless the user opened a tab there since.
  const made = step.madeWindow;
  if (made !== null) {
    const own = new Set(
      made.stubTabId === null ? ids : [...ids, made.stubTabId]
    );
    const there = await attempt(() =>
      chrome.tabs.query({ windowId: made.windowId })
    );
    if (
      there !== REFUSED &&
      there.every((t) => t.id !== undefined && own.has(t.id))
    ) {
      const closed = await attempt(() => chrome.windows.remove(made.windowId));
      if (closed === REFUSED) return { outcome: 'couldNotRun' };
      forgetSettled(ids);
      return { outcome: 'done', drop: step };
    }
  }
  const closed = await attempt(() => chrome.tabs.remove(ids));
  if (closed === REFUSED) return { outcome: 'couldNotRun' };
  forgetSettled(ids);
  return { outcome: 'done', drop: step };
}

// What a redo opened: its tab ids parallel to `saved`, and the window it made.
interface Reopened {
  ids: (number | undefined)[];
  saved: tabData[];
  madeWindow: OpenedCopy['madeWindow'];
  // Set when it opened somewhere else than the step said: its window closed as the worker opened it.
  reopen?: OpenedCopy['reopen'];
}

async function redo(step: OpenedCopy, options: OpenedCopyRun): Promise<Run> {
  const reopened = await reopen(step, options);
  if (reopened === 'windowClosed' || reopened === 'couldNotRun') {
    return { outcome: reopened };
  }
  const tabs = await recordOpened(
    reopened.ids,
    reopened.saved,
    options.hasTabGroups
  );
  if (tabs.length === 0) return { outcome: 'couldNotRun' };
  const at = reopened.reopen ?? step.reopen;
  if (at.at !== 'newWindow') {
    announceArrival(
      at.windowId,
      tabs.map((t) => t.tabId)
    );
  }
  forgetSettled(step.tabs.map((t) => t.tabId));
  const drop: OpenedCopy = {
    ...step,
    tabs,
    madeWindow: reopened.madeWindow,
    reopen: reopened.reopen ?? step.reopen,
  };
  return { outcome: 'done', drop, renamed: renamedBy(step, drop) };
}

// Old ids to new, each tab matched by the saved tab it copies.
function renamedBy(before: OpenedCopy, after: OpenedCopy): RenamedIds {
  const tabs = new Map<number, number>();
  const groups = new Map<number, number>();
  for (const old of before.tabs) {
    const now = after.tabs.find((t) => t.saved.tabId === old.saved.tabId);
    if (now === undefined) continue;
    tabs.set(old.tabId, now.tabId);
    if (old.place.groupId !== -1)
      groups.set(old.place.groupId, now.place.groupId);
  }
  const windows = new Map<number, number>();
  const [was, is] = [before.madeWindow, after.madeWindow];
  if (was !== null && is !== null) {
    windows.set(was.windowId, is.windowId);
    if (was.stubTabId !== null && is.stubTabId !== null) {
      tabs.set(was.stubTabId, is.stubTabId);
    }
  }
  return { tabs: [...tabs], windows: [...windows], groups: [...groups] };
}

async function reopen(
  step: OpenedCopy,
  options: OpenedCopyRun
): Promise<Reopened | 'windowClosed' | 'couldNotRun'> {
  const saved = step.tabs.map((t) => t.saved);
  const at = step.reopen;
  if (at.at === 'newWindow') {
    const request: RestoreSessionRequest = {
      type: RESTORE_SESSION_MESSAGE,
      specs: [at.spec],
      goToURLText: step.goToURLText,
      closeOtherWindows: false,
      pinTabKeeper: options.pinTabKeeper,
      answers: true,
    };
    expectNewWindow();
    const answer = await attempt(
      () => chrome.runtime.sendMessage(request) as Promise<unknown>
    );
    const made = isMadeWindowList(answer) ? answer[0] : undefined;
    if (made === undefined) return 'couldNotRun';
    return {
      ids: made.tabIds,
      saved: at.spec.tabs,
      madeWindow: { windowId: made.windowId, stubTabId: made.stubTabId },
    };
  }

  const strip = await attempt(() =>
    chrome.tabs.query({ windowId: at.windowId })
  );
  if (strip === REFUSED || strip.length === 0) return 'windowClosed';

  if (at.at === 'windowEnd') {
    const request: OpenIntoWindowRequest = {
      type: OPEN_INTO_WINDOW_MESSAGE,
      windowId: at.windowId,
      specs: [at.spec],
      goToURLText: step.goToURLText,
      activate: false,
      pinTabKeeper: options.pinTabKeeper,
      skipTabsAlreadyOpen: false,
    };
    const answer = await attempt(
      () => chrome.runtime.sendMessage(request) as Promise<unknown>
    );
    if (!isOpenIntoWindowAnswer(answer)) return 'couldNotRun';
    // Its window closed meanwhile: the worker opened a new one instead, kept as a New window step, as the drop does.
    const instead = answer.madeWindows[0];
    if (answer.ids.length === 0 && instead !== undefined) {
      return {
        ids: instead.tabIds,
        saved: at.spec.tabs,
        madeWindow: {
          windowId: instead.windowId,
          stubTabId: instead.stubTabId,
        },
        reopen: { at: 'newWindow', spec: at.spec },
      };
    }
    if (answer.ids.length === 0) return 'couldNotRun';
    const byId = new Map(at.spec.tabs.map((t) => [t.tabId, t]));
    const pairs = answer.ids.flatMap((id, i) => {
      const tab = byId.get(answer.savedTabIds[i] ?? '');
      return tab === undefined ? [] : [{ id, tab }];
    });
    return {
      ids: pairs.map((p) => p.id),
      saved: pairs.map((p) => p.tab),
      madeWindow: null,
    };
  }

  // A live group gone means loose; Chrome puts a slot past the end at the end (spec "Redo").
  const groupId =
    at.groupId !== null && strip.some((t) => t.groupId === at.groupId)
      ? at.groupId
      : undefined;
  const pinned = step.tabs[0]?.place.pinned === true && groupId === undefined;
  const slot = {
    windowId: at.windowId,
    index: at.index,
    pinned,
    ...(groupId === undefined ? {} : { groupId }),
  };
  const [first, second] = saved;
  if (first === undefined) return 'couldNotRun';
  let ids: (number | undefined)[];
  if (step.group !== null) {
    ids = await openGroupCopy(saved, step.group, slot, step.goToURLText);
  } else if (second !== undefined) {
    ids = await openPairCopy(first, second, slot);
  } else {
    ids = [await openTabCopy(first, slot)];
  }
  return { ids, saved, madeWindow: null };
}
