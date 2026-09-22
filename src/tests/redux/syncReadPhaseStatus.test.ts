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
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
  saveToFirestore: vi.fn<(userId: string, data: unknown) => Promise<void>>(
    async () => undefined
  ),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  displayToast: vi.fn(),
}));

import {
  setSignedIn,
  setSyncStatus,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-263. A sync is read-then-write, and only the write half ever said
// "loading": saveToFirestoreIfDirty.pending is wired, syncStateWithFirestore's
// pending was not. So for the debounce plus the whole cloud read the status
// stayed wherever the last edit left it -- 'idle', because markDirty sets it
// -- and the header offered "sync now" for a sync that was already running.
//
// Every test here freezes the sync inside the read by handing loadFromFirestore
// a promise that never settles. That is the only way to look at the status
// mid-read; a resolved mock runs the whole thunk before the assertion.
describe('the read phase of a sync reports itself', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  const signedInStore = () => {
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(setSignedIn());
    return store;
  };

  it('is "loading" while the cloud read is still in flight', () => {
    mocks.loadFromFirestore.mockReturnValue(new Promise(() => {}));
    const store = signedInStore();
    store.dispatch(setSyncStatus('idle'));

    store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('loading');
  });

  // The stretch Justine saw: the header looked idle for seconds after Undo,
  // then Settings said Syncing… only once the write began. 'success' is the
  // other status an edit can start from, and it must be overridden too.
  it('overrides a stale "success" the moment the sync starts', () => {
    mocks.loadFromFirestore.mockReturnValue(new Promise(() => {}));
    const store = signedInStore();
    store.dispatch(setSyncStatus('success'));

    store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('loading');
  });

  // Before the fix a rejection left the status untouched: the sync died
  // looking exactly like one that had not run, and the header kept offering
  // "sync now" as if nothing had happened.
  it('is "error" when the read itself throws', async () => {
    mocks.loadFromFirestore.mockRejectedValue(new Error('offline'));
    const store = signedInStore();
    store.dispatch(setSyncStatus('idle'));

    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('error');
  });

  // CONTROL. The new pending case must not outlive the sync: a read that
  // completes with nothing to write still lands on the completed-sync status
  // the thunk body sets (KAN-79), not a stuck "loading".
  it('CONTROL: a completed sync with nothing to write still lands on "success"', async () => {
    const same = buildContainer([buildSession({ tabGroupId: 'shared' })]);
    localStorage.setItem('tabContainerData', JSON.stringify(same));
    mocks.loadFromFirestore.mockResolvedValue(same);
    const store = signedInStore();

    await store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('success');
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });
});
