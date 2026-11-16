import { afterEach, describe, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  ensureCloudSession: () => {},
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';
import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import {
  endBookmarkImport,
  releaseStrandedBookmarksPermission,
  startBookmarkImport,
} from '../../redux/startBookmarkImport';
import { openImportBookmarks } from '../../redux/slices/globalStateSlice';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-862. The import asks for bookmarks in the full view only; the popup hands it there.

afterEach(() => {
  history.replaceState(null, '', '?');
  delete document.documentElement.dataset.firstOpen;
});

const isOpen = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().globalState.isImportBookmarksOpen;

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
const holdsBookmarks = () =>
  globalThis.chrome.permissions.contains({ permissions: ['bookmarks'] });

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
