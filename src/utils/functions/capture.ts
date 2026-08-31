import { v4 as uuidv4 } from 'uuid';

import { getStringDate, resolveTabUrl } from './local';
import type {
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';

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
  const allWindows = await new Promise<chrome.windows.Window[]>((resolve) =>
    chrome.windows.getAll({ populate: true }, (result) => resolve(result))
  );

  const currentWindow = await new Promise<chrome.windows.Window>((resolve) =>
    chrome.windows.getCurrent({ populate: true }, (result) => resolve(result))
  );

  // Current window first, so a restore reopens the user's focus where it was.
  const windowList = allWindows.filter(
    (window) => window.id !== currentWindow.id
  );
  windowList.unshift(currentWindow);

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

  return {
    tabGroupId: uuidv4(),
    title,
    createdTime: getStringDate(new Date()),
    windowCount: windowsGroupData.length,
    tabCount,
    isAutoSave: false,
    isSelected: true,
    windows: windowsGroupData,
  };
}
