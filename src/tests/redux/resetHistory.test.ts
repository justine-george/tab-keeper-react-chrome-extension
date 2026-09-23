import { describe, it, expect, vi } from 'vitest';

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

import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import {
  replaceState,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { IS_DIRTY_ACTION } from '../../utils/constants/actionTypes';

describe('resetHistory', () => {
  it('empties past and future, and makes the given state present with no added ids', () => {
    const { store } = makeTestStore();
    store.dispatch(
      replaceState(buildContainer([buildSession({ tabGroupId: 'a' })]))
    );
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'One' })
    );
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'Two' })
    );
    store.dispatch(undo()); // future is now non-empty too
    const incoming = buildContainer([buildSession({ tabGroupId: 'z' })]);

    store.dispatch(resetHistory({ tabContainerDataState: incoming }));

    const h = store.getState().undoRedo;
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.present).toEqual({
      tabContainerDataState: incoming,
      addedTabGroupIds: [],
    });
  });

  it('dispatches no sync', () => {
    const { store, seen } = makeTestStore();
    seen.length = 0;
    store.dispatch(resetHistory({ tabContainerDataState: buildContainer([]) }));
    expect(seen).not.toContain(IS_DIRTY_ACTION); // imported from actionTypes, never a literal
  });
});
