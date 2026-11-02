import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';
import { pinnedRunLength } from './pinnedRun';
import { isIncognitoAllowed, restoreSession } from './restoreSession';
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
}

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
    typeof candidate.pinTabKeeper === 'boolean'
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

// The created tab ids in merged order, refused ones left out. [] when the tabs went to new windows instead.
export async function openIntoWindow(
  request: OpenIntoWindowRequest
): Promise<number[]> {
  const { windowId, goToURLText, pinTabKeeper } = request;
  const inNewWindows = (specs: WindowSpec[]) =>
    restoreSession({
      type: RESTORE_SESSION_MESSAGE,
      specs,
      goToURLText,
      closeOtherWindows: false,
      pinTabKeeper,
    });

  const target = await tabbedWindow(windowId);
  if (target === null) {
    await inNewWindows(request.specs);
    return [];
  }
  const { into, apart } = splitByKind(
    request.specs,
    target.incognito,
    await isIncognitoAllowed()
  );
  if (apart.length > 0) await inNewWindows(apart);

  const { tabs, groups, targetIndex } = mergeForWindow(into);
  if (tabs.length === 0) return [];

  const createSplit = createSplitApi();
  const pairs = createSplit === null ? [] : splitPairs(tabs);
  const loadsPage = realPageIndexes(tabs, pairs).add(targetIndex);
  // Awaited before any create: a create issued as its fetch settles would land out of order.
  const icons = await Promise.all(
    tabs.map((tab, i) => (loadsPage.has(i) ? '' : placeholderIcon(tab)))
  );
  let pinnedSlot = pinnedRunLength(await tabsInOrder(windowId));
  const create = (tab: tabData, i: number) =>
    createRestoredTab(
      windowId,
      tab,
      restoredTabUrl(tab, loadsPage.has(i), icons[i], goToURLText),
      tab.pinned === true ? pinnedSlot++ : undefined
    );

  const [firstTab, ...restTabs] = tabs;
  const firstId = await create(firstTab, 0);
  // Refused with the window gone or unusable: new windows rather than not at all. Refused with it fine: that page alone is skipped.
  if (firstId === undefined && (await tabbedWindow(windowId)) === null) {
    await inNewWindows(into);
    return [];
  }
  // All at once: Chrome runs one extension's calls in order, so they land in order.
  const ids = [
    firstId,
    ...(await Promise.all(restTabs.map((tab, k) => create(tab, k + 1)))),
  ];

  // A refused saved active tab falls back as Open's does (retryAfterFailure, KAN-458).
  const currentIndex =
    ids[targetIndex] === undefined
      ? mergeForWindow(into.map(withoutActiveTab)).targetIndex
      : targetIndex;
  const currentId = ids[currentIndex];

  await applyTabGroups(windowId, groups, groupMembers(tabs, ids), {
    kind: 'saved',
    openTabId: currentId,
  });
  // Last of the tab steps: a move ends a split (measured, KAN-460 Part 4).
  if (createSplit !== null) await splitRestoredPairs(createSplit, pairs, ids);

  if (request.activate) await bringForward(windowId, currentId);
  return ids.filter((id): id is number => id !== undefined);
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
