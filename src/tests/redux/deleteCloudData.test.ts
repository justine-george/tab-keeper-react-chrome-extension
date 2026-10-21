import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
// Keep in step with src/tests/setup/domStub.ts.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  deleteFromFirestore: vi.fn<(userId: string) => Promise<void>>(
    async () => undefined
  ),
  ensureCloudSessionReady: vi.fn<() => Promise<void>>(async () => undefined),
  cloudDocumentExists: vi.fn<(userId: string) => Promise<boolean>>(
    async () => true
  ),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  deleteFromFirestore: mocks.deleteFromFirestore,
  ensureCloudSessionReady: mocks.ensureCloudSessionReady,
  cloudDocumentExists: mocks.cloudDocumentExists,
}));

import {
  askToDeleteCloudData,
  deleteCloudData,
  openDeleteCloudDataModal,
  closeDeleteCloudDataModal,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
  setLastSyncedTime,
} from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { setupChromeFake } from '../setup/chrome.fake';
import { newestToast } from '../setup/toasts';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-254. The Firestore document under the anonymous token was written on
// every sync and nothing removed it. deleteCloudData deletes it AND turns
// Auto Sync off on this device -- otherwise the next edit re-uploads
// everything and the delete was theatre. Local sessions are untouched.

function signedInWithId(consent: 'granted' | 'declined' | '', id = 'uuid-1') {
  const made = makeTestStore();
  made.store.dispatch(setSignedIn());
  made.store.dispatch(setUserId(id));
  if (consent === 'granted') made.store.dispatch(grantCloudConsent());
  if (consent === 'declined') made.store.dispatch(declineCloudConsent());
  made.store.dispatch(setLastSyncedTime(1_760_000_000_000));
  return made;
}

type TestStore = ReturnType<typeof makeTestStore>['store'];

// What a delete of nothing must leave alone.
const syncFacts = (store: TestStore) => ({
  cloudConsent: store.getState().settingsDataState.cloudConsent,
  isAutoSync: store.getState().settingsDataState.isAutoSync,
  lastSyncedTime: store.getState().settingsDataState.lastSyncedTime,
  syncStatus: store.getState().globalState.syncStatus,
});

