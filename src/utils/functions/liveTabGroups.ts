// Reading Chrome's LIVE tab groups -- the ones open in the browser right now.
//
// Distinct from tabGroups.ts, which is about groups already SAVED into a
// session and keyed by the uuid minted at capture. Nothing here touches stored
// data; nothing there touches the browser.
//
// This module exists because of one measured fact: `Tab.groupId` is NOT
// privileged. It arrives on every tab from `chrome.tabs.query` whether or not
// the optional "tabGroups" permission has been granted. Only a group's title
// and colour need the grant. So membership can be COUNTED without permission,
// which is what lets KAN-74 offer the feature to the users who would actually
// benefit rather than to everyone.
//
// Measured 2026-09-04 by revoking the permission mid-session and re-querying:
// contains({tabGroups}) returned false while chrome.tabs.query still reported
// groupId 801893355 on the grouped tabs.

// Chrome's own name for this value is chrome.tabGroups.TAB_GROUP_ID_NONE, and
// it is deliberately NOT used here: `chrome.tabGroups` is undefined while the
// permission is ungranted, so reading the constant off it would throw in
// exactly the case this module is built for. The numeric value is stable
// platform API.
const UNGROUPED = -1;

// How many distinct tab groups are open across ALL windows.
//
// Distinct, not total: two tabs in one group is one group. All windows, not
// the current one: the offer this feeds is about the feature in general, not
// about a particular window the user happens to be looking at.
//
// Returns 0 rather than throwing on any failure. The only caller uses this to
// decide whether to show an offer, and "could not tell" and "none" lead to the
// same correct behaviour there -- stay quiet. Rejecting instead would put an
// unhandled rejection in App's mount effect.
export async function countOpenTabGroups(): Promise<number> {
  let tabs: chrome.tabs.Tab[];
  try {
    // The try is the ONLY gate, deliberately. The sibling modules open with a
    // `typeof chrome === 'undefined' || !chrome.x` guard, and one here would
    // be unreachable decoration: a missing `chrome` or `chrome.tabs` throws on
    // this very line and lands in the catch below with the same result. It was
    // written, mutation-tested, found to be un-killable, and removed rather
    // than left as a line no test can hold to account.
    tabs = await chrome.tabs.query({});
  } catch {
    return 0;
  }

  const groupIds = new Set<number>();
  for (const tab of tabs) {
    // `undefined` is not a group id. Chrome types groupId as required, but a
    // tab that arrives without one must not become a group of its own -- the
    // Set would otherwise take `undefined` as a distinct key.
    if (tab.groupId === undefined) continue;
    if (tab.groupId === UNGROUPED) continue;
    groupIds.add(tab.groupId);
  }

  return groupIds.size;
}
