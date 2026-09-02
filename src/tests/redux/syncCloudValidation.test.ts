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
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

const localOnly = buildContainer([buildSession()]);

describe('an unreadable cloud document stops the sync without writing', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
    localStorage.setItem('tabContainerData', JSON.stringify(localOnly));
  });

  // The exact shape an old client produces when sessions move to another
  // field: every whitelisted key present, tabGroups absent. Verified against
  // the real mergeTabContainers to throw `side.tabGroups is not iterable`.
  const unreadable = {
    lastModified: 5000,
    selectedTabGroupId: null,
    tabGroups: undefined,
    deletedTabGroups: [],
  };

  it('does not throw', async () => {
    mocks.loadFromFirestore.mockResolvedValue(unreadable);
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    await expect(
      store.dispatch(syncStateWithFirestore()).unwrap()
    ).resolves.not.toThrow();
  });

  it('never writes over a document it could not read', async () => {
    mocks.loadFromFirestore.mockResolvedValue(unreadable);
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    await store.dispatch(syncStateWithFirestore());
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });

  // The assertion that actually separates "guarded" from "crashed". Both leave
  // local data alone, so session-survival proves nothing here; only the
  // reporting differs. syncStateWithFirestore has no `rejected` extraReducer,
  // so the pre-fix crash left syncStatus on 'idle' - the sync died looking
  // exactly like a sync that had not run.
  it('reports the failure instead of dying silently', async () => {
    mocks.loadFromFirestore.mockResolvedValue(unreadable);
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    await store.dispatch(syncStateWithFirestore());
    expect(store.getState().globalState.syncStatus).toBe('error');
  });

  // Regression guard on the other half of "keep local data, leave the document
  // untouched". Deliberately seeded into the store, because the guard returns
  // before anything hydrates it from localStorage. Honest limitation: this also
  // passes against the pre-fix crash, so it guards future edits to the error
  // path rather than proving today's fix.
  it('leaves the local sessions in the store alone', async () => {
    mocks.loadFromFirestore.mockResolvedValue(unreadable);
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(localOnly));
    await store.dispatch(syncStateWithFirestore());
    expect(store.getState().tabContainerDataState.tabGroups).toHaveLength(
      localOnly.tabGroups.length
    );
  });

  // POSITIVE CONTROL. Without this, all three assertions above pass just as
  // well against code that never writes or merges anything at all.
  it('control: a VALID cloud document is still merged and can still write', async () => {
    const validCloud = buildContainer([
      buildSession({ tabGroupId: 'cloud-only', title: 'Cloud Only' }),
    ]);
    validCloud.lastModified = 9999;
    mocks.loadFromFirestore.mockResolvedValue(validCloud);
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    await store.dispatch(syncStateWithFirestore());
    const titles = store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.title);
    expect(titles).toContain('Cloud Only');
  });
});
