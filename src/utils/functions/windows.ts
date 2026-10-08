import type {
  SavedWindowState,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { generatePlaceholderURL, resolveTabUrl } from './local';
import { sanitizeTabGroupColor } from './tabGroups';

// This module is imported by the service worker, so it must stay free of
// anything a worker does not have. In particular it must never reach for
// `window` -- utils/constants/common.ts derives its default window geometry
// from `window.screen`, which is why bounds arrive here already resolved
// rather than being defaulted in place.

// Where a restored window should be put. Null means "let Chrome decide",
// which is what a retry falls back to: if the first attempt failed, the
// bounds it was handed are the likeliest reason.
export interface WindowBounds {
  height: number;
  width: number;
  top: number;
  left: number;
}

// A group to recreate in a restored window. `groupId` is the saved uuid, used
// only to match tabs to their group; Chrome mints its own numeric id.
export interface TabGroupSpec {
  groupId: string;
  title: string;
  color: string;
  // KAN-460. Collapse it again after it is formed, when the caller's CollapseRule allows.
  collapsed?: true;
}

export interface WindowSpec {
  tabs: tabData[];
  focused: boolean;
  bounds: WindowBounds | null;
  // Absent, or empty, means there is nothing to group.
  groups?: TabGroupSpec[];
  // KAN-458. The saved tabId to open on; absent or naming no tab falls back (restoreTargetIndex).
  activeTabId?: string;
  // KAN-460. Applied last with windows.update: create refuses a state with bounds or unfocused.
  state?: SavedWindowState;
}

export const RESTORE_SESSION_MESSAGE = 'restore-session';

// What the popup hands the worker for ANY restore.
//
// Every restore runs here, not only focus mode's. The popup cannot do it
// itself for two reasons that compound: chrome.windows.create({focused: true})
// destroys the popup, and restoring tab groups needs the tab ids that arrive
// in chrome.tabs.create callbacks -- which is the first restore step that
// needs an answer back rather than fire-and-forget IPC.
//
// closeOtherWindows is the ONLY difference between focus mode and an ordinary
// open. Keeping it to one flag is what stops this collapsing back into two
// restore paths that drift.
export interface RestoreSessionRequest {
  type: typeof RESTORE_SESSION_MESSAGE;
  specs: WindowSpec[];
  goToURLText: string;
  closeOtherWindows: boolean;
  // KAN-459. Settings → Sessions → Pin Tab Keeper in new windows, as the page read it.
  pinTabKeeper: boolean;
}

export function isRestoreSessionRequest(
  message: unknown
): message is RestoreSessionRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  return (
    candidate.type === RESTORE_SESSION_MESSAGE &&
    Array.isArray(candidate.specs) &&
    typeof candidate.goToURLText === 'string' &&
    typeof candidate.closeOtherWindows === 'boolean' &&
    typeof candidate.pinTabKeeper === 'boolean'
  );
}

// KAN-458. The tab a restored window opens on: the saved active tab, else the first unpinned, else the first.
export function restoreTargetIndex(
  tabs: readonly tabData[],
  activeTabId: string | undefined
): number {
  const saved =
    activeTabId === undefined
      ? -1
      : tabs.findIndex((tab) => tab.tabId === activeTabId);
  if (saved !== -1) return saved;
  const firstUnpinned = tabs.findIndex((tab) => tab.pinned !== true);
  return firstUnpinned === -1 ? 0 : firstUnpinned;
}

// KAN-460. Which saved collapses a caller applies: none (a band's Open shows
// the group it opened), or each saved one except the group holding the tab the
// window opens on -- Chrome does not keep the active tab's group collapsed.
export type CollapseRule =
  { kind: 'none' } | { kind: 'saved'; openTabId: number | undefined };

const collapses = (
  rule: CollapseRule,
  group: TabGroupSpec,
  tabIds: readonly number[]
): boolean =>
  rule.kind === 'saved' &&
  group.collapsed === true &&
  (rule.openTabId === undefined || !tabIds.includes(rule.openTabId));

// Never throws: a refused collapse costs the collapse, never the group or the restore.
async function collapseRestoredGroup(groupId: number): Promise<void> {
  try {
    await chrome.tabGroups.update(groupId, { collapsed: true });
  } catch (error) {
    console.warn('Could not collapse a restored tab group:', error);
  }
}

