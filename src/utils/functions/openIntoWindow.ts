import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { pinnedRunLength } from './pinnedRun';
import { isIncognitoAllowed, restoreSession } from './restoreSession';
import { leaveOutOpenSpecs, openCopyOf, openPagesOf } from './skipOpen';
import { createSplitApi } from './splitView';
import {
  applyTabGroups,
  createRestoredTab,
  groupMembers,
  placeholderIcon,
  realPageIndexes,
  RESTORE_SESSION_MESSAGE,
  restoredTabUrl,
  restoreTargetIndex,
  splitPairs,
  splitRestoredPairs,
  type TabGroupSpec,
  type WindowSpec,
} from './windows';

// KAN-892. Worker-safe, as windows.ts is: no `window`.

export const OPEN_INTO_WINDOW_MESSAGE = 'open-into-window';

// Saved windows' tabs into a window that is already open, by Open's restore rules. Runs in the worker for the reason RestoreSessionRequest does.
export interface OpenIntoWindowRequest {
  type: typeof OPEN_INTO_WINDOW_MESSAGE;
  windowId: number;
  specs: WindowSpec[];
  goToURLText: string;
  // Open: the target tab becomes current and the window takes focus. A drop: nothing takes focus.
  activate: boolean;
  // For the windows opened apart or as the fallback.
  pinTabKeeper: boolean;
  // KAN-910. Leave out saved tabs whose page this window already has.
  skipTabsAlreadyOpen: boolean;
}

// ids: the tabs created, in merged order. leftOut: saved tabs not opened for the window already having their page; alreadyOpen: the ids of those open copies.
export interface OpenIntoWindowAnswer {
  ids: number[];
  leftOut: number;
  alreadyOpen: number[];
}

const isIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'number');

export function isOpenIntoWindowAnswer(
  answer: unknown
): answer is OpenIntoWindowAnswer {
  if (typeof answer !== 'object' || answer === null) return false;
  const candidate = answer as Record<string, unknown>;
  return (
    isIdList(candidate.ids) &&
    typeof candidate.leftOut === 'number' &&
    isIdList(candidate.alreadyOpen)
  );
}

export const NOTHING_OPENED: OpenIntoWindowAnswer = {
  ids: [],
  leftOut: 0,
  alreadyOpen: [],
};

export function isOpenIntoWindowRequest(
  message: unknown
): message is OpenIntoWindowRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate.type === OPEN_INTO_WINDOW_MESSAGE &&
    typeof candidate.windowId === 'number' &&
    Array.isArray(candidate.specs) &&
    typeof candidate.goToURLText === 'string' &&
    typeof candidate.activate === 'boolean' &&
    typeof candidate.pinTabKeeper === 'boolean' &&
    typeof candidate.skipTabsAlreadyOpen === 'boolean'
  );
}

// Today's rule first: not allowed in incognito, a window saved incognito opens normal (restoreSession's withoutIncognito).
export function effectiveIncognito(
  saved: true | undefined,
  allowed: boolean
): boolean {
  return saved === true && allowed;
}

// A saved window of the other kind than the target opens apart, in its own new window, spec unchanged.
export function splitByKind(
  specs: WindowSpec[],
  targetIncognito: boolean,
  allowed: boolean
): { into: WindowSpec[]; apart: WindowSpec[] } {
  const into: WindowSpec[] = [];
  const apart: WindowSpec[] = [];
  for (const spec of specs) {
    const sameKind =
      effectiveIncognito(spec.incognito, allowed) === targetIncognito;
    (sameKind ? into : apart).push(spec);
  }
  return { into, apart };
}

// Pinned tabs of every saved window first, then each window's other tabs, window after window.
// targetIndex: the tab Open lands on (restoreTargetIndex) of the first window with tabs; -1 when there are no tabs.
export function mergeForWindow(specs: WindowSpec[]): {
  tabs: tabData[];
  groups: TabGroupSpec[];
  targetIndex: number;
} {
  const placed = specs.flatMap((spec, w) =>
    spec.tabs.map((tab, i) => ({ tab: scopeSplit(tab, w), w, i }))
  );
  const order = [
    ...placed.filter((p) => p.tab.pinned === true),
    ...placed.filter((p) => p.tab.pinned !== true),
  ];
  const first = specs.findIndex((spec) => spec.tabs.length > 0);
  const target =
    first === -1
      ? -1
      : restoreTargetIndex(specs[first].tabs, specs[first].activeTabId);
  return {
    tabs: order.map((p) => p.tab),
    groups: specs.flatMap((spec) => spec.groups ?? []),
    targetIndex: order.findIndex((p) => p.w === first && p.i === target),
  };
}

// A split id is minted per capture, so two copies of one window can share it; scoped per window, each stays its own pair.
const scopeSplit = (tab: tabData, w: number): tabData =>
  tab.splitId === undefined ? tab : { ...tab, splitId: `${w}:${tab.splitId}` };

