import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  sortTabsBySite,
  sortTabsBySiteInternal,
  type TabMasterContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { SORT_TABS_BY_SITE_ACTION } from '../../utils/constants/actionTypes';
import {
  T0,
  container,
  group,
  s2,
  s3,
  session,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-694. Sort tabs by site, on a saved window: only the order changes, as one undoable edit.

// A tab on `site`.
const at = (tabId: string, site: string, extra: Partial<tabData> = {}) => ({
  ...tab(tabId),
  url: `https://${site}.test/${tabId}`,
  ...extra,
});

// w1 is out of order, has a pinned tab and a group; w2 is already sorted; w3 is out of order too.
const SITES = () =>
  session('S1', 'Sites', T0 - 3 * 3_600_000, [
    win(
      'w1',
      [
        at('x1', 'x'),
        at('y1', 'y'),
        at('p', 'z', { pinned: true }),
        at('x2', 'x'),
        at('c1', 'c', { chromeGroupId: 'g1' }),
        at('c2', 'c', { chromeGroupId: 'g1' }),
      ],
      [group('g1')]
    ),
    win('w2', [at('m1', 'm'), at('m2', 'm'), at('n1', 'n')]),
    win('w3', [at('q1', 'q'), at('r1', 'r'), at('q2', 'q')]),
  ]);

const ready = (c: TabMasterContainer = container([s3(), s2(), SITES()])) => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made;
};
type Store = ReturnType<typeof ready>['store'];
const data = (s: Store) => s.getState().tabContainerDataState;
const w1Ids = (s: Store) => tabIds(windowIn(data(s), 'S1', 'w1'));
const sort = (windowId = 'w1', now = T0) =>
  sortTabsBySiteInternal({ tabGroupId: 'S1', windowId, now });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('sortTabsBySiteInternal', () => {
  it("sorts the window's tabs and changes nothing else", () => {
    const { store } = ready();
    const before = structuredClone(sessionIn(data(store), 'S1'));
    store.dispatch(sort());
    const after = sessionIn(data(store), 'S1');
    expect(w1Ids(store)).toEqual(['p', 'c1', 'c2', 'x1', 'x2', 'y1']);
    const w1 = windowIn(data(store), 'S1', 'w1');
    for (const t of w1.tabs) {
      expect(t).toEqual(
        before.windows[0].tabs.find((o) => o.tabId === t.tabId)
      );
    }
    expect(w1.tabs.find((t) => t.tabId === 'x1')).not.toHaveProperty('key');
    expect(w1.chromeTabGroups).toEqual(before.windows[0].chromeTabGroups);
    expect(w1.tabCount).toBe(6);
    expect(after.windows[1]).toEqual(before.windows[1]);
    expect(after.windows[2]).toEqual(before.windows[2]);
    expect([after.windowCount, after.tabCount]).toEqual([3, 12]);
  });

  it('leaves a tab that was never pinned without a pinned field', () => {
    const { store } = ready();
    store.dispatch(sort());
    const w1 = windowIn(data(store), 'S1', 'w1');
    expect(w1.tabs.find((t) => t.tabId === 'x1')).not.toHaveProperty('pinned');
  });

  it('one undo puts the window back', () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    store.dispatch(sort());
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
    store.dispatch(undo());
    expect(w1Ids(store)).toEqual(['x1', 'y1', 'p', 'x2', 'c1', 'c2']);
  });

  it('is a content edit: stamped, dirty, first in the list', () => {
    const { store } = ready();
    store.dispatch(sort('w1', T0 + 5));
    const s = sessionIn(data(store), 'S1');
    expect([s.lastModified, s.contentModified]).toEqual([T0 + 5, T0 + 5]);
    expect(data(store).lastModified).toBe(T0 + 5);
    expect(data(store).tabGroups[0].tabGroupId).toBe('S1');
    expect(store.getState().globalState.isDirty).toBe(true);
  });

  it('keeps every tab when two share an id', () => {
    const { store } = ready(
      container([
        session('D1', 'Dups', T0, [
          win('w1', [
            at('dup', 'a', { title: 'first' }),
            at('x', 'b'),
            at('dup', 'a', { title: 'second' }),
          ]),
        ]),
      ])
    );
    store.dispatch(
      sortTabsBySiteInternal({ tabGroupId: 'D1', windowId: 'w1', now: T0 })
    );
    const w = windowIn(data(store), 'D1', 'w1');
    expect(w.tabs.map((t) => [t.tabId, t.title])).toEqual([
      ['dup', 'first'],
      ['dup', 'second'],
      ['x', 'x'],
    ]);
  });

  it('changes nothing for an already sorted window', () => {
    const { store } = ready();
    const before = data(store);
    const past = store.getState().undoRedo.past.length;
    store.dispatch(sort('w2', T0 + 5));
    expect(data(store)).toBe(before);
    expect(store.getState().undoRedo.past.length).toBe(past);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  it('changes nothing for a session or window that is not there', () => {
    const { store } = ready();
    const before = data(store);
    store.dispatch(sort('gone'));
    store.dispatch(
      sortTabsBySiteInternal({ tabGroupId: 'gone', windowId: 'w1', now: T0 })
    );
    expect(data(store)).toBe(before);
  });

  it('is captured for undo under its action type', () => {
    expect(sort().type).toBe(SORT_TABS_BY_SITE_ACTION);
  });
});

describe('sortTabsBySite', () => {
  const toasts = (s: Store) => s.getState().globalState.toasts;

  it('the toast says Sorted the tabs by site. with Undo', async () => {
    const { store } = ready();
    await store.dispatch(sortTabsBySite({ tabGroupId: 'S1', windowId: 'w1' }));
    expect(w1Ids(store)).toEqual(['p', 'c1', 'c2', 'x1', 'x2', 'y1']);
    const [toast] = toasts(store);
    expect(toasts(store)).toHaveLength(1);
    expect(toast.text).toBe(TOAST_MESSAGES.TABS_SORTED_BY_SITE);
    expect(toast.offersUndo).toBe(true);
  });

  it('an already sorted window is not an edit: no step, no stamp, no toast', async () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    const stamped = sessionIn(data(store), 'S1').lastModified;
    await store.dispatch(sortTabsBySite({ tabGroupId: 'S1', windowId: 'w2' }));
    expect(toasts(store)).toEqual([]);
    expect(store.getState().undoRedo.past.length).toBe(past);
    expect(sessionIn(data(store), 'S1').lastModified).toBe(stamped);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  it('says nothing for a window that is not there', async () => {
    const { store } = ready();
    await store.dispatch(
      sortTabsBySite({ tabGroupId: 'S1', windowId: 'gone' })
    );
    expect(toasts(store)).toEqual([]);
  });
});
