import type { UnknownAction } from '@reduxjs/toolkit';

import { noteImportedBookmarks } from '../../redux/slices/settingsDataStateSlice';
import { saveImportedSessionsInternal } from '../../redux/slices/tabContainerDataStateSlice';
import type { BookmarkIdentity } from '../../utils/functions/bookmarkImport';
import { buildSession } from './sessionFixture';

// KAN-862 R25. Bookmarks count as imported only while their session is saved, so a seeded import saves one too.
export function recordImport(
  store: { dispatch: (action: UnknownAction) => unknown },
  sessionId: string,
  bookmarks: BookmarkIdentity[]
): void {
  const base = buildSession();
  store.dispatch(
    saveImportedSessionsInternal([
      buildSession({
        tabGroupId: sessionId,
        title: sessionId,
        windows: base.windows.map((w) => ({
          ...w,
          windowId: `${sessionId}-${w.windowId}`,
          tabs: w.tabs.map((t) => ({ ...t, tabId: `${sessionId}-${t.tabId}` })),
        })),
      }),
    ])
  );
  store.dispatch(noteImportedBookmarks([{ sessionId, bookmarks }]));
}
