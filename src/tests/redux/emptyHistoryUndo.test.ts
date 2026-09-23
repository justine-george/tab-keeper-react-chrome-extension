import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  ensureCloudSessionReady: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import {
  setFirebaseAuthed,
  setSignedIn,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import { grantCloudConsent } from '../../redux/slices/settingsDataStateSlice';
import {
  replaceState,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  redo,
  setPresentStartup,
  undo,
} from '../../redux/slices/undoRedoSlice';
import {
  IS_DIRTY_ACTION,
  TAB_CONTAINER_APPLY_UNDO_SNAPSHOT_ACTION,
} from '../../utils/constants/actionTypes';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-292. Ctrl+Z is not gated on isUndoable (MainContainer's keydown; only
// the button is). With `past` empty the undo reducer does nothing, but the
// middleware still dispatched applyUndoSnapshot(present) and setIsDirty():
// a write and a sync for nothing -- and after a later sync's merge, which
// goes through replaceState and never updates `present`, a revert of that
// merge.

// The constant, not a literal: the slice is 'globalState' (the thunks are
// 'global/...'), and a mistyped string makes every not.toContain vacuous.
const SET_DIRTY = IS_DIRTY_ACTION;
const a = buildSession({ tabGroupId: 'a', title: 'Local' });
const b = buildSession({ tabGroupId: 'b', title: 'Arrived from cloud' });

const readyStore = () => {
  const made = makeTestStore();
  made.store.dispatch(setUserId('u1'));
  made.store.dispatch(setSignedIn());
  made.store.dispatch(setFirebaseAuthed());
  made.store.dispatch(grantCloudConsent());
  return made;
};

describe('undo and redo with an empty history (KAN-292)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('an undo with nothing to undo dispatches no snapshot and no sync', () => {
    const { store, seen } = readyStore();
    store.dispatch(replaceState(buildContainer([a])));
    store.dispatch(
      setPresentStartup({ tabContainerDataState: buildContainer([a]) })
    );
    const before = localStorage.getItem('tabContainerData');
    seen.length = 0;

    store.dispatch(undo());

    expect(seen).not.toContain(TAB_CONTAINER_APPLY_UNDO_SNAPSHOT_ACTION);
    expect(seen).not.toContain(SET_DIRTY);
    expect(localStorage.getItem('tabContainerData')).toBe(before);
  });

  it('a redo with nothing to redo dispatches no snapshot and no sync', () => {
    const { store, seen } = readyStore();
    store.dispatch(replaceState(buildContainer([a])));
    seen.length = 0;

    store.dispatch(redo());

    expect(seen).not.toContain(TAB_CONTAINER_APPLY_UNDO_SNAPSHOT_ACTION);
    expect(seen).not.toContain(SET_DIRTY);
  });

  // The worse half: `present` goes stale after a later sync's merge.
  it('an empty-history undo after a merge leaves the merged session in place', () => {
    const { store } = readyStore();
    store.dispatch(
      setPresentStartup({ tabContainerDataState: buildContainer([a]) })
    );
    store.dispatch(replaceState(buildContainer([a, b]))); // a later merge

    store.dispatch(undo());

    const ids = store
      .getState()
      .tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
    expect(ids).toEqual(['a', 'b']);
  });

  // CONTROL: with history, undo still restores and still syncs.
  it('CONTROL: with a step to undo, undo still applies the snapshot and marks dirty', () => {
    const { store, seen } = readyStore();
    store.dispatch(replaceState(buildContainer([a])));
    store.dispatch(
      setPresentStartup({ tabContainerDataState: buildContainer([a]) })
    );
    store.dispatch(
      // any undoable edit
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'Renamed' })
    );
    seen.length = 0;

    store.dispatch(undo());

    expect(seen).toContain(TAB_CONTAINER_APPLY_UNDO_SNAPSHOT_ACTION);
    expect(seen).toContain(SET_DIRTY);
    expect(store.getState().tabContainerDataState.tabGroups[0].title).toBe(
      'Local'
    );
  });
});
