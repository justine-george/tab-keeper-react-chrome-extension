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
  sortWindowGroupsByName,
  sortWindowGroupsByNameInternal,
  type TabMasterContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { SORT_WINDOW_GROUPS_BY_NAME_ACTION } from '../../utils/constants/actionTypes';
import {
  T0,
  container,
  s2,
  s3,
  session,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-746 Part 2. Sort groups by name in a saved window: only the groups move, into the slots groups held, as one undoable edit.

const inG = (g: string): Partial<tabData> => ({ chromeGroupId: g });
const at = (tabId: string, extra: Partial<tabData> = {}) => ({
  ...tab(tabId),
  ...extra,
});
const titled = (groupId: string, title: string) => ({
  groupId,
  title,
  color: 'blue',
});

// w1: a pinned tab, loose tabs between gZ "Zulu 10" (2 tabs), gA "zulu 2" and gU (unnamed). w2: groups already in order.
const BEFORE = ['p1', 'y1', 'z1', 'z2', 'x1', 'a1', 'u1', 'w1t'];
const AFTER = ['p1', 'y1', 'a1', 'x1', 'z1', 'z2', 'u1', 'w1t'];
const GROUPS = () =>
  session('S1', 'Groups', T0 - 3 * 3_600_000, [
    win(
      'w1',
      [
        at('p1', { pinned: true }),
        at('y1'),
        at('z1', inG('gZ')),
        at('z2', inG('gZ')),
        at('x1'),
        at('a1', inG('gA')),
        at('u1', inG('gU')),
        at('w1t'),
      ],
      [titled('gZ', 'Zulu 10'), titled('gA', 'zulu 2'), titled('gU', '')]
    ),
    win(
      'w2',
      [at('b1', inG('gB')), at('c1', inG('gC'))],
      [titled('gB', 'Beta'), titled('gC', 'Gamma')]
    ),
  ]);

const ready = (c: TabMasterContainer = container([s3(), s2(), GROUPS()])) => {
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
const idsOf = (s: Store, windowId = 'w1') =>
  tabIds(windowIn(data(s), 'S1', windowId));
const sort = (windowId = 'w1', now = T0) =>
  sortWindowGroupsByNameInternal({
    tabGroupId: 'S1',
    windowId,
    locale: 'en',
    now,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('sortWindowGroupsByNameInternal', () => {
  it('moves only the groups, into the slots groups held; every tab and group look kept', () => {
    const { store } = ready();
    const before = structuredClone(sessionIn(data(store), 'S1'));
    expect(idsOf(store)).toEqual(BEFORE);
    store.dispatch(sort());
    expect(idsOf(store)).toEqual(AFTER);
    const w1 = windowIn(data(store), 'S1', 'w1');
    for (const t of w1.tabs) {
      expect(t).toEqual(
        before.windows[0].tabs.find((o) => o.tabId === t.tabId)
      );
    }
    expect(w1.chromeTabGroups).toEqual(before.windows[0].chromeTabGroups);
    expect(idsOf(store, 'w2')).toEqual(['b1', 'c1']);
  });

  it('one undo puts the groups back', () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    store.dispatch(sort());
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
    store.dispatch(undo());
    expect(idsOf(store)).toEqual(BEFORE);
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

  it('changes nothing for a window whose groups are already in order', () => {
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
      sortWindowGroupsByNameInternal({
        tabGroupId: 'gone',
        windowId: 'w1',
        locale: 'en',
        now: T0,
      })
    );
    expect(data(store)).toBe(before);
  });

  it('is captured for undo under its action type', () => {
    expect(sort().type).toBe(SORT_WINDOW_GROUPS_BY_NAME_ACTION);
  });
});

describe('sortWindowGroupsByName', () => {
  const toasts = (s: Store) => s.getState().globalState.toasts;
  const params = (windowId: string) => ({
    tabGroupId: 'S1',
    windowId,
    locale: 'en',
  });

  it('the toast says Sorted the groups by name. with Undo', async () => {
    const { store } = ready();
    await store.dispatch(sortWindowGroupsByName(params('w1')));
    expect(idsOf(store)).toEqual(AFTER);
    const [toast] = toasts(store);
    expect(toasts(store)).toHaveLength(1);
    expect(toast.text).toBe(TOAST_MESSAGES.GROUPS_SORTED_BY_NAME);
    expect(toast.offersUndo).toBe(true);
  });

  it('a window already in order is not an edit: no step, no stamp, no toast', async () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    const stamped = sessionIn(data(store), 'S1').lastModified;
    await store.dispatch(sortWindowGroupsByName(params('w2')));
    expect(toasts(store)).toEqual([]);
    expect(store.getState().undoRedo.past.length).toBe(past);
    expect(sessionIn(data(store), 'S1').lastModified).toBe(stamped);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  it('says nothing for a window that is not there', async () => {
    const { store } = ready();
    await store.dispatch(sortWindowGroupsByName(params('gone')));
    expect(toasts(store)).toEqual([]);
  });
});
