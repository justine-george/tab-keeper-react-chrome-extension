import {
  addPinnedStub,
  carryPinnedTab,
  findCarriedTab,
} from './pinnedTabKeeper';
import {
  createWindowWithRetries,
  planWindowClosure,
  type RestoreSessionRequest,
} from './windows';

// Every restore runs in the worker (see RestoreSessionRequest): the popup dies when the first window takes focus.
// Switch is this plus closeOtherWindows; the page saved what it closes before sending.
export async function restoreSession(
  request: RestoreSessionRequest
): Promise<void> {
  const before = request.closeOtherWindows
    ? await chrome.windows.getAll({ windowTypes: ['normal'], populate: true })
    : [];
  const snapshotIds = before
    .map((win) => win.id)
    .filter((id): id is number => id !== undefined);
  const carried = request.closeOtherWindows
    ? findCarriedTab(before, await lastFocusedWindowId())
    : null;

  const created = await Promise.all(
    request.specs.map((spec) =>
      createWindowWithRetries(spec, request.goToURLText, 2)
    )
  );
  const target =
    created[request.specs.findIndex((spec) => spec.focused)] ?? null;

  // The focused window is left for the carried tab.
  if (request.pinTabKeeper) {
    for (const win of created) {
      if (win?.id === undefined) continue;
      if (carried !== null && win === target) continue;
      await addPinnedStub(win.id);
    }
  }

  if (!request.closeOtherWindows) return;

  // Null: a window never opened. Closing nothing costs a tidy-up; the alternative costs the user's browser state.
  const toClose = planWindowClosure(snapshotIds, created);
  if (!toClose) return;

  // P4: a pinned Tab Keeper tab is never closed by a Switch, so with nowhere to carry it, its window stays.
  let keepOpen: number | undefined;
  if (carried !== null) {
    if (target?.id === undefined) {
      keepOpen = carried.windowId;
    } else if (!(await carryPinnedTab(carried.id, target.id))) {
      keepOpen = carried.windowId;
      if (request.pinTabKeeper) await addPinnedStub(target.id);
    }
  }

  toClose
    .filter((id) => id !== keepOpen)
    .forEach((id) =>
      chrome.windows.remove(id, () => {
        // A window the user closed meanwhile sets lastError; reading it keeps it from being logged.
        void chrome.runtime.lastError;
      })
    );
}

async function lastFocusedWindowId(): Promise<number | undefined> {
  try {
    return (await chrome.windows.getLastFocused()).id;
  } catch {
    return undefined;
  }
}