// Recreate the saved groups in a window whose tabs now exist.
//
// Never throws, and never reports failure to the caller. Two reasons: the tabs
// are already open by the time this runs, so a restore that lost its groups is
// still a successful restore; and focus mode decides whether to close the
// user's windows from createWindowWithRetries' result, so letting a grouping
// error travel up that path could close windows whose replacements are fine.
// Exported so the right pane can re-form a saved group when the user opens one
// from a row, rather than a second implementation of "how to make a group"
// existing beside this one. The tabGroups feature-detection below is what makes
// it safe to call without a permission check at the call site.
export async function applyTabGroups(
  windowId: number,
  groups: TabGroupSpec[],
  tabIdsByGroupId: Map<string, number[]>,
  collapse: CollapseRule = { kind: 'none' }
): Promise<void> {
  // The namespace is undefined -- not throwing -- while the tabGroups
  // permission is ungranted, so this is feature detection, not try/catch.
  if (typeof chrome === 'undefined' || !chrome.tabGroups) return;

  for (const group of groups) {
    const tabIds = tabIdsByGroupId.get(group.groupId);
    if (!tabIds || tabIds.length === 0) continue;

    try {
      // Chrome's type declares tabIds as a non-empty tuple, not a plain
      // array; the length check above is what makes this destructure safe.
      const [firstTabId, ...restTabIds] = tabIds;
      const groupId = await chrome.tabs.group({
        createProperties: { windowId },
        tabIds: [firstTabId, ...restTabIds],
      });
      await chrome.tabGroups.update(groupId, {
        title: group.title,
        // An unrecognised colour costs this one group its colour, never the
        // restore. Chrome rejects a colour outside its enum.
        color: sanitizeTabGroupColor(group.color),
      });
      // Its own call, after the look: a refused collapse leaves the title and colour applied.
      if (collapses(collapse, group, tabIds)) {
        await collapseRestoredGroup(groupId);
      }
    } catch (error) {
      console.warn('Could not restore a tab group:', error);
    }
  }
}

// KAN-460, measured: Chrome can drop a state applied in a window's first 50ms; at 300ms it held 48/48 (data and http); no tab event tried marks when it is safe.
export const WINDOW_SETTLE_MS = 500;

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Resolves to the created window, or to null once the retries are spent.
// Returning a promise is the whole point: a callback that has not fired yet
// is indistinguishable from one that never will, so a caller that needs to
// know whether the restore actually happened -- as focus mode does, before it
// closes anything -- cannot be built on the callback form.
export function createWindowWithRetries(
  spec: WindowSpec,
  goToURLText: string,
  retryCount: number
): Promise<chrome.windows.Window | null> {
  if (retryCount <= 0 || spec.tabs.length === 0) {
    return Promise.resolve(null);
  }
  const targetIndex = restoreTargetIndex(spec.tabs, spec.activeTabId);

  return new Promise((resolve) => {
    chrome.windows.create(
      {
        // KAN-458. The window's first tab is the one that loads, so it is the target.
        url: resolveTabUrl(spec.tabs[targetIndex].url),
        focused: spec.focused,
        ...(spec.bounds ?? {}),
      },
      (newWindow) => {
        if (!newWindow) {
          resolve(
            retryAfterFailure(spec, targetIndex, goToURLText, retryCount)
          );
          return;
        }
        void fillRestoredWindow(
          newWindow,
          spec,
          targetIndex,
          goToURLText
        ).finally(() => resolve(newWindow));
      }
    );
  });
}

// Bounds are the likeliest cause, so they go first; then a refused saved active tab falls back once (KAN-458).
function retryAfterFailure(
  spec: WindowSpec,
  targetIndex: number,
  goToURLText: string,
  retryCount: number
): Promise<chrome.windows.Window | null> {
  if (retryCount > 1) {
    return createWindowWithRetries(
      { ...spec, bounds: null },
      goToURLText,
      retryCount - 1
    );
  }
  if (restoreTargetIndex(spec.tabs, undefined) === targetIndex) {
    return Promise.resolve(null);
  }
  // Spread, not picked: every other field, today's and future ones, survives the retry.
  const fallback: WindowSpec = { ...spec, bounds: null };
  delete fallback.activeTabId;
  return createWindowWithRetries(fallback, goToURLText, 1);
}