// The created tab ids in merged order, refused ones left out; none when the tabs went to new windows instead.
export async function openIntoWindow(
  request: OpenIntoWindowRequest
): Promise<OpenIntoWindowAnswer> {
  const { windowId, goToURLText, pinTabKeeper } = request;
  const inNewWindows = (specs: WindowSpec[]) =>
    restoreSession({
      type: RESTORE_SESSION_MESSAGE,
      specs,
      goToURLText,
      closeOtherWindows: false,
      pinTabKeeper,
    });

  const targetWindow = await tabbedWindow(windowId);
  if (targetWindow === null) {
    await inNewWindows(request.specs);
    return NOTHING_OPENED;
  }
  const { into, apart } = splitByKind(
    request.specs,
    targetWindow.incognito,
    await isIncognitoAllowed()
  );
  if (apart.length > 0) await inNewWindows(apart);

  // One read of the window serves the open pages and, later, the pinned run.
  const liveTabs = request.skipTabsAlreadyOpen
    ? await tabsInOrder(windowId)
    : undefined;
  const open = liveTabs === undefined ? undefined : openPagesOf(liveTabs);
  const whole = mergeForWindow(into);
  const skipped =
    open === undefined
      ? { specs: into, leftOut: 0, alreadyOpen: [] }
      : leaveOutOpenSpecs(into, open);
  const leftOutAnswer = {
    leftOut: skipped.leftOut,
    alreadyOpen: skipped.alreadyOpen,
  };
  const merged = skipped.leftOut === 0 ? whole : mergeForWindow(skipped.specs);
  const { tabs, groups } = merged;
  let { targetIndex } = merged;
  // The saved target tab, judged before anything was left out: left out, its open copy is current.
  let openCopyId: number | undefined;
  const target = whole.tabs[whole.targetIndex];
  if (skipped.leftOut > 0 && open !== undefined && target !== undefined) {
    if (!tabs.some((t) => t.tabId === target.tabId)) {
      openCopyId = openCopyOf(target, open);
      if (openCopyId !== undefined) targetIndex = -1;
    }
  }
  if (tabs.length === 0) {
    if (skipped.leftOut > 0 && request.activate)
      await bringForward(windowId, openCopyId);
    return { ids: [], ...leftOutAnswer };
  }

  const createSplit = createSplitApi();
  const pairs = createSplit === null ? [] : splitPairs(tabs);
  const loadsPage = realPageIndexes(tabs, pairs).add(targetIndex);
  // Awaited before any create: a create issued as its fetch settles would land out of order.
  const icons = await Promise.all(
    tabs.map((tab, i) => (loadsPage.has(i) ? '' : placeholderIcon(tab)))
  );
  let pinnedSlot = pinnedRunLength(liveTabs ?? (await tabsInOrder(windowId)));
  // A pinned tab takes the next slot only once Chrome made it.
  const create = async (tab: tabData, i: number) => {
    const id = await createRestoredTab(
      windowId,
      tab,
      restoredTabUrl(tab, loadsPage.has(i), icons[i], goToURLText),
      tab.pinned === true ? pinnedSlot : undefined
    );
    if (tab.pinned === true && id !== undefined) pinnedSlot += 1;
    return id;
  };

  const [firstTab, ...restTabs] = tabs;
  const firstId = await create(firstTab, 0);
  // Refused with the window gone or unusable: new windows rather than not at all. Refused with it fine: that page alone is skipped.
  if (firstId === undefined && (await tabbedWindow(windowId)) === null) {
    await inNewWindows(into);
    return NOTHING_OPENED;
  }
  // mergeForWindow put the pinned first. They go one at a time, each slot
  // known from the last; the rest all at once: Chrome runs one extension's
  // calls in order, so they land in order.
  const rest = restTabs.map((tab, k) => ({ tab, i: k + 1 }));
  const ids = [firstId];
  for (const { tab, i } of rest.filter(({ tab }) => tab.pinned === true))
    ids.push(await create(tab, i));
  ids.push(
    ...(await Promise.all(
      rest
        .filter(({ tab }) => tab.pinned !== true)
        .map(({ tab, i }) => create(tab, i))
    ))
  );

  // A refused saved active tab falls back as Open's does (retryAfterFailure, KAN-458).
  const currentIndex =
    openCopyId === undefined && ids[targetIndex] === undefined
      ? mergeForWindow(skipped.specs.map(withoutActiveTab)).targetIndex
      : targetIndex;
  const currentId = openCopyId ?? ids[currentIndex];

  await applyTabGroups(windowId, groups, groupMembers(tabs, ids), {
    kind: 'saved',
    openTabId: currentId,
  });
  // Last of the tab steps: a move ends a split (measured, KAN-460 Part 4).
  if (createSplit !== null) await splitRestoredPairs(createSplit, pairs, ids);

  if (request.activate) await bringForward(windowId, currentId);
  return {
    ids: ids.filter((id): id is number => id !== undefined),
    ...leftOutAnswer,
  };
}

// Null when the window is gone, or is a popup or app window: Chrome would put a tab created there in another window.
async function tabbedWindow(
  windowId: number
): Promise<chrome.windows.Window | null> {
  try {
    const win = await chrome.windows.get(windowId);
    return win.type === 'normal' ? win : null;
  } catch {
    return null;
  }
}

async function tabsInOrder(windowId: number): Promise<chrome.tabs.Tab[]> {
  return (await chrome.tabs.query({ windowId })).sort(
    (a, b) => a.index - b.index
  );
}

function withoutActiveTab(spec: WindowSpec): WindowSpec {
  const fallback = { ...spec };
  delete fallback.activeTabId;
  return fallback;
}

// Never throws: a refused activation or focus costs that, never the tabs.
async function bringForward(
  windowId: number,
  tabId: number | undefined
): Promise<void> {
  try {
    if (tabId !== undefined) await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  } catch (error) {
    console.warn('Could not bring the opened tabs forward:', error);
  }
}