describe('deleteCloudData', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.deleteFromFirestore.mockReset().mockResolvedValue(undefined);
    mocks.ensureCloudSessionReady.mockReset().mockResolvedValue(undefined);
    mocks.cloudDocumentExists.mockReset().mockResolvedValue(true);
    setupChromeFake();
  });

  it('deletes the document, turns sync off, forgets the last sync, closes the dialog, and says so', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('uuid-1'));
    store.dispatch(grantCloudConsent());
    store.dispatch(setLastSyncedTime(1_760_000_000_000));
    store.dispatch(openDeleteCloudDataModal());
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);

    await store.dispatch(deleteCloudData());

    expect(mocks.deleteFromFirestore).toHaveBeenCalledWith('uuid-1');
    expect(mocks.deleteFromFirestore).toHaveBeenCalledTimes(1);
    // KAN-719. It reads before it deletes.
    expect(mocks.cloudDocumentExists).toHaveBeenCalledWith('uuid-1');
    expect(mocks.cloudDocumentExists.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteFromFirestore.mock.invocationCallOrder[0]
    );
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    // KAN-632: the yes goes too, so the cloud button asks before re-uploading.
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    // KAN-573: nothing is in the cloud, so no "Last synced" time.
    expect(store.getState().settingsDataState.lastSyncedTime).toBe('');
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETED
    );
    // The token stays: minting a fresh one would detach this device from the
    // document but leave it standing, the opposite of what was asked.
    expect(store.getState().globalState.userId).toBe('uuid-1');
  });

  it('on failure, leaves auto sync, the yes and the last sync as they were and says it failed', async () => {
    mocks.deleteFromFirestore.mockRejectedValue(new Error('denied'));
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('uuid-1'));
    store.dispatch(grantCloudConsent());
    store.dispatch(setLastSyncedTime(1_760_000_000_000));
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
    expect(store.getState().settingsDataState.cloudConsent).toBe('granted');
    expect(store.getState().settingsDataState.lastSyncedTime).toBe(
      1_760_000_000_000
    );
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
  });

  // KAN-289. The wait used to hang forever on a failed sign-in, so this
  // branch was unreachable and the dialog simply did nothing. It now rejects,
  // and the existing catch must turn that into the failed toast.
  it('when sign-in fails, deletes nothing and says it failed', async () => {
    mocks.ensureCloudSessionReady.mockRejectedValue(
      new Error('auth/too-many-requests')
    );
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('uuid-1'));
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
  });

  it('with no token there is nothing to delete, and nothing is called', async () => {
    const { store } = makeTestStore();
    const before = syncFacts(store);
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(mocks.ensureCloudSessionReady).not.toHaveBeenCalled();
    expect(mocks.cloudDocumentExists).not.toHaveBeenCalled();
    expect(syncFacts(store)).toEqual(before);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.NO_CLOUD_DATA_TO_DELETE
    );
  });

  it('no document: says so, deletes nothing, sync untouched', async () => {
    mocks.cloudDocumentExists.mockResolvedValue(false);
    const { store } = signedInWithId('declined');
    const before = syncFacts(store);
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(syncFacts(store)).toEqual(before);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.NO_CLOUD_DATA_TO_DELETE
    );
  });

  it('the read fails: the failed toast, deletes nothing', async () => {
    mocks.cloudDocumentExists.mockRejectedValue(new Error('denied'));
    const { store } = signedInWithId('granted');
    const before = syncFacts(store);
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);

    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(syncFacts(store)).toEqual(before);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
  });

  it('sign-in fails on a confirm with an id: the failed toast, no read, no delete, sync untouched', async () => {
    mocks.ensureCloudSessionReady.mockRejectedValue(new Error('auth'));
    const { store } = signedInWithId('declined');
    const before = syncFacts(store);
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(mocks.cloudDocumentExists).not.toHaveBeenCalled();
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(syncFacts(store)).toEqual(before);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
  });

  it('an unusable stored token: the token toast, nothing changed, no sign-in, read or delete', async () => {
    setupChromeFake({ storage: { tokenValue: 42 } });
    const { store } = makeTestStore();
    store.dispatch(grantCloudConsent());
    const before = syncFacts(store);
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(syncFacts(store)).toEqual(before);
    expect(mocks.ensureCloudSessionReady).not.toHaveBeenCalled();
    expect(mocks.cloudDocumentExists).not.toHaveBeenCalled();
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.UNREADABLE_ACCOUNT_TOKEN
    );
  });

  it('an unreadable stored token: the failed toast, nothing changed, no sign-in, read or delete', async () => {
    const { store } = makeTestStore();
    store.dispatch(grantCloudConsent());
    const before = syncFacts(store);
    vi.spyOn(chrome.storage.sync, 'get').mockRejectedValue(new Error('boom'));
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(syncFacts(store)).toEqual(before);
    expect(mocks.ensureCloudSessionReady).not.toHaveBeenCalled();
    expect(mocks.cloudDocumentExists).not.toHaveBeenCalled();
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
  });

  it('the dialog flag opens and closes', () => {
    const { store } = makeTestStore();
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    store.dispatch(openDeleteCloudDataModal());
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(true);
    store.dispatch(closeDeleteCloudDataModal());
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
  });
});