// Every tab but the target is a placeholder the worker swaps for its page on activation (placeholderTarget, KAN-250).
async function fillRestoredWindow(
  newWindow: chrome.windows.Window,
  spec: WindowSpec,
  targetIndex: number,
  goToURLText: string
): Promise<void> {
  const windowId = newWindow.id;
  if (windowId === undefined) return;

  // Counted from create, so the time spent on tabs and groups counts toward the window's age.
  const oldEnough =
    spec.state === undefined ? undefined : wait(WINDOW_SETTLE_MS);
  const targetId = newWindow.tabs?.[0]?.id;
  // Pinned before any create so later pinned tabs queue behind it; a refused pin (never seen) would also cost order.
  if (spec.tabs[targetIndex].pinned === true && targetId !== undefined) {
    await pinRestoredTab(targetId);
  }

  // All at once: Chrome runs one extension's calls in order, so index i lands each earlier tab before the target.
  const ids = await Promise.all(
    spec.tabs.map((tabInfo, i) =>
      i === targetIndex
        ? targetId
        : createPlaceholderTab(
            windowId,
            tabInfo,
            goToURLText,
            i < targetIndex ? i : undefined
          )
    )
  );

  // A refused earlier tab leaves the ones after it past the target, so the target moves after them.
  const targetSlot = ids
    .slice(0, targetIndex)
    .filter((id) => id !== undefined).length;
  if (targetSlot !== targetIndex && targetId !== undefined) {
    await moveRestoredTab(targetId, targetSlot);
  }

  if (spec.groups && spec.groups.length > 0) {
    await applyTabGroups(windowId, spec.groups, groupMembers(spec.tabs, ids), {
      kind: 'saved',
      openTabId: targetId,
    });
  }

  if (spec.state !== undefined) {
    await oldEnough;
    await applySavedWindowState(windowId, spec.state);
    await confirmSavedWindowState(windowId, spec.state);
  }
}

// Never throws: a refused state costs the state, never the restore.
async function applySavedWindowState(
  windowId: number,
  state: SavedWindowState
): Promise<void> {
  try {
    await chrome.windows.update(windowId, { state });
  } catch (error) {
    console.warn('Could not restore a window state:', error);
  }
}

// Reads the state back once more, and applies it once more if Chrome dropped it anyway (measured: 0 of 48 needed it). Never throws.
async function confirmSavedWindowState(
  windowId: number,
  state: SavedWindowState
): Promise<void> {
  await wait(WINDOW_SETTLE_MS);
  try {
    if ((await chrome.windows.get(windowId)).state !== state) {
      await chrome.windows.update(windowId, { state });
    }
  } catch (error) {
    console.warn('Could not confirm a restored window state:', error);
  }
}

// Resolves to the new tab's id, or undefined when Chrome refused it: that tab is skipped, never the restore.
function createPlaceholderTab(
  windowId: number,
  tabInfo: tabData,
  goToURLText: string,
  index: number | undefined
): Promise<number | undefined> {
  return new Promise((done) => {
    chrome.tabs.create(
      {
        windowId,
        url: generatePlaceholderURL(
          tabInfo.title,
          tabInfo.favicon || '/images/favicon.ico',
          resolveTabUrl(tabInfo.url),
          goToURLText
        ),
        active: false,
        ...(tabInfo.pinned === true ? { pinned: true } : {}),
        ...(index === undefined ? {} : { index }),
      },
      (created) => done(created?.id)
    );
  });
}

// Never throws: a pin Chrome refuses costs the pin, never the restore.
async function pinRestoredTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { pinned: true });
  } catch (error) {
    console.warn('Could not pin a restored tab:', error);
  }
}

// Never throws: a move Chrome refuses costs the target its place, never the restore.
async function moveRestoredTab(tabId: number, index: number): Promise<void> {
  try {
    await chrome.tabs.move(tabId, { index });
  } catch (error) {
    console.warn('Could not place the restored active tab:', error);
  }
}

// Ids by saved group, in saved order: the target was created first, but it is not first in its group.
function groupMembers(
  tabs: readonly tabData[],
  ids: readonly (number | undefined)[]
): Map<string, number[]> {
  const members = new Map<string, number[]>();
  tabs.forEach((tab, i) => {
    const id = ids[i];
    if (id === undefined || tab.chromeGroupId === undefined) return;
    members.set(tab.chromeGroupId, [
      ...(members.get(tab.chromeGroupId) ?? []),
      id,
    ]);
  });
  return members;
}

// Decides which windows focus mode may close, given the windows that were
// open before the restore and the outcome of every window it tried to create.
//
// Returns null to mean "close nothing". That is the answer whenever any
// window failed, because the alternative is the one outcome focus mode must
// never produce: the originals gone and the replacements missing. Chrome
// reopens closed windows one at a time, so a wrong answer here is not
// something the user can undo.
export function planWindowClosure(
  snapshotIds: number[],
  createdWindows: (chrome.windows.Window | null)[]
): number[] | null {
  if (createdWindows.length === 0) return null;

  const createdIds = new Set<number>();
  for (const created of createdWindows) {
    if (!created || created.id === undefined) return null;
    createdIds.add(created.id);
  }

  // The snapshot is taken before any window is created, so it cannot already
  // contain one of these ids. Filtering anyway makes that an enforced
  // invariant rather than an assumption about the caller.
  return snapshotIds.filter((id) => !createdIds.has(id));
}
