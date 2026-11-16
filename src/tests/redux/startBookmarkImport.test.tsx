import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  ensureCloudSession: () => {},
}));

import App from '../../App';
import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import {
  endBookmarkImport,
  importBookmarksFromSettings,
  releaseStrandedBookmarksPermission,
  startBookmarkImport,
} from '../../redux/startBookmarkImport';
import { noteImportedBookmarks } from '../../redux/slices/settingsDataStateSlice';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { toastTexts } from '../setup/toasts';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { openImportBookmarks } from '../../redux/slices/globalStateSlice';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-862. The import asks for bookmarks in the full view only; the popup hands it there.

afterEach(() => {
  history.replaceState(null, '', '?');
  delete document.documentElement.dataset.firstOpen;
});

const isOpen = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().globalState.isImportBookmarksOpen;

type Node = chrome.bookmarks.BookmarkTreeNode;
// A bar holding these nodes, as getTree answers.
const barOf = (children: Node[]): Node[] => [
  {
    id: '0',
    title: '',
    syncing: false,
    children: [{ id: '1', title: 'Bookmarks Bar', syncing: false, children }],
  },
];
const link = (id: string, url = `https://example.test/${id}`): Node => ({
  id,
  title: id,
  url,
  syncing: false,
});
const holdsBookmarks = () =>
  globalThis.chrome.permissions.contains({ permissions: ['bookmarks'] });
const ALL_IMPORTED = 'Everything in your bookmarks is already imported.';
const NO_BOOKMARKS = 'There are no bookmarks to import.';

describe('startBookmarkImport', () => {
  test('in the popup: hands off to the full view and never asks Chrome', async () => {
    const chrome = setupChromeFake();
    const request = vi.spyOn(globalThis.chrome.permissions, 'request');
    const { store } = makeTestStore();

    await store.dispatch(startBookmarkImport());

    expect(chrome.sentMessages).toEqual([
      expect.objectContaining({
        type: OPEN_IN_TAB_MESSAGE,
        show: 'importBookmarks',
      }),
    ]);
    expect(request).not.toHaveBeenCalled();
    expect(isOpen(store)).toBe(false);
  });

  test('in the full view: a grant opens the dialog', async () => {
    history.replaceState(null, '', '?view=tab');
    const chrome = setupChromeFake();
    const { store } = makeTestStore();

    await store.dispatch(startBookmarkImport());

    expect(isOpen(store)).toBe(true);
    expect(chrome.sentMessages).toEqual([]);
  });

  test('in the full view: a decline leaves it closed', async () => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake({ refusedPermissions: ['bookmarks'] });
    const { store } = makeTestStore();

    await store.dispatch(startBookmarkImport());

    expect(isOpen(store)).toBe(false);
  });
});

// KAN-862 R23. Nothing left to import: no dialog opens, and the permission goes straight back.
describe('startBookmarkImport with nothing left', () => {
  const start = async (tree: Node[], importedIds: string[] = []) => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake({ bookmarkTree: tree });
    const { store } = makeTestStore();
    store.dispatch(
      noteImportedBookmarks([
        {
          sessionId: 's',
          bookmarks: importedIds.map((id) => ({ id, dateAdded: null })),
        },
      ])
    );
    const answer = await store.dispatch(startBookmarkImport());
    return { store, answer };
  };

  test('everything imported: no dialog, the permission back, answered allImported', async () => {
    const { store, answer } = await start(barOf([link('2')]), ['2']);
    expect(answer).toBe('allImported');
    expect(isOpen(store)).toBe(false);
    expect(await holdsBookmarks()).toBe(false);
  });

  test('no importable bookmark at all: no dialog, the permission back, answered noBookmarks', async () => {
    const { store, answer } = await start(
      barOf([link('2', 'javascript:void 0')])
    );
    expect(answer).toBe('noBookmarks');
    expect(isOpen(store)).toBe(false);
    expect(await holdsBookmarks()).toBe(false);
  });

  test('something left: the dialog opens and keeps the permission', async () => {
    const { store, answer } = await start(barOf([link('2'), link('3')]), ['2']);
    expect(answer).toBe('opened');
    expect(isOpen(store)).toBe(true);
    expect(await holdsBookmarks()).toBe(true);
  });

  test('a library that cannot be read: no dialog, the permission back, the unreadable toast', async () => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake();
    Object.assign(globalThis.chrome.bookmarks, {
      getTree: () => Promise.reject(new Error('no bookmarks')),
    });
    const { store } = makeTestStore();

    expect(await store.dispatch(startBookmarkImport())).toBe('unreadable');

    expect(isOpen(store)).toBe(false);
    expect(await holdsBookmarks()).toBe(false);
    await waitFor(() =>
      expect(toastTexts(store.getState())).toEqual([
        TOAST_MESSAGES.BOOKMARKS_UNREADABLE,
      ])
    );
  });
});

