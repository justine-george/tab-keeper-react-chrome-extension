import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
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
  ensureCloudSessionReady: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import {
  saveToFirestoreIfDirty,
  setFirebaseAuthed,
  setIsDirtyWithoutSync,
  setLoggedOut,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-269 (split from KAN-264). Nothing stopped a second sync starting while
// one ran: the debounced sync, the header button, the consent dialog and the
// backup loads can all start one, and Merge/Replace's own write overlapped the
// debounced full sync it scheduled. Each read, merged against whatever
// localStorage held when its read resolved, and wrote.
//
// Declining the second one is NOT the fix. A sync requested mid-sync often
// carries an edit the running one never saw -- declined, that edit sits
// unsynced until some later edit happens to trigger another sync. So: one at
// a time, and a request made meanwhile is remembered and run ONCE after, no
// matter how many arrived.

const SYNC_STARTED = 'global/syncStateWithFirestore/pending';

const deferred = <T = unknown>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const settle = () => new Promise((r) => setTimeout(r, 20));

const cloud = buildContainer([buildSession({ tabGroupId: 'c1' })]);

const readyStore = () => {
  const made = makeTestStore();
  made.store.dispatch(setUserId('u1'));
  made.store.dispatch(setSignedIn());
  made.store.dispatch(setFirebaseAuthed());
  made.store.dispatch(grantCloudConsent());
  made.seen.length = 0;
  return made;
};

const starts = (seen: string[]) =>
  seen.filter((t) => t === SYNC_STARTED).length;

describe('one sync at a time (KAN-269)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tabContainerData', JSON.stringify(cloud));
    mocks.loadFromFirestore.mockReset().mockResolvedValue(cloud);
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('a sync requested while one is reading does not start', () => {
    const read = deferred();
    mocks.loadFromFirestore.mockReturnValueOnce(read.promise);
    const { store, seen } = readyStore();

    store.dispatch(syncStateWithFirestore());
    store.dispatch(syncStateWithFirestore());

    expect(starts(seen)).toBe(1);
    expect(mocks.loadFromFirestore).toHaveBeenCalledTimes(1);
  });

  // KAN-263 paints a rejected sync as a failure. A postponed sync did not
  // fail, and the header must keep saying "syncing" for the one that runs.
  it('the postponed request is not reported as a failed sync', () => {
    mocks.loadFromFirestore.mockReturnValueOnce(deferred().promise);
    const { store } = readyStore();

    store.dispatch(syncStateWithFirestore());
    store.dispatch(syncStateWithFirestore());

    expect(store.getState().globalState.syncStatus).toBe('loading');
  });

  it('runs exactly one follow-up after the running sync, however many were requested', async () => {
    const read = deferred();
    mocks.loadFromFirestore.mockReturnValueOnce(read.promise);
    const { store, seen } = readyStore();

    store.dispatch(syncStateWithFirestore());
    store.dispatch(syncStateWithFirestore());
    store.dispatch(syncStateWithFirestore());
    store.dispatch(syncStateWithFirestore());
    read.resolve(cloud);
    await settle();

    expect(starts(seen)).toBe(2);
    expect(mocks.loadFromFirestore).toHaveBeenCalledTimes(2);
  });

  // CONTROL: nothing requested meanwhile, nothing runs after. Without this,
  // the test above passes against code that always syncs twice.
  it('CONTROL: with no request meanwhile, no follow-up runs', async () => {
    const { store, seen } = readyStore();

    await store.dispatch(syncStateWithFirestore());
    await settle();

    expect(starts(seen)).toBe(1);
  });

  // The ticket's own path. Merge/Replace write directly, and the same dirty
  // flag schedules a full sync. The sync must wait for the write, then run.
  it('a sync requested while a direct write is in flight waits for it, then runs', async () => {
    const write = deferred<void>();
    mocks.saveToFirestore.mockReturnValueOnce(write.promise);
    const { store, seen } = readyStore();
    store.dispatch(setIsDirtyWithoutSync());

    store.dispatch(saveToFirestoreIfDirty());
    store.dispatch(syncStateWithFirestore());
    expect(starts(seen)).toBe(0);

    write.resolve();
    await settle();

    expect(starts(seen)).toBe(1);
  });

  it('a sync whose read fails still frees the queue', async () => {
    const read = deferred();
    mocks.loadFromFirestore.mockReturnValueOnce(read.promise);
    const { store, seen } = readyStore();

    store.dispatch(syncStateWithFirestore());
    store.dispatch(syncStateWithFirestore());
    read.reject(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await settle();

    expect(starts(seen)).toBe(2);
  });

  // Off the happy path: the reasons a sync may run can lapse while it is
  // running. A queued sync is dropped, not run, if they have.
  it('a queued sync is dropped if the device signed out meanwhile', async () => {
    const read = deferred();
    mocks.loadFromFirestore.mockReturnValueOnce(read.promise);
    const { store, seen } = readyStore();

    store.dispatch(syncStateWithFirestore());
    store.dispatch(syncStateWithFirestore());
    store.dispatch(setLoggedOut());
    read.resolve(cloud);
    await settle();

    expect(starts(seen)).toBe(1);
  });
});
