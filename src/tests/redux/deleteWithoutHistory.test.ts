import { describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  deleteTabContainerInternal,
  deleteTabContainerWithoutHistory,
  replaceState,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setPresentStartup, undo } from '../../redux/slices/undoRedoSlice';
import { IS_DIRTY_ACTION } from '../../utils/constants/actionTypes';

// The open-time cleanup deletes and syncs, but leaves ⌘Z nothing to undo.

type Store = ReturnType<typeof makeTestStore>['store'];

function loaded() {
  const made = makeTestStore();
  made.store.dispatch(
    replaceState(
      buildContainer([
        buildSession({ tabGroupId: 'a', title: 'A' }),
        buildSession({ tabGroupId: 'b', title: 'B' }),
      ])
    )
  );
  made.store.dispatch(
    setPresentStartup({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.seen.length = 0;
  return made;
}
const titles = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.title);

describe('deleteTabContainerWithoutHistory', () => {
  test('deletes and syncs, records no undo step, and moves present with it', () => {
    const { store, seen } = loaded();
    store.dispatch(deleteTabContainerWithoutHistory('a'));
    expect(titles(store)).toEqual(['B']);
    expect(seen).toContain(IS_DIRTY_ACTION);
    const { past, present } = store.getState().undoRedo;
    expect(past).toEqual([]);
    expect(present.tabContainerDataState.tabGroups.map((g) => g.title)).toEqual(
      ['B']
    );
    store.dispatch(undo());
    expect(titles(store)).toEqual(['B']);
  });

  test('an edit after it undoes to the list without the session', () => {
    const { store } = loaded();
    store.dispatch(deleteTabContainerWithoutHistory('a'));
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'b', editableTitle: 'B2' })
    );
    store.dispatch(undo());
    expect(titles(store)).toEqual(['B']);
  });

  test('CONTROL: the ordinary delete is one undo step', () => {
    const { store } = loaded();
    store.dispatch(deleteTabContainerInternal('a'));
    store.dispatch(undo());
    expect(titles(store)).toEqual(['A', 'B']);
  });
});