describe('importBookmarksFromSettings', () => {
  const press = async (tree: Node[], importedIds: string[] = []) => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake({ bookmarkTree: tree });
    const { store } = makeTestStore();
    store.dispatch(
      noteImportedBookmarks([
        {
          sessionId: 's',
          bookmarks: importedIds.map((id) => ({ id, dateAdded: null })),
        },
      ])
    );
    await store.dispatch(importBookmarksFromSettings());
    return store;
  };

  test.each([
    ['everything imported', barOf([link('2')]), ['2'], ALL_IMPORTED],
    ['no bookmarks', barOf([]), [], NO_BOOKMARKS],
  ])('%s: a toast says so', async (_, tree, importedIds, text) => {
    const store = await press(tree, importedIds);
    await waitFor(() => expect(toastTexts(store.getState())).toEqual([text]));
    expect(isOpen(store)).toBe(false);
  });

  test('something left: the dialog opens, no toast', async () => {
    const store = await press(barOf([link('2')]));
    expect(isOpen(store)).toBe(true);
    await act(async () => {});
    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('the Settings button: the toast, no dialog, the permission back, and focus stays on the button', async () => {
    history.replaceState(null, '', '?view=tab');
    const { store } = await renderWithProviders(<SettingsDetailsContainer />, {
      seed: { bookmarkTree: barOf([link('2')]) },
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.IMPORT));
        s.dispatch(
          noteImportedBookmarks([
            { sessionId: 's', bookmarks: [{ id: '2', dateAdded: null }] },
          ])
        );
      },
    });
    const button = screen.getByRole('button', {
      name: 'Import from bookmarks',
    });
    button.focus();

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() =>
      expect(toastTexts(store.getState())).toEqual([ALL_IMPORTED])
    );
    expect(isOpen(store)).toBe(false);
    expect(await holdsBookmarks()).toBe(false);
    expect(button).toHaveFocus();
  });
});

describe('endBookmarkImport', () => {
  test('closes the dialog and hands the permission back', async () => {
    history.replaceState(null, '', '?view=tab');
    setupChromeFake();
    const { store } = makeTestStore();
    await store.dispatch(startBookmarkImport());
    // PREMISE: granted and open.
    expect(
      await globalThis.chrome.permissions.contains({
        permissions: ['bookmarks'],
      })
    ).toBe(true);

    await store.dispatch(endBookmarkImport());

    expect(isOpen(store)).toBe(false);
    expect(
      await globalThis.chrome.permissions.contains({
        permissions: ['bookmarks'],
      })
    ).toBe(false);
  });
});

// KAN-862. A full view closed or reloaded with the dialog open never ran its close.

describe('releaseStrandedBookmarksPermission', () => {
  test("with this page's dialog closed, the permission goes back", async () => {
    setupChromeFake({ grantedPermissions: ['bookmarks'] });
    const { store } = makeTestStore();

    await store.dispatch(releaseStrandedBookmarksPermission());

    expect(await holdsBookmarks()).toBe(false);
  });

  test("with this page's dialog open, it stays", async () => {
    setupChromeFake({ grantedPermissions: ['bookmarks'] });
    const { store } = makeTestStore();
    store.dispatch(openImportBookmarks());

    await store.dispatch(releaseStrandedBookmarksPermission());

    expect(await holdsBookmarks()).toBe(true);
  });
});

describe('a page opening, with bookmarks left granted', () => {
  test('the full view hands it back', async () => {
    history.replaceState(null, '', '?view=tab');
    await renderWithProviders(<App />, {
      seed: {
        tabs: [{ id: 5, windowId: 1 }],
        currentTabId: 5,
        grantedPermissions: ['bookmarks'],
      },
    });

    await waitFor(async () => expect(await holdsBookmarks()).toBe(false));
  });

  // The popup must not take it from a full view whose dialog is open.
  test('the popup leaves it alone', async () => {
    await renderWithProviders(<App />, {
      seed: {
        tabs: [{ id: 5, windowId: 1 }],
        currentTabId: 5,
        grantedPermissions: ['bookmarks'],
      },
    });
    await waitFor(() =>
      expect(document.documentElement.dataset.firstOpen).toBeDefined()
    );

    expect(await holdsBookmarks()).toBe(true);
  });
});
