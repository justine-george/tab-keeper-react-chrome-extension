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
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  deleteFromFirestore: mocks.deleteFromFirestore,
  ensureCloudSessionReady: mocks.ensureCloudSessionReady,
  displayToast: vi.fn(),
}));

import {
  deleteCloudData,
  openDeleteCloudDataModal,
  closeDeleteCloudDataModal,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-254. The Firestore document under the anonymous token was written on
// every sync and nothing removed it. deleteCloudData deletes it AND turns
// Auto Sync off on this device -- otherwise the next edit re-uploads
// everything and the delete was theatre. Local sessions are untouched.

describe('deleteCloudData', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.deleteFromFirestore.mockReset().mockResolvedValue(undefined);
    mocks.ensureCloudSessionReady.mockReset().mockResolvedValue(undefined);
  });

  it('deletes the document, turns auto sync off, closes the dialog, and says so', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('uuid-1'));
    store.dispatch(openDeleteCloudDataModal());
    expect(store.getState().settingsDataState.isAutoSync).toBe(true);

    await store.dispatch(deleteCloudData());

    expect(mocks.deleteFromFirestore).toHaveBeenCalledWith('uuid-1');
    expect(mocks.deleteFromFirestore).toHaveBeenCalledTimes(1);
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(store.getState().globalState.toastText).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETED
    );
    // The token stays: minting a fresh one would detach this device from the
    // document but leave it standing, the opposite of what was asked.
    expect(store.getState().globalState.userId).toBe('uuid-1');
  });

  it('on failure, leaves auto sync as it was and says it failed', async () => {
    mocks.deleteFromFirestore.mockRejectedValue(new Error('denied'));
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('uuid-1'));
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(store.getState().settingsDataState.isAutoSync).toBe(true);
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
    expect(store.getState().globalState.toastText).toBe(
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
    expect(store.getState().globalState.toastText).toBe(
      TOAST_MESSAGES.CLOUD_DATA_DELETE_FAILED
    );
  });

  it('with no token there is nothing to delete, and nothing is called', async () => {
    const { store } = makeTestStore();
    store.dispatch(openDeleteCloudDataModal());

    await store.dispatch(deleteCloudData());

    expect(mocks.deleteFromFirestore).not.toHaveBeenCalled();
    expect(store.getState().globalState.isDeleteCloudDataModalOpen).toBe(false);
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
