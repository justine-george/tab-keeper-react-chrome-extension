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
  sortGroupTabsBySite,
  sortGroupTabsBySiteInternal,
  type TabMasterContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { SORT_GROUP_TABS_BY_SITE_ACTION } from '../../utils/constants/actionTypes';
import { isSavedGroupSortedBySite } from '../../utils/functions/sortBySite';
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

// KAN-746. Sort tabs by site inside one saved group: only that group's order changes, as one undoable edit.

const at = (tabId: string, site: string, extra: Partial<tabData> = {}) => ({
  ...tab(tabId),
  url: `https://${site}.test/${tabId}`,
  ...extra,
});
const inG = (g: string) => ({ chromeGroupId: g });

// w1: loose tabs out of order around g1 (out of order) and g2 (sorted).
const BEFORE = ['y1', 'b1', 'a1', 'b2', 'x1', 'y2', 'c1', 'c2'];
const SITES = () =>
  session('S1', 'Sites', T0 - 3 * 3_600_000, [
    win(
      'w1',
      [
        at('y1', 'y'),
        at('b1', 'b', inG('g1')),
        at('a1', 'a', inG('g1')),
        at('b2', 'b', inG('g1')),
        at('x1', 'x'),
        at('y2', 'y'),
        at('c1', 'c', inG('g2')),
        at('c2', 'c', inG('g2')),
      ],
      [group('g1'), group('g2')]
    ),
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
const sort = (groupId = 'g1', now = T0) =>
  sortGroupTabsBySiteInternal({
    tabGroupId: 'S1',
    windowId: 'w1',
    groupId,
    now,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('isSavedGroupSortedBySite', () => {
  it('reads one group, not the window', () => {
    const w = SITES().windows[0];
    expect(isSavedGroupSortedBySite(w, 'g1')).toBe(false);
    expect(isSavedGroupSortedBySite(w, 'g2')).toBe(true);
  });
});

describe('sortGroupTabsBySiteInternal', () => {
  it("sorts the group's tabs and moves nothing else", () => {
    const { store } = ready();
    const before = structuredClone(sessionIn(data(store), 'S1'));
    store.dispatch(sort());
    expect(w1Ids(store)).toEqual([
      'y1',
      'b1',
      'b2',
      'a1',
      'x1',
      'y2',
      'c1',
      'c2',
    ]);
    const w1 = windowIn(data(store), 'S1', 'w1');
    for (const t of w1.tabs) {
      expect(t).toEqual(
        before.windows[0].tabs.find((o) => o.tabId === t.tabId)
      );
    }
    expect(w1.chromeTabGroups).toEqual(before.windows[0].chromeTabGroups);
  });

  it('one undo puts the group back', () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    store.dispatch(sort());
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
    store.dispatch(undo());
    expect(w1Ids(store)).toEqual(BEFORE);
  });

  it('is a content edit: stamped, dirty, first in the list', () => {
    const { store } = ready();
    store.dispatch(sort('g1', T0 + 5));
    const s = sessionIn(data(store), 'S1');
    expect([s.lastModified, s.contentModified]).toEqual([T0 + 5, T0 + 5]);
    expect(data(store).lastModified).toBe(T0 + 5);
    expect(data(store).tabGroups[0].tabGroupId).toBe('S1');
    expect(store.getState().globalState.isDirty).toBe(true);
  });

  it('changes nothing for an already sorted group', () => {
    const { store } = ready();
    const before = data(store);
    const past = store.getState().undoRedo.past.length;
    store.dispatch(sort('g2', T0 + 5));
    expect(data(store)).toBe(before);
    expect(store.getState().undoRedo.past.length).toBe(past);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  it('changes nothing for a session, window or group that is not there', () => {
    const { store } = ready();
    const before = data(store);
    store.dispatch(sort('gone'));
    store.dispatch(
      sortGroupTabsBySiteInternal({
        tabGroupId: 'S1',
        windowId: 'gone',
        groupId: 'g1',
        now: T0,
      })
    );
    store.dispatch(
      sortGroupTabsBySiteInternal({
        tabGroupId: 'gone',
        windowId: 'w1',
        groupId: 'g1',
        now: T0,
      })
    );
    expect(data(store)).toBe(before);
  });

  it('is captured for undo under its action type', () => {
    expect(sort().type).toBe(SORT_GROUP_TABS_BY_SITE_ACTION);
  });
});

describe('sortGroupTabsBySite', () => {
  const toasts = (s: Store) => s.getState().globalState.toasts;
  const params = (groupId: string) => ({
    tabGroupId: 'S1',
    windowId: 'w1',
    groupId,
  });

  it('the toast says Sorted the tabs by site. with Undo', async () => {
    const { store } = ready();
    await store.dispatch(sortGroupTabsBySite(params('g1')));
    expect(w1Ids(store)).toEqual([
      'y1',
      'b1',
      'b2',
      'a1',
      'x1',
      'y2',
      'c1',
      'c2',
    ]);
    const [toast] = toasts(store);
    expect(toasts(store)).toHaveLength(1);
    expect(toast.text).toBe(TOAST_MESSAGES.TABS_SORTED_BY_SITE);
    expect(toast.offersUndo).toBe(true);
  });

  it('an already sorted group is not an edit: no step, no stamp, no toast', async () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    const stamped = sessionIn(data(store), 'S1').lastModified;
    await store.dispatch(sortGroupTabsBySite(params('g2')));
    expect(toasts(store)).toEqual([]);
    expect(store.getState().undoRedo.past.length).toBe(past);
    expect(sessionIn(data(store), 'S1').lastModified).toBe(stamped);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  it('says nothing for a group that is not there', async () => {
    const { store } = ready();
    await store.dispatch(sortGroupTabsBySite(params('gone')));
    expect(toasts(store)).toEqual([]);
  });
});
