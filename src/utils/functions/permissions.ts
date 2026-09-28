// The "tabGroups" and "sessions" permissions -- and, within each function
// pair, only that one permission.
//
// tabGroups is OPTIONAL rather than required because it is warning-bearing
// ("View and manage your tab groups"): adding it to manifest `permissions`
// would leave the extension disabled for every existing install until each
// user clicked through a prompt, which for a sync tool means sync silently
// stopping for people who never asked for tab groups.
//
// sessions is optional for a different reason: it carries NO warning (spec
// O9), so there is no install-time cost to weigh -- it is simply off by
// default like every optional permission. Measured 2026-09-27: requesting it
// shows no Chrome prompt at all, and a real popup survives the request every
// time (unlike tabGroups.request, below).

const TAB_GROUPS: chrome.permissions.Permissions = {
  permissions: ['tabGroups'],
};

const SESSIONS: chrome.permissions.Permissions = {
  permissions: ['sessions'],
};

// Whether the profile holds the grant right now.
//
// This is the ONLY source of truth. No stored boolean mirrors it: Chrome holds
// the grant, and another Tab Keeper page (the popup and the tab view share it)
// can give it back while this one is closed, so a mirror could disagree with
// reality. chrome://extensions itself has no control for removing one API
// permission (measured 2026-09-27: only on/off, pin, incognito and file URLs).
export async function hasTabGroupsPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return false;
  try {
    return await chrome.permissions.contains(TAB_GROUPS);
  } catch {
    return false;
  }
}

// Ask for the grant. Returns NOTHING, on purpose.
//
// Measured against a real popup: chrome.permissions.request() destroyed the
// popup outright in one run, and in another left the promise pending
// indefinitely while the native prompt waited for a decision. Popup survival
// is a coin flip and the promise settled in neither run, so any caller
// awaiting it is broken half the time. The outcome is learned from
// hasTabGroupsPermission() on the next popup open, or from
// observeTabGroupsPermission() if this context happens to survive.
export function requestTabGroupsPermission(): void {
  if (typeof chrome === 'undefined' || !chrome.permissions) return;
  // Errors are swallowed rather than surfaced: a rejection here is
  // indistinguishable from the user declining, and there is no popup
  // guaranteed alive to show a message in either case.
  void Promise.resolve(chrome.permissions.request(TAB_GROUPS)).catch(() => {});
}

export function removeTabGroupsPermission(): void {
  if (typeof chrome === 'undefined' || !chrome.permissions) return;
  void Promise.resolve(chrome.permissions.remove(TAB_GROUPS)).catch(() => {});
}

// Fires whenever the grant changes while this context is alive. Both halves
// are wired: the Settings toggle in another Tab Keeper page can give the
// grant back just as it can ask for it.
export function observeTabGroupsPermission(
  onChange: (granted: boolean) => void
): void {
  if (typeof chrome === 'undefined' || !chrome.permissions) return;
  chrome.permissions.onAdded.addListener((permissions) => {
    if (permissions.permissions?.includes('tabGroups')) onChange(true);
  });
  chrome.permissions.onRemoved.addListener((permissions) => {
    if (permissions.permissions?.includes('tabGroups')) onChange(false);
  });
}

// Whether the profile holds the grant right now. The only source of truth,
// same as hasTabGroupsPermission -- and for the same reason `typeof
// chrome.sessions` cannot stand in for it: measured 2026-09-27, after a
// revoke chrome.sessions stays DEFINED in a live page but every call on it
// throws, so its mere presence proves nothing about the grant.
export async function hasSessionsPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return false;
  try {
    return await chrome.permissions.contains(SESSIONS);
  } catch {
    return false;
  }
}

// Ask for the grant. Returns NOTHING, on purpose, matching
// requestTabGroupsPermission -- Chrome shows no prompt for `sessions`, but the
// outcome still arrives through hasSessionsPermission() or
// observeSessionsPermission() rather than this call, so callers never await a
// promise that might not settle.
export function requestSessionsPermission(): void {
  if (typeof chrome === 'undefined' || !chrome.permissions) return;
  void Promise.resolve(chrome.permissions.request(SESSIONS)).catch(() => {});
}

export function removeSessionsPermission(): void {
  if (typeof chrome === 'undefined' || !chrome.permissions) return;
  void Promise.resolve(chrome.permissions.remove(SESSIONS)).catch(() => {});
}

export function observeSessionsPermission(
  onChange: (granted: boolean) => void
): void {
  if (typeof chrome === 'undefined' || !chrome.permissions) return;
  chrome.permissions.onAdded.addListener((permissions) => {
    if (permissions.permissions?.includes('sessions')) onChange(true);
  });
  chrome.permissions.onRemoved.addListener((permissions) => {
    if (permissions.permissions?.includes('sessions')) onChange(false);
  });
}
