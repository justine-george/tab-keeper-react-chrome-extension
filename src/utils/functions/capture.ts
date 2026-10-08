import { v4 as uuidv4 } from 'uuid';

import { getStringDate, isLazyPlaceholder, resolveTabUrl } from './local';
import { readRecentTabs } from './recentTabs';
import { dropNotificationCount } from './sessionExportHtml';
import { hasTabGroupsPermission } from './permissions';
import type { chromeTabGroupData } from './tabGroups';
import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

// A window reduced to what decides whether it is already saved: each tab's URL and pin, in order.
// A pin is content (KAN-458); the active tab is not, or every Switch would save a copy.
// JSON rather than a join, so a URL containing a separator cannot forge another window's signature.
function windowSignatures(windows: windowGroupData[]): string[] {
  return windows
    .map((window) =>
      JSON.stringify(window.tabs.map((tab) => [tab.url, tab.pinned === true]))
    )
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
// `granted` lets one capture make ONE permission decision for every window it
// covers, rather than one per window: captureOpenWindows checks once before
// its loop and passes the result into every call, so a permission revoked
// mid-loop cannot produce a single saved session where some windows carry
// chromeTabGroups and others silently do not -- the whole point of this
// feature's all-or-nothing rule. A caller with only one window
// (HeroContainerRight) omits it, and this checks for itself, so there is
// still exactly one place a permission decision is made from.
//
// Returns null when there is nothing to store -- no permission, no groups, or
// a query that failed -- which the caller writes as an absent field rather
// than an empty array, so a window with no groups is byte-identical to one
// saved before this feature existed.
export async function readCurrentWindowGroups(
  windowId: number | undefined,
  granted?: boolean
): Promise<{
  groups: chromeTabGroupData[];
  idByChromeId: Map<number, string>;
} | null> {
  if (windowId === undefined) return null;
  // In PRODUCTION this namespace check is the gate: chrome.tabGroups is
  // genuinely undefined while the permission is ungranted, so real Chrome
  // never reaches the permission check below without it already having
  // returned null here.
  if (typeof chrome === 'undefined' || !chrome.tabGroups) return null;
  // This is a deliberate defensive duplicate of the check above, not the
  // production gate -- it does independent work in two narrower cases: the
  // test fake, which exposes chrome.tabGroups unconditionally regardless of
  // grantedPermissions (see chrome.fake.ts's own header: it widens API
  // fidelity for the surface itself, not gating that surface on the
  // permission), and a permission revoked in the gap between the namespace
  // check above and the query() call below -- which the try/catch around
  // that call also covers.
  const hasPermission = granted ?? (await hasTabGroupsPermission());
  if (!hasPermission) return null;

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
      // KAN-460. Absent when open, so an uncollapsed group is stored as before.
      ...(group.collapsed ? { collapsed: true as const } : {}),
    };
  });

  return { groups, idByChromeId };
}

// KAN-458. Absent, never false: an unpinned tab costs nothing in the document.
const pinnedField = (pinned: boolean): Pick<tabData, 'pinned'> =>
  pinned ? { pinned: true } : {};

/**
 * A live Chrome tab in storage shape (KAN-211).
 *
 * ONE definition of how a tab becomes a saved tab, because there are three
 * places that make one -- a whole-window capture, "add current tab to this
 * window", and "add current tab to this group" -- and before this they were
 * three byte-identical literals that had to be kept in step by hand. KAN-210
 * is what that costs: the same shape written twice, one copy missing a
 * clean-up, and the two quietly disagreeing.
 *
 * Both fields are NORMALISED rather than stored as Chrome reports them:
 *
 * - the address is unwrapped, so a tab a suspender put to sleep is saved as
 *   the page it stands for. Without it, uninstalling that suspender turns
 *   every such saved tab into a dead chrome-extension:// address.
 * - the title loses a leading unread count. "(3) Gmail" is a fact about the
 *   tab at this instant; stored, it is stale immediately.
 *
 * `chromeGroupId` is the caller's to add: only a window capture knows the
 * mapping from Chrome's numeric ids to ours.
 */
export function toStoredTab(
  tab: Pick<chrome.tabs.Tab, 'favIconUrl' | 'title' | 'url' | 'pinned'>
): tabData {
  return {
    tabId: uuidv4(),
    favicon: tab.favIconUrl || '',
    title: dropNotificationCount(tab.title || ''),
    url: resolveTabUrl(tab.url || ''),
    ...pinnedField(tab.pinned),
  };
}

// KAN-458 A4. `tabs` leave out Tab Keeper's pages, so none active means one was: then the latest activated tab still here.
export function pickActiveTabIndex(
  tabs: readonly {
    id?: number;
    active: boolean;
    lastAccessed?: number;
    url?: string;
    pendingUrl?: string;
  }[],
  recentTabIds: readonly number[]
): number | undefined {
  const active = tabs.findIndex((tab) => tab.active);
  if (active !== -1) return active;
  for (const tabId of recentTabIds) {
    const recent = tabs.findIndex((tab) => tab.id === tabId);
    if (recent !== -1) return recent;
  }
  // No recorded tab here: Chrome stamps lastAccessed at creation, so a never-opened placeholder would outrank the tab in use.
  let picked: number | undefined;
  let latest = 0;
  tabs.forEach((tab, index) => {
    const at = tab.lastAccessed ?? 0;
    if (at > latest && !isLazyPlaceholder(tab.url || tab.pendingUrl || '')) {
      picked = index;
      latest = at;
    }
  });
  return picked;
}

