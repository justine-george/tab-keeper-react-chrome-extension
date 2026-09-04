// The "tabGroups" permission, and only that permission.
//
// It is OPTIONAL rather than required because it is warning-bearing ("View and
// manage your tab groups"): adding it to manifest `permissions` would leave
// the extension disabled for every existing install until each user clicked
// through a prompt, which for a sync tool means sync silently stopping for
// people who never asked for tab groups.

const TAB_GROUPS: chrome.permissions.Permissions = {
  permissions: ['tabGroups'],
};

// Whether the profile holds the grant right now.
//
// This is the ONLY source of truth. No stored boolean mirrors it: the user can
// revoke from chrome://extensions while the extension is not running, and a
// mirror would then disagree with reality.
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
// are wired: a user can revoke from chrome://extensions just as easily as they
// can grant from the settings toggle.
export function observeTabGroupsPermission(
  onChange: (granted: boolean) => void
): void {
  if (typeof chrome === 'undefined' || !chrome.permissions) return;
  chrome.permissions.onAdded.addListener(() => onChange(true));
  chrome.permissions.onRemoved.addListener(() => onChange(false));
}