// KAN-719. The press never claims, or offers, a delete of nothing.
describe('askToDeleteCloudData (KAN-719)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.deleteFromFirestore.mockReset().mockResolvedValue(undefined);
    mocks.ensureCloudSessionReady.mockReset().mockResolvedValue(undefined);
    mocks.cloudDocumentExists.mockReset().mockResolvedValue(true);
    setupChromeFake();
  });

  const expectNoNetwork = () => {
    expect(mocks.ensureCloudSessionReady).not.toHaveBeenCalled();
    expect(mocks.cloudDocumentExists).not.toHaveBeenCalled();
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
  };
  const modalOpen = (store: TestStore) =>
    store.getState().globalState.isDeleteCloudDataModalOpen;

  it.each(['granted', 'declined'] as const)(
    'nothing stored, %s: says there is nothing, no dialog, no network',
    async (consent) => {
      const { store } = makeTestStore();
      if (consent === 'granted') store.dispatch(grantCloudConsent());
      else store.dispatch(declineCloudConsent());
      const before = syncFacts(store);

      await store.dispatch(askToDeleteCloudData());

      expect(syncFacts(store)).toEqual(before);
      expect(modalOpen(store)).toBe(false);
      expect(newestToast(store.getState())?.text).toBe(
        TOAST_MESSAGES.NO_CLOUD_DATA_TO_DELETE
      );
      expectNoNetwork();
    }
  );

  it('an unusable stored token: the token toast, no dialog, no network', async () => {
    setupChromeFake({ storage: { tokenValue: 42 } });
    const { store } = makeTestStore();
    store.dispatch(grantCloudConsent());
    const before = syncFacts(store);

    await store.dispatch(askToDeleteCloudData());

    expect(syncFacts(store)).toEqual(before);
    expect(modalOpen(store)).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.UNREADABLE_ACCOUNT_TOKEN
    );
    expectNoNetwork();
  });

  it('storage that throws: the failed toast, no dialog, no network', async () => {
    const { store } = makeTestStore();
    store.dispatch(grantCloudConsent());
    const before = syncFacts(store);
    vi.spyOn(chrome.storage.sync, 'get').mockRejectedValue(new Error('boom'));

    await store.dispatch(askToDeleteCloudData());

    expect(syncFacts(store)).toEqual(before);
    expect(modalOpen(store)).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
    expectNoNetwork();
  });

  it('granted, document exists: opens the dialog, deletes nothing', async () => {
    const { store } = signedInWithId('granted');

    await store.dispatch(askToDeleteCloudData());

    expect(modalOpen(store)).toBe(true);
    expect(newestToast(store.getState())).toBeUndefined();
    expect(mocks.cloudDocumentExists).toHaveBeenCalledWith('uuid-1');
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
  });

  it('granted, no document: says so, no dialog, sync untouched', async () => {
    mocks.cloudDocumentExists.mockResolvedValue(false);
    const { store } = signedInWithId('granted');
    const before = syncFacts(store);

    await store.dispatch(askToDeleteCloudData());

    expect(modalOpen(store)).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.NO_CLOUD_DATA_TO_DELETE
    );
    expect(syncFacts(store)).toEqual(before);
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
  });

  it('granted, the read fails: the failed toast, never "no data"', async () => {
    mocks.cloudDocumentExists.mockRejectedValue(new Error('denied'));
    const { store } = signedInWithId('granted');
    const before = syncFacts(store);

    await store.dispatch(askToDeleteCloudData());

    expect(syncFacts(store)).toEqual(before);
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(modalOpen(store)).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
  });

  it('granted, sign-in fails: the failed toast, no read', async () => {
    mocks.ensureCloudSessionReady.mockRejectedValue(new Error('auth'));
    const { store } = signedInWithId('granted');
    const before = syncFacts(store);

    await store.dispatch(askToDeleteCloudData());

    expect(syncFacts(store)).toEqual(before);
    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(modalOpen(store)).toBe(false);
    expect(newestToast(store.getState())?.text).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
    expect(mocks.cloudDocumentExists).not.toHaveBeenCalled();
  });

  it('declined, with an id: opens the dialog and contacts nothing', async () => {
    const { store } = signedInWithId('declined');
    const before = syncFacts(store);

    await store.dispatch(askToDeleteCloudData());

    expect(syncFacts(store)).toEqual(before);
    expect(modalOpen(store)).toBe(true);
    expectNoNetwork();
  });

  it('unanswered consent is not granted', async () => {
    const { store } = signedInWithId('');
    expect(store.getState().settingsDataState.cloudConsent).toBe('');

    await store.dispatch(askToDeleteCloudData());

    expect(modalOpen(store)).toBe(true);
    expectNoNetwork();
  });

  it('adopts a token stored after boot, then checks with it', async () => {
    setupChromeFake({ storage: { tokenValue: 'uuid-9' } });
    const { store } = makeTestStore();
    store.dispatch(grantCloudConsent());
    expect(store.getState().globalState.userId).toBeNull();

    await store.dispatch(askToDeleteCloudData());

    expect(store.getState().globalState.userId).toBe('uuid-9');
    expect(mocks.cloudDocumentExists).toHaveBeenCalledWith('uuid-9');
    expect(modalOpen(store)).toBe(true);
  });
});
