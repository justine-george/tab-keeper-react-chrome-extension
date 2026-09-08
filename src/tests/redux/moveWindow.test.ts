import { describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  saveToTabContainerInternal,
  moveWindowInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// KAN-129. A window's position inside a session is real storage: the merge
// resolves whole sessions last-writer-wins and emits the winner's windows[]
// verbatim (mergeTabData.ts:184-188), never re-sorting them. So reordering is
// an ordinary content edit, unlike the session order, which survivors.sort
// re-derives on every merge.

const win = (id: string, title: string, tabCount: number) => ({
  windowId: id,
  windowHeight: 100,
  windowWidth: 100,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount,
  title,
  tabs: Array.from({ length: tabCount }, (_, i) => ({
    tabId: `${id}-t${i}`,
    favicon: '',
    title: `${title} tab ${i}`,
    url: `https://${id}-${i}.test`,
  })),
});

// A factory, not a shared constant: the reducer mutates through Immer, which
// freezes whatever object it is handed, so a session reused across tests would
// arrive at the second dispatch already frozen.
const build = () => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-07 00:00:00',
  createdAt: Date.parse('2026-09-07T00:00:00Z'),
  windowCount: 3,
  // Deliberately unequal, so a reducer that recomputed counts from the moved
  // window rather than leaving them alone would show up.
  tabCount: 6,
  isAutoSave: false,
  isSelected: false,
  windows: [
    win('w1', 'First', 1),
    win('w2', 'Second', 2),
    win('w3', 'Third', 3),
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];

const seeded = () => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(build()));
  store.dispatch(setIsNotDirty());
  return store;
};

const session = (s: Store) => s.getState().tabContainerDataState.tabGroups[0];
const ids = (s: Store) => session(s).windows.map((w) => w.windowId);

describe('moveWindowInternal', () => {
  test('moves a window to the front', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w3', toIndex: 0 })
    );
    expect(ids(store)).toEqual(['w3', 'w1', 'w2']);
  });

  test('moves a window to the back', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w1', toIndex: 2 })
    );
    expect(ids(store)).toEqual(['w2', 'w3', 'w1']);
  });

  test('a window carries its tabs with it', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w3', toIndex: 0 })
    );
    const moved = session(store).windows[0];
    expect(moved.title).toBe('Third');
    expect(moved.tabs.map((t) => t.tabId)).toEqual(['w3-t0', 'w3-t1', 'w3-t2']);
  });

  // A reorder changes neither how many windows there are nor how many tabs
  // they hold. Recomputing either would be a chance to get it wrong.
  test('leaves the session counts untouched', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w1', toIndex: 2 })
    );
    expect(session(store).windowCount).toBe(3);
    expect(session(store).tabCount).toBe(6);
  });

  // touch, not stampCreated. createdAt is what the merge orders the session
  // list by, so resetting it would send the session to the top of the left
  // pane for a nudge the user made inside it.
  test('does not restamp the session as newly created', () => {
    const store = seeded();
    const before = session(store).createdAt;
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w1', toIndex: 2 })
    );
    expect(session(store).createdAt).toBe(before);
  });
});

describe('moveWindowInternal does nothing when there is nothing to do', () => {
  test('a drop in the same position is not an edit', () => {
    const store = seeded();
    const before = session(store).lastModified;

    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w2', toIndex: 1 })
    );

    expect(ids(store)).toEqual(['w1', 'w2', 'w3']);
    expect(session(store).lastModified).toBe(before);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  test('an unknown window id changes nothing', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'nope', toIndex: 0 })
    );
    expect(ids(store)).toEqual(['w1', 'w2', 'w3']);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  test('an unknown session id changes nothing', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'nope', windowId: 'w1', toIndex: 0 })
    );
    expect(ids(store)).toEqual(['w1', 'w2', 'w3']);
    expect(store.getState().globalState.isDirty).toBe(false);
  });
});

// The index is resolved rather than left to splice, because it is also
// compared against the source index to decide whether this is an edit at all.
// A raw out-of-range value would not equal the index it actually lands on, so
// the no-op guard above would miss a drop that moved nothing.
describe('moveWindowInternal clamps the destination', () => {
  test('past the end lands at the last position', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w1', toIndex: 99 })
    );
    expect(ids(store)).toEqual(['w2', 'w3', 'w1']);
  });

  test('below zero lands at the front', () => {
    const store = seeded();
    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w3', toIndex: -5 })
    );
    expect(ids(store)).toEqual(['w3', 'w1', 'w2']);
  });

  // The clamped value, not the raw one, is what the no-op guard compares --
  // so an out-of-range drop onto the position the window already occupies is
  // still not an edit.
  test('a clamped drop onto its own position is still not an edit', () => {
    const store = seeded();
    const before = session(store).lastModified;

    store.dispatch(
      moveWindowInternal({ tabGroupId: 'tg', windowId: 'w3', toIndex: 99 })
    );

    expect(ids(store)).toEqual(['w1', 'w2', 'w3']);
    expect(session(store).lastModified).toBe(before);
    expect(store.getState().globalState.isDirty).toBe(false);
  });
});
