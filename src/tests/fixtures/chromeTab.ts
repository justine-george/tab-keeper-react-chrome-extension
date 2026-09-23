// A typed builder for a seeded chrome.tabs.Tab, in place of `as
// chrome.tabs.Tab[]`: @types/chrome marks index/pinned/highlighted/windowId/
// active/frozen/incognito/selected/discarded/autoDiscardable/groupId/
// lastAccessed as required, so a seed literal naming only id/url/title is
// missing fields a cast would have hidden rather than filled. windowId
// defaults to 1 -- DEFAULT_WINDOW_ID in chrome.fake.ts -- since most seeds
// place every tab in window 1; override it for a multi-window seed.
//
// Shared (fix round 1 on KAN-279 Part D/KAN-300) rather than kept local to
// one test file: tabViewOwnTab.test.tsx, capture.test.ts,
// exportOpenWindows.test.tsx and focusSavesEveryWindow.test.ts all built
// their own chrome.tabs.Tab literals by casting, independently.
export function buildChromeTab(
  overrides: Partial<chrome.tabs.Tab> = {}
): chrome.tabs.Tab {
  return {
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    frozen: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    lastAccessed: 0,
    url: '',
    title: '',
    ...overrides,
  };
}
