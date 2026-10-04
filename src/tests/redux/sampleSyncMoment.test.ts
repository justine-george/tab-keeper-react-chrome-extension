import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

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
  setFirebaseAuthed,
  setHasSyncedBefore,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { beginDragHold, endDragHold } from '../../redux/dragHold';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';

// KAN-7 fix round 1, from KAN-149: a session arriving by sync is a value
// moment, but the sample arriving from another device is not "a session".

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

const readyStore = () => {
  vi.setSystemTime(T0);
  const { store } = makeTestStore();
  store.dispatch(setUserId('u1'));
  store.dispatch(setSignedIn());
  store.dispatch(setFirebaseAuthed());
  store.dispatch(grantCloudConsent());
  store.dispatch(
    replaceState(buildContainer([buildSession({ tabGroupId: 'local' })]))
  );
  store.dispatch(setHasSyncedBefore());
  return store;
};

const cloudWith = (id: string) => {
  mocks.cloud.doc = buildContainer([
    buildSession({ tabGroupId: 'local' }),
    buildSession({ tabGroupId: id, title: 'From the other device' }),
  ]);
};

const momentOf = (store: ReturnType<typeof readyStore>) =>
  store.getState().settingsDataState.lastValueMomentTime;

describe('a synced session is a value moment, a synced sample is not', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.cloud.doc = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a sample arriving by a sync records nothing', async () => {
    const store = readyStore();
    cloudWith(`${SAMPLE_ID_PREFIX}1`);
    await store.dispatch(syncStateWithFirestore());
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toContain(`${SAMPLE_ID_PREFIX}1`);
    expect(momentOf(store)).toBe('');
  });

  it('CONTROL: an ordinary session arriving by the same sync records one', async () => {
    const store = readyStore();
    cloudWith('remote');
    await store.dispatch(syncStateWithFirestore());
    expect(typeof momentOf(store)).toBe('number');
  });

  it('a sample arriving while a drag is held records nothing', async () => {
    const store = readyStore();
    cloudWith(`${SAMPLE_ID_PREFIX}2`);
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());
    endDragHold();
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toContain(`${SAMPLE_ID_PREFIX}2`);
    expect(momentOf(store)).toBe('');
  });

  it('CONTROL: an ordinary session arriving while held records one', async () => {
    const store = readyStore();
    cloudWith('remote');
    beginDragHold();
    await store.dispatch(syncStateWithFirestore());
    endDragHold();
    expect(typeof momentOf(store)).toBe('number');
  });
});
