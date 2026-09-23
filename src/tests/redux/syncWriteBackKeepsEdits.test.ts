import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// A cloud that holds what was last written to it, so a later read sees the
// write this test held open -- not a canned document that hides the loss.
const mocks = vi.hoisted(() => {
  const cloud: { doc: unknown } = { doc: undefined };
  return {
    cloud,
    loadFromFirestore: vi.fn(async (): Promise<unknown> => cloud.doc),
    saveToFirestore: vi.fn(
      async (_userId: string, data: unknown): Promise<void> => {
        cloud.doc = structuredClone(data);
      }
    ),
  };
});

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
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// saveToFirestoreIfDirty read the state BEFORE awaiting the Firestore write,
// and wrote that same copy to localStorage AFTER it. An edit made while the
// write was in flight had already persisted itself, and the late write put
// the old copy back over it. The sync that follows reads localStorage, so it
// then merged the edit away on screen too -- and since KAN-269 that sync
// always waits for the write, so it always reads the old copy.

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const session = buildSession({ tabGroupId: 's1', title: 'Before' });

const storedTitle = () =>
  JSON.parse(localStorage.getItem('tabContainerData')!).tabGroups[0].title;

const cloudTitle = () =>
  (mocks.cloud.doc as { tabGroups: { title: string }[] }).tabGroups[0].title;

const readyStore = () => {
  const { store } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  store.dispatch(replaceState(buildContainer([session])));
  store.dispatch(setIsDirtyWithoutSync());
  return store;
};

const rename = (title: string) =>
  updateTabGroupTitle({ tabGroupId: 's1', editableTitle: title });

describe('a sync write keeps an edit made while it was in flight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.cloud.doc = undefined;
    mocks.saveToFirestore.mockClear();
    mocks.loadFromFirestore.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('localStorage still holds the edit after the write lands', async () => {
    const write = deferred();
    mocks.saveToFirestore.mockImplementationOnce(async (_u, data) => {
      await write.promise;
      mocks.cloud.doc = structuredClone(data);
    });
    const store = readyStore();

    store.dispatch(saveToFirestoreIfDirty());
    store.dispatch(rename('After'));
    expect(storedTitle()).toBe('After');

    write.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(storedTitle()).toBe('After');
  });

  // The user-visible half: the edit's own debounced sync is queued behind the
  // write (KAN-269), runs when it lands, and must not merge the edit away.
  it('the screen still shows the edit after the follow-up sync', async () => {
    const write = deferred();
    mocks.saveToFirestore.mockImplementationOnce(async (_u, data) => {
      await write.promise;
      mocks.cloud.doc = structuredClone(data);
    });
    const store = readyStore();

    store.dispatch(saveToFirestoreIfDirty());
    store.dispatch(rename('After'));
    // The debounce fires while the write is still held, so the sync queues.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_TIME_WINDOW + 50);
    write.resolve();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_TIME_WINDOW + 50);

    expect(mocks.loadFromFirestore).toHaveBeenCalled();
    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'After'
    );
    // And it reaches the cloud: the follow-up sync finds the edit the cloud
    // lacks and writes it.
    expect(cloudTitle()).toBe('After');
  });

  // CONTROL: the same steps with the edit made after the write lands. It
  // passes on broken code, so the fixture can produce a kept edit and the
  // two tests above fail only because of the timing.
  it('CONTROL: an edit made after the write lands is kept', async () => {
    const store = readyStore();

    await store.dispatch(saveToFirestoreIfDirty());
    store.dispatch(rename('After'));
    await vi.advanceTimersByTimeAsync(2 * DEBOUNCE_TIME_WINDOW);

    expect(mocks.loadFromFirestore).toHaveBeenCalled();
    expect(storedTitle()).toBe('After');
    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'After'
    );
    expect(cloudTitle()).toBe('After');
  });
});
