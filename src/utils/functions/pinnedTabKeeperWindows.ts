// KAN-470 A. The windows holding a pinned Tab Keeper tab, kept by the worker, so an update can put the tabs back.
// Worker-safe. In chrome.storage.local: an update clears chrome.storage.session.
import { addPinnedStub, isTabKeeperTab } from './pinnedTabKeeper';

export const PINNED_TAB_KEEPER_WINDOWS_KEY = 'pinnedTabKeeperWindows';

// What Chrome leaves, pinned, in a window whose only tab was Tab Keeper's (measured 2026-10-09).
const NEW_TAB = 'chrome://newtab/';

const isIdList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'number');

const sameList = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

async function readRecorded(): Promise<unknown> {
  return (await chrome.storage.local.get(PINNED_TAB_KEEPER_WINDOWS_KEY))[
    PINNED_TAB_KEEPER_WINDOWS_KEY
  ];
}

// Written only when it changes: most tab events leave it as it was.
async function record(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const ids = [
    ...new Set(
      tabs.filter((t) => t.pinned && isTabKeeperTab(t)).map((t) => t.windowId)
    ),
  ].sort((a, b) => a - b);
  const was = await readRecorded();
  if (isIdList(was) && sameList(was, ids)) return;
  await chrome.storage.local.set({ [PINNED_TAB_KEEPER_WINDOWS_KEY]: ids });
}

// Measured: by onInstalled every Tab Keeper tab is closed and every window keeps its id.
async function restore(): Promise<void> {
  const was = await readRecorded();
  if (!isIdList(was) || was.length === 0) return;
  const open = new Set(
    (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((w) => w.id)
  );
  for (const windowId of was) {
    if (!open.has(windowId)) continue;
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.some((t) => t.pinned && isTabKeeperTab(t))) continue;
    await addPinnedStub(windowId);
    const standIns = tabs.filter((t) => t.pinned && t.url === NEW_TAB);
    for (const t of standIns) {
      if (t.id !== undefined) await chrome.tabs.remove(t.id);
    }
  }
}

// One queue, so the restore reads the record before any event can rewrite it.
export function keepPinnedTabKeeperWindows(): void {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work).catch((error: unknown) => {
      console.warn('Could not keep the pinned Tab Keeper windows:', error);
    });
  };
  const changed = () => enqueue(record);

  chrome.tabs.onCreated.addListener(changed);
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (change.pinned !== undefined || (change.url && tab.pinned)) changed();
  });
  chrome.tabs.onRemoved.addListener(changed);
  chrome.tabs.onAttached.addListener(changed);
  chrome.tabs.onReplaced.addListener(changed);
  chrome.windows.onRemoved.addListener(changed);
  chrome.runtime.onStartup.addListener(changed);
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') enqueue(restore);
    changed();
  });
  // No record at load: during an update that would overwrite the list before onInstalled reads it.
}
