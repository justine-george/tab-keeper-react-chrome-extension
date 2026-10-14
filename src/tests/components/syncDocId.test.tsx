import { afterEach, describe, expect, test, vi } from 'vitest';

// The cloud read is held open by the test, and released when it says so.
const mocks = vi.hoisted(() => {
  let release: (doc: unknown) => void = () => {};
  return {
    loadFromFirestore: vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          release = resolve;
        })
    ),
    saveToFirestore: vi.fn<(docId: string, data: unknown) => Promise<void>>(
      () => Promise.resolve()
    ),
    ensureCloudSessionReady: vi.fn(() => Promise.resolve()),
    release: (doc: unknown) => release(doc),
  };
});
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  ensureCloudSessionReady: mocks.ensureCloudSessionReady,
}));

import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import {
  setAwaitsDeviceId,
  setSignedIn,
  setUserId,
  syncNowWhenSignedIn,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-599. A page now follows the device id when Chrome Sync brings another
// machine's, which can land while a sync is out. The sync read X's doc; its
// merge must go back to X, never over Y's doc, which it never read.

const SYNC_STARTED = 'global/syncStateWithFirestore/pending';

afterEach(() => localStorage.clear());

describe('the sync writes to the doc it read (KAN-599)', () => {
  test('an id followed mid-sync does not redirect that sync’s write', async () => {
    setupChromeFake();
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify(buildContainer([buildSession({ tabGroupId: 'local' })]))
    );
    const { store } = makeTestStore();
    store.dispatch(grantCloudConsent());
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('X'));
    const sync = store.dispatch(syncStateWithFirestore());
    expect(mocks.loadFromFirestore).toHaveBeenLastCalledWith('X');

    store.dispatch(setUserId('Y'));
    // Each side holds a session the other lacks, so the merge is written.
    mocks.release(buildContainer([buildSession({ tabGroupId: 'from-X' })]));
    await sync;
    await vi.waitFor(() => expect(mocks.saveToFirestore).toHaveBeenCalled());
    expect(mocks.saveToFirestore.mock.calls.map((c) => c[0])).toEqual(['X']);
  });
});

describe('Sync now on a device with no id yet (KAN-599)', () => {
  test('mints the id before it reads, and reads that doc', async () => {
    setupChromeFake();
    const { store, seen } = makeTestStore();
    store.dispatch(grantCloudConsent());
    store.dispatch(setAwaitsDeviceId(true));
    const pressed = store.dispatch(syncNowWhenSignedIn());
    await vi.waitFor(() => expect(seen).toContain(SYNC_STARTED));
    const { tokenValue } = await chrome.storage.sync.get(['tokenValue']);
    expect(typeof tokenValue).toBe('string');
    expect(store.getState().globalState.userId).toBe(tokenValue);
    expect(mocks.loadFromFirestore).toHaveBeenLastCalledWith(tokenValue);
    mocks.release(undefined);
    await pressed;
  });

  // No page listener heard it arrive: the mint's own re-read must still find it.
  test('an id stored but not yet adopted is adopted, and none is minted over it', async () => {
    setupChromeFake({ storage: { tokenValue: 'Y-from-A' } });
    const { store, seen } = makeTestStore();
    store.dispatch(grantCloudConsent());
    store.dispatch(setAwaitsDeviceId(true));
    const pressed = store.dispatch(syncNowWhenSignedIn());
    await vi.waitFor(() => expect(seen).toContain(SYNC_STARTED));
    expect(mocks.loadFromFirestore).toHaveBeenLastCalledWith('Y-from-A');
    expect((await chrome.storage.sync.get(['tokenValue'])).tokenValue).toBe(
      'Y-from-A'
    );
    expect(store.getState().globalState.userId).toBe('Y-from-A');
    mocks.release(undefined);
    await pressed;
  });

  test('an id that cannot be stored ends as a failed sync, with no read', async () => {
    setupChromeFake({ storage: { tokenValue: 0 } });
    const { store, seen } = makeTestStore();
    store.dispatch(grantCloudConsent());
    mocks.loadFromFirestore.mockClear();
    await store.dispatch(syncNowWhenSignedIn());
    expect(seen).not.toContain(SYNC_STARTED);
    expect(mocks.loadFromFirestore).not.toHaveBeenCalled();
    expect(store.getState().globalState.syncStatus).toBe('error');
  });
});