// One window in storage shape. Extracted so "add current window to a session"
// (HeroContainerRight) cannot drift from the session save -- capture.ts's
// header already records why two captures that drift are a problem, and a
// dropped group is exactly that failure in miniature.
//
// Saved unnamed: the list draws it as "Window N" (KAN-394 L4).
export function toWindowGroupData(
  window: chrome.windows.Window,
  groups: chromeTabGroupData[] | undefined,
  idByChromeId: Map<number, string>,
  recentTabIds: readonly number[]
): windowGroupData {
  const tabsData = (window.tabs ?? []).map((tab) => {
    const chromeGroupId =
      tab.groupId === undefined ? undefined : idByChromeId.get(tab.groupId);
    return {
      ...toStoredTab(tab),
      // Absent, never null: an ungrouped tab costs zero bytes in the document,
      // and ungrouped is the common case.
      ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
    };
  });
  const activeIndex = pickActiveTabIndex(window.tabs ?? [], recentTabIds);

  return {
    windowId: uuidv4(),
    windowHeight: window.height ?? 0,
    windowWidth: window.width ?? 0,
    windowOffsetTop: window.top ?? 0,
    windowOffsetLeft: window.left ?? 0,
    tabCount: tabsData.length,
    title: '',
    tabs: tabsData,
    ...(groups && groups.length > 0 ? { chromeTabGroups: groups } : {}),
    ...(activeIndex === undefined
      ? {}
      : { activeTabId: tabsData[activeIndex].tabId }),
  };
}

/**
 * Whether a tab is a page this extension put in the tabs strip itself --
 * `index.html`, in either view, or `export.html` -- rather than something the
 * user navigated to (KAN-300).
 *
 * Checked by ADDRESS, not id. KAN-208 originally excluded only the calling
 * page's own tab id from a capture, deliberately leaving a SECOND Tab Keeper
 * page (a genuinely open export tab, say) to still appear -- right before the
 * tab view existed to make restoring one meaningful. The tab view is now
 * long-lived and pinnable, and restoring a captured tab view would open
 * exactly the duplicate D4 exists to forbid. So every Tab Keeper page is
 * excluded now, from every capture, whoever is asking -- the popup's saves,
 * the tab view's saves, and Switch's auto-save alike.
 *
 * `pendingUrl` is checked too, not just `url`: a tab mid-navigation to a Tab
 * Keeper page has not committed `url` yet -- Chrome's own type says `url` "may
 * be an empty string if the tab has not yet committed", not undefined, so
 * this falls through on EMPTY as well as absent (`||`, not `??`).
 *
 * The address is RESOLVED (resolveTabUrl) before the check, not read raw.
 * A lazy-load placeholder (local.ts's `data:` document) does not match the
 * raw prefix, which is right for a page that has never loaded -- but an
 * OLDER session, saved
 * before this rule existed, could have stored a Tab Keeper URL as an
 * ordinary tab; lazy-loading it later wraps THAT url in exactly this kind of
 * placeholder. `toStoredTab` already resolves before storing, so an
 * unresolved check here would pass the placeholder through and then store it
 * as the extension's own address anyway -- resolving here first is what
 * keeps the two in agreement. resolveTabUrl is a no-op on every address that
 * is not one of its own wrapper shapes, so this changes nothing for a normal
 * page, a suspended tab, or a genuinely unloaded placeholder.
 */
export function isTabKeeperPage(tab: chrome.tabs.Tab): boolean {
  const address = tab.url || tab.pendingUrl || '';
  return resolveTabUrl(address).startsWith(chrome.runtime.getURL(''));
}

const NAME_SOURCE_NOISE = [
  'https://chromewebstore.google.com/',
  'https://chrome.google.com/webstore',
  'chrome://newtab/',
  'chrome://new-tab-page/',
] as const;

// §8. The Web Store and the New Tab page never name a session.
export function isNameSourceNoise(tab: chrome.tabs.Tab): boolean {
  const address = tab.url || tab.pendingUrl || '';
  return NAME_SOURCE_NOISE.some((prefix) => address.startsWith(prefix));
}

// A name comes from neither Tab Keeper's own pages nor the store or New Tab page.
export const isNotANameSource = (tab: chrome.tabs.Tab): boolean =>
  isTabKeeperPage(tab) || isNameSourceNoise(tab);

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

  // One decision for the whole capture, not one per window -- see
  // readCurrentWindowGroups's header for why a per-window check would be
  // wrong.
  const granted = await hasTabGroupsPermission();
  const recentTabsOf = await readRecentTabs(
    windowList.flatMap((window) => (window.id === undefined ? [] : [window.id]))
  );

  const windowsGroupData: windowGroupData[] = [];
  let tabCount = 0;

  for (const window of windowList) {
    // KAN-300. No option to opt out of this any more: every caller wants
    // every Tab Keeper page left out, so there is nothing left for a caller
    // to configure.
    const tabs = (window.tabs ?? []).filter((tab) => !isTabKeeperPage(tab));
    if (tabs.length === 0) continue;

    const read = await readCurrentWindowGroups(window.id, granted);
    const windowGroup = toWindowGroupData(
      { ...window, tabs },
      read?.groups,
      read?.idByChromeId ?? new Map(),
      recentTabsOf(window.id)
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

// Q3. Whether a save now would capture anything: a tab outside Tab Keeper's own pages.
export async function hasTabsToSave(): Promise<boolean> {
  const windows = await windowsInScope('all-windows');
  return windows.some((window) =>
    (window.tabs ?? []).some((tab) => !isTabKeeperPage(tab))
  );
}
