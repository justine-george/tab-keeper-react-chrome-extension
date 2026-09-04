import { v4 as uuidv4 } from 'uuid';

import { getStringDate, resolveTabUrl } from './local';
import { hasTabGroupsPermission } from './permissions';
import type { chromeTabGroupData } from './tabGroups';
import type {
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// A window reduced to the thing that decides whether it is already saved: the
// URLs it holds, in order. JSON rather than a join so that a URL containing
// the separator cannot forge a different window's signature.
function windowSignatures(windows: windowGroupData[]): string[] {
  return windows
    .map((window) => JSON.stringify(window.tabs.map((tab) => tab.url)))
    .sort();
}

// Whether what is open right now is already stored as one of these sessions.
//
// Focus mode uses this to avoid saving a duplicate: switching back and forth
// between two sessions would otherwise mint a near-copy of one of them on
// every switch, since the windows it is about to close are the ones it just
// restored.
//
// The comparison is deliberately strict -- same window count, same URLs, same
// order within each window. Anything less exact counts as unsaved work, so the
// only way to be wrong is to save a session that was not strictly needed.
// Getting it wrong the other way would discard the user's windows.
//
// Window order is ignored because chrome.windows.getAll does not promise one.
export function isAlreadySaved(
  captured: tabContainerData,
  sessions: tabContainerData[]
): boolean {
  const target = windowSignatures(captured.windows);

  return sessions.some((session) => {
    const candidate = windowSignatures(session.windows);
    return (
      candidate.length === target.length &&
      candidate.every((signature, index) => signature === target[index])
    );
  });
}

// How much of the browser a capture covers.
//
// The save row offers both, so this is the caller's word rather than a
// preference capture reads for itself: focus mode saves through here
// immediately before background.ts closes every normal window, and a scope it
// did not ask for would make it close windows it never saved.
export type CaptureScope = 'all-windows' | 'current-window';

// The chrome windows a scope covers, current window first.
//
// Returns an empty list when the scope covers nothing, which
// captureOpenWindows already treats as "nothing to capture".
async function windowsInScope(
  scope: CaptureScope
): Promise<chrome.windows.Window[]> {
  const currentWindow = await new Promise<chrome.windows.Window>((resolve) =>
    chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
  );

  // getCurrent is deliberately left unfiltered - filtering the query would
  // leave no way to tell "the current window is a popup" from "there is no
  // current window" - so the type is checked here instead (KAN-50).
  const isCurrentNormal = currentWindow?.type === 'normal';

  // No current normal window means this scope covers nothing. Falling back to
  // every window is the one answer it must never give: the user asked for one
  // window, and all of them is the same mistake in miniature that wiring focus
  // mode to this scope would make in full.
  if (scope === 'current-window') {
    return isCurrentNormal ? [currentWindow] : [];
  }

  // Normal windows only. Omitting windowTypes gets Chrome's default of
  // ['normal', 'popup'], which is what focus mode's close (background.ts) and
  // its count (requestFocusTabContainer) never used -- so a popup was saved
  // into the session, left open, and missing from the "will be closed" count.
  //
  // Nothing is lost by dropping them: a windowGroupData records windowId,
  // geometry, tabCount, title and tabs, and no window type, so a captured
  // popup already came back from a restore as an ordinary window.
  const allWindows = await new Promise<chrome.windows.Window[]>((resolve) =>
    chrome.windows.getAll(
      { populate: true, windowTypes: ['normal'] },
      (result) => resolve(result)
    )
  );

  // Current window first, so a restore reopens the user's focus where it was.
  // Without the type check above, this unshift would put a popup back after
  // getAll had excluded it.
  const windowList = allWindows.filter(
    (window) => window.id !== currentWindow?.id
  );
  if (isCurrentNormal) {
    windowList.unshift(currentWindow);
  }
  return windowList;
}

// Chrome's groups for one window, converted to storage shape.
//
// Returns null when there is nothing to store -- no permission, no groups, or
// a query that failed -- which the caller writes as an absent field rather
// than an empty array, so a window with no groups is byte-identical to one
// saved before this feature existed.
export async function readCurrentWindowGroups(
  windowId: number | undefined
): Promise<{
  groups: chromeTabGroupData[];
  idByChromeId: Map<number, string>;
} | null> {
  if (windowId === undefined) return null;
  // The namespace is undefined -- not throwing -- while the permission is
  // ungranted, so this is a feature detection rather than a try/catch.
  if (typeof chrome === 'undefined' || !chrome.tabGroups) return null;
  // The namespace check above is belt-and-braces for real Chrome, where the
  // namespace is genuinely undefined while ungranted. The test fake exposes
  // chrome.tabGroups unconditionally (see chrome.fake.ts's own header: it
  // widens API fidelity for the surface itself, not gating that surface on
  // grantedPermissions), so the actual gate -- here and in production -- is
  // this explicit permission check.
  if (!(await hasTabGroupsPermission())) return null;

  let found: chrome.tabGroups.TabGroup[];
  try {
    found = await chrome.tabGroups.query({ windowId });
  } catch {
    // A revoked permission mid-capture lands here. Saving the session without
    // groups beats failing the save.
    return null;
  }
  if (found.length === 0) return null;

  const idByChromeId = new Map<number, string>();
  const groups = found.map((group) => {
    const groupId = uuidv4();
    idByChromeId.set(group.id, groupId);
    return {
      groupId,
      // Chrome types title as string | undefined; normalising here keeps the
      // stored type `string` and gives the empty case one representation.
      title: group.title ?? '',
      color: group.color,
    };
  });

  return { groups, idByChromeId };
}

// One window in storage shape. Extracted so "add current window to a session"
// (HeroContainerRight) cannot drift from the session save -- capture.ts's
// header already records why two captures that drift are a problem, and a
// dropped group is exactly that failure in miniature.
export function toWindowGroupData(
  window: chrome.windows.Window,
  title: string,
  groups: chromeTabGroupData[] | undefined,
  idByChromeId: Map<number, string>
): windowGroupData {
  const tabsData = (window.tabs ?? []).map((tab) => {
    const chromeGroupId =
      tab.groupId === undefined ? undefined : idByChromeId.get(tab.groupId);
    return {
      tabId: uuidv4(),
      favicon: tab.favIconUrl || '',
      title: tab.title || '',
      url: resolveTabUrl(tab.url || ''),
      // Absent, never null: an ungrouped tab costs zero bytes in the document,
      // and ungrouped is the common case.
      ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
    };
  });

  return {
    windowId: uuidv4(),
    windowHeight: window.height ?? 0,
    windowWidth: window.width ?? 0,
    windowOffsetTop: window.top ?? 0,
    windowOffsetLeft: window.left ?? 0,
    tabCount: tabsData.length,
    title,
    tabs: tabsData,
    ...(groups && groups.length > 0 ? { chromeTabGroups: groups } : {}),
  };
}

// Snapshots the open windows a scope covers as a session. Extracted from
// UserInputContainer so focus mode can save what it is about to close using
// exactly the same capture the "Save current session" button uses -- two
// captures that drifted apart would mean focus mode quietly saved something
// less faithful than the session the user could have saved by hand.
//
// `scope` has no default on purpose. A default would let focus mode inherit
// whatever it happened to be, and would let a new scope-aware caller compile
// without the type checker ever pointing at the two call sites where the wrong
// scope closes unsaved windows.
//
// Returns null when there is nothing to capture, which is the caller's cue
// that there is no session to save rather than an empty one to create.
export async function captureOpenWindows(
  title: string,
  scope: CaptureScope
): Promise<tabContainerData | null> {
  const windowList = await windowsInScope(scope);

  const windowsGroupData: windowGroupData[] = [];
  let tabCount = 0;

  for (const window of windowList) {
    if (!window.tabs || window.tabs.length === 0) continue;

    const read = await readCurrentWindowGroups(window.id);
    const windowGroup = toWindowGroupData(
      window,
      window.tabs[0].title || '',
      read?.groups,
      read?.idByChromeId ?? new Map()
    );

    tabCount += windowGroup.tabCount;
    windowsGroupData.push(windowGroup);
  }

  if (windowsGroupData.length === 0) return null;

  // One `now` for both: read the clock twice and a capture that straddles a
  // second boundary writes a display string and an instant that disagree.
  const now = new Date();

  return {
    tabGroupId: uuidv4(),
    title,
    createdTime: getStringDate(now),
    createdAt: now.getTime(),
    windowCount: windowsGroupData.length,
    tabCount,
    isAutoSave: false,
    isSelected: true,
    windows: windowsGroupData,
  };
}
