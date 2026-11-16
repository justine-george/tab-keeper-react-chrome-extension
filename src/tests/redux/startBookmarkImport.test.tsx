import { afterEach, describe, expect, test, vi } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import {
  endBookmarkImport,
  startBookmarkImport,
} from '../../redux/startBookmarkImport';
import { OPEN_IN_TAB_MESSAGE } from '../../utils/functions/popOut';

// KAN-862. The import asks for bookmarks in the full view only; the popup hands it there.

afterEach(() => history.replaceState(null, '', '?'));

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
