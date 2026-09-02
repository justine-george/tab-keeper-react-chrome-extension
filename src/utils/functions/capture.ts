import { v4 as uuidv4 } from 'uuid';

import { getStringDate, resolveTabUrl } from './local';
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

// Snapshots every open window as a session. Extracted from UserInputContainer
// so focus mode can save what it is about to close using exactly the same
// capture the "Save current session" button uses -- two captures that drifted
// apart would mean focus mode quietly saved something less faithful than the
// session the user could have saved by hand.
//
// Returns null when there is nothing to capture, which is the caller's cue
// that there is no session to save rather than an empty one to create.
export async function captureOpenWindows(
  title: string
): Promise<tabContainerData | null> {
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

  const currentWindow = await new Promise<chrome.windows.Window>((resolve) =>
    chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
  );

  // Current window first, so a restore reopens the user's focus where it was.
  // getCurrent is deliberately left unfiltered - filtering the query would
  // leave no way to tell "the current window is a popup" from "there is no
  // current window" - so the type is checked here instead. Without this the
  // unshift would put a popup back after getAll had excluded it.
  const windowList = allWindows.filter(
    (window) => window.id !== currentWindow?.id
  );
  if (currentWindow?.type === 'normal') {
    windowList.unshift(currentWindow);
  }

  let tabCount = 0;

  const windowsGroupData: windowGroupData[] = windowList
    .filter((window) => window.tabs && window.tabs.length > 0)
    .map((window) => {
      const tabsData = (window.tabs ?? []).map((tab) => ({
        tabId: uuidv4(),
        favicon: tab.favIconUrl || '',
        title: tab.title || '',
        url: resolveTabUrl(tab.url || ''),
      }));

      tabCount += tabsData.length;

      // A missing dimension is stored as 0, which every consumer already
      // treats as "no saved geometry" and replaces with the default.
      return {
        windowId: uuidv4(),
        windowHeight: window.height ?? 0,
        windowWidth: window.width ?? 0,
        windowOffsetTop: window.top ?? 0,
        windowOffsetLeft: window.left ?? 0,
        tabCount: tabsData.length,
        title: tabsData[0].title,
        tabs: tabsData,
      };
    });

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
