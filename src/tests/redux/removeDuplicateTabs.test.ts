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
  removeDuplicateTabs,
  removeDuplicateTabsInternal,
  replaceState,
  type TabMasterContainer,
  type tabData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { countDuplicateTabs } from '../../utils/functions/duplicateTabs';
import {
  T0,
  container,
  group,
  s2,
  s3,
  session,
  sessionIds,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIds,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-609. Remove duplicate tabs: the first copy of each address, in reading
// order, stays; every later copy goes, as one undoable edit.

// A tab at the same address as `of`.
const dup = (
  tabId: string,
  of: string,
  extra: Partial<tabData> = {}
): tabData => ({ ...tab(tabId), url: tab(of).url, ...extra });

// w1: a, b (g1), c, then a copy of a.
// w2: a pinned copy of b alone in g2, e and a copy of a in g3, then d.
// w3: only a copy of c.
// Four duplicates: a2, b2, a3, c2.
const DUPES = () =>
  session('S1', 'Dupes', T0 - 3 * 3_600_000, [
    win(
      'w1',
      [tab('a'), tab('b', 'g1'), tab('c'), dup('a2', 'a')],
      [group('g1')]
    ),
    win(
      'w2',
      [
        dup('b2', 'b', { chromeGroupId: 'g2', pinned: true }),
        tab('e', 'g3'),
        dup('a3', 'a', { chromeGroupId: 'g3' }),
        tab('d'),
      ],
      [group('g2'), group('g3')]
    ),
    win('w3', [dup('c2', 'c')]),
  ]);

const ready = (c: TabMasterContainer = container([s3(), s2(), DUPES()])) => {
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
const data = (s: ReturnType<typeof ready>['store']) =>
  s.getState().tabContainerDataState;
const remove = (tabGroupId = 'S1', now = T0) =>
  removeDuplicateTabsInternal({ tabGroupId, now });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('countDuplicateTabs', () => {
  it('counts every copy after the first, across windows', () => {
    expect(countDuplicateTabs(DUPES())).toBe(4);
  });

  it('is 0 when every address is different', () => {
    expect(countDuplicateTabs(s2())).toBe(0);
  });

  it('never counts a tab with no address', () => {
    const blank = session('B', 'Blank', T0, [
      win('w', [
        { ...tab('x'), url: '' },
        { ...tab('y'), url: '' },
      ]),
    ]);
    expect(countDuplicateTabs(blank)).toBe(0);
  });

  it('compares the address exactly: a #fragment or trailing slash is another page', () => {
    const near = session('N', 'Near', T0, [
      win('w', [
        { ...tab('x'), url: 'https://a.test/' },
        { ...tab('y'), url: 'https://a.test' },
        { ...tab('z'), url: 'https://a.test/#top' },
      ]),
    ]);
    expect(countDuplicateTabs(near)).toBe(0);
  });
});

describe('removeDuplicateTabsInternal', () => {
  it('keeps the first copy in reading order and recounts', () => {
    const { store } = ready();
    store.dispatch(remove());
    const s = sessionIn(data(store), 'S1');
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).toEqual(['a', 'b', 'c']);
    expect(tabIds(windowIn(data(store), 'S1', 'w2'))).toEqual(['e', 'd']);
    expect(windowIn(data(store), 'S1', 'w1').tabCount).toBe(3);
    expect(windowIn(data(store), 'S1', 'w2').tabCount).toBe(2);
    expect([s.windowCount, s.tabCount]).toEqual([2, 5]);
  });

  it('the copy that stays keeps its own group and pin', () => {
    const { store } = ready();
    store.dispatch(remove());
    const b = windowIn(data(store), 'S1', 'w1').tabs[1];
    expect(b.chromeGroupId).toBe('g1');
    expect(b.pinned).toBeUndefined();
  });

  it('drops a group it empties and keeps one that still has a member', () => {
    const { store } = ready();
    store.dispatch(remove());
    expect(
      windowIn(data(store), 'S1', 'w2').chromeTabGroups?.map((g) => g.groupId)
    ).toEqual(['g3']);
    expect(
      windowIn(data(store), 'S1', 'w1').chromeTabGroups?.map((g) => g.groupId)
    ).toEqual(['g1']);
  });

  it('drops a window it empties', () => {
    const { store } = ready();
    store.dispatch(remove());
    expect(windowIds(sessionIn(data(store), 'S1'))).toEqual(['w1', 'w2']);
  });

  it('forgets an active tab it removed', () => {
    const c = container([s3(), s2(), DUPES()]);
    sessionIn(c, 'S1').windows[0].activeTabId = 'a2';
    const { store } = ready(c);
    store.dispatch(remove());
    expect(windowIn(data(store), 'S1', 'w1').activeTabId).toBeUndefined();
  });

  it('leaves a split partner as an ordinary tab, as Delete tab does', () => {
    const split = session('S1', 'Split', T0 - 3 * 3_600_000, [
      win('w1', [
        tab('a'),
        dup('a2', 'a', { splitId: 'sp' }),
        {
          ...tab('f'),
          splitId: 'sp',
        },
      ]),
    ]);
    const { store } = ready(container([s3(), s2(), split]));
    store.dispatch(remove());
    const w1 = windowIn(data(store), 'S1', 'w1');
    expect(tabIds(w1)).toEqual(['a', 'f']);
    // Its pair is gone, so a restore opens it unsplit (splitPairs).
    expect(w1.tabs[1].splitId).toBe('sp');
  });

  it('is an edit to the session: stamped, and first in the list', () => {
    const { store } = ready();
    store.dispatch(remove('S1', T0 + 5));
    const s = sessionIn(data(store), 'S1');
    expect([s.lastModified, s.contentModified]).toEqual([T0 + 5, T0 + 5]);
    expect(data(store).lastModified).toBe(T0 + 5);
    expect(sessionIds(data(store))[0]).toBe('S1');
  });

  it('changes nothing when the session has no duplicates', () => {
    const { store } = ready();
    const before = data(store);
    store.dispatch(remove('S2'));
    expect(data(store)).toBe(before);
  });

  it('changes nothing for an id no session has', () => {
    const { store } = ready();
    const before = data(store);
    store.dispatch(remove('gone'));
    expect(data(store)).toBe(before);
  });

  it('is one undo step: ⌘Z brings every copy back in its place', () => {
    const { store } = ready();
    const before = structuredClone(sessionIn(data(store), 'S1'));
    const past = store.getState().undoRedo.past.length;
    store.dispatch(remove());
    expect(store.getState().globalState.isDirty).toBe(true);
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
    store.dispatch(undo());
    const back = sessionIn(data(store), 'S1');
    expect(back.windows).toEqual(before.windows);
    expect([back.windowCount, back.tabCount]).toEqual([3, 9]);
  });
});

describe('removeDuplicateTabs', () => {
  const toasts = (s: ReturnType<typeof ready>['store']) =>
    s.getState().globalState.toasts;

  it('removes them and says how many, with Undo', async () => {
    const { store } = ready();
    await store.dispatch(removeDuplicateTabs({ tabGroupId: 'S1' }));
    expect(sessionIn(data(store), 'S1').tabCount).toBe(5);
    const [toast] = toasts(store);
    expect(toasts(store)).toHaveLength(1);
    expect(toast.text).toBe(TOAST_MESSAGES.DUPLICATE_TABS_REMOVED);
    expect(toast.params).toEqual({ count: 4 });
    expect(toast.offersUndo).toBe(true);
  });

  it('does nothing and says nothing when there are none', async () => {
    const { store } = ready();
    const past = store.getState().undoRedo.past.length;
    await store.dispatch(removeDuplicateTabs({ tabGroupId: 'S2' }));
    expect(toasts(store)).toEqual([]);
    expect(store.getState().undoRedo.past.length).toBe(past);
  });
});

// KAN-616. One window, or one group in it: only the tabs inside compete, so a
// copy of a tab that lives elsewhere is not a duplicate here.
//
// w1: a, then g1 holding x, y and a copy of x, then a copy of a and a copy of y
//     outside the group.
// w2: a copy of a, alone.
// In w1: a2, x2, y2. In g1: x2 only. In w2: none.
const SCOPED = () =>
  session('S1', 'Scoped', T0 - 3 * 3_600_000, [
    win(
      'w1',
      [
        tab('a'),
        tab('x', 'g1'),
        tab('y', 'g1'),
        dup('x2', 'x', { chromeGroupId: 'g1' }),
        dup('a2', 'a'),
        dup('y2', 'y'),
      ],
      [group('g1')]
    ),
    win('w2', [dup('a3', 'a')]),
  ]);
const scoped = () => ready(container([s3(), s2(), SCOPED()]));

describe('countDuplicateTabs within a window or group (KAN-616)', () => {
  it('a window counts its own repeats, grouped tabs included', () => {
    expect(countDuplicateTabs(SCOPED(), { windowId: 'w1' })).toBe(3);
  });

  it('a group counts repeats among its own members', () => {
    expect(
      countDuplicateTabs(SCOPED(), { windowId: 'w1', groupId: 'g1' })
    ).toBe(1);
  });

  it('a copy of a tab in another window is not a repeat in this one', () => {
    expect(countDuplicateTabs(SCOPED(), { windowId: 'w2' })).toBe(0);
  });

  it('is 0 for a window or group the session does not have', () => {
    expect(countDuplicateTabs(SCOPED(), { windowId: 'gone' })).toBe(0);
    expect(
      countDuplicateTabs(SCOPED(), { windowId: 'w1', groupId: 'gone' })
    ).toBe(0);
  });

  it('with no scope, still counts across the whole session', () => {
    expect(countDuplicateTabs(SCOPED())).toBe(4);
  });
});

describe('removeDuplicateTabsInternal within a window or group (KAN-616)', () => {
  const removeIn = (within: { windowId: string; groupId?: string }) =>
    removeDuplicateTabsInternal({ tabGroupId: 'S1', within, now: T0 });

  it('a window keeps its first copies and leaves other windows alone', () => {
    const { store } = scoped();
    store.dispatch(removeIn({ windowId: 'w1' }));
    const w1 = windowIn(data(store), 'S1', 'w1');
    expect(tabIds(w1)).toEqual(['a', 'x', 'y']);
    expect(w1.tabCount).toBe(3);
    expect(tabIds(windowIn(data(store), 'S1', 'w2'))).toEqual(['a3']);
    const s = sessionIn(data(store), 'S1');
    expect([s.windowCount, s.tabCount]).toEqual([2, 4]);
  });

  it('a group removes only its own repeats; copies outside it stay', () => {
    const { store } = scoped();
    store.dispatch(removeIn({ windowId: 'w1', groupId: 'g1' }));
    expect(tabIds(windowIn(data(store), 'S1', 'w1'))).toEqual([
      'a',
      'x',
      'y',
      'a2',
      'y2',
    ]);
    expect(sessionIn(data(store), 'S1').tabCount).toBe(6);
  });

  it('changes nothing in a window with no repeats of its own', () => {
    const { store } = scoped();
    const before = data(store);
    store.dispatch(removeIn({ windowId: 'w2' }));
    expect(data(store)).toBe(before);
  });

  it('is an edit to the session and one undo step', () => {
    const { store } = scoped();
    const before = structuredClone(sessionIn(data(store), 'S1'));
    const past = store.getState().undoRedo.past.length;
    store.dispatch(
      removeDuplicateTabsInternal({
        tabGroupId: 'S1',
        within: { windowId: 'w1' },
        now: T0 + 5,
      })
    );
    expect(sessionIn(data(store), 'S1').contentModified).toBe(T0 + 5);
    expect(store.getState().undoRedo.past.length).toBe(past + 1);
    store.dispatch(undo());
    expect(sessionIn(data(store), 'S1').windows).toEqual(before.windows);
  });
});

describe('removeDuplicateTabs within a window or group (KAN-616)', () => {
  it('toasts the count inside the scope, with Undo', async () => {
    const { store } = scoped();
    await store.dispatch(
      removeDuplicateTabs({ tabGroupId: 'S1', within: { windowId: 'w1' } })
    );
    const [toast] = store.getState().globalState.toasts;
    expect(toast.params).toEqual({ count: 3 });
    expect(toast.offersUndo).toBe(true);
  });

  it('says nothing for a window whose copies all live elsewhere', async () => {
    const { store } = scoped();
    await store.dispatch(
      removeDuplicateTabs({ tabGroupId: 'S1', within: { windowId: 'w2' } })
    );
    expect(store.getState().globalState.toasts).toEqual([]);
  });
});

// KAN-824. A rename never vanishes silently: the kept copy takes the first removed copy's name.
describe('Remove duplicate tabs keeps a name (KAN-824)', () => {
  const NAMED = () =>
    session('S9', 'Named', T0, [
      win('w1', [tab('a'), dup('a2', 'a', { customTitle: 'Keep me' })]),
      win('w2', [
        dup('a3', 'a', { customTitle: 'Not me' }),
        tab('b'),
        dup('b2', 'b', { customTitle: 'Other' }),
      ]),
    ]);
  const tabOf = (s: ReturnType<typeof ready>['store'], tabId: string) =>
    data(s)
      .tabGroups.find((g) => g.tabGroupId === 'S9')
      ?.windows.flatMap((w) => w.tabs)
      .find((t) => t.tabId === tabId);

  it("an unnamed kept copy takes the first removed copy's name, in reading order", () => {
    const { store } = ready(container([NAMED()]));
    store.dispatch(remove('S9'));
    expect(tabOf(store, 'a')?.customTitle).toBe('Keep me');
    expect(tabOf(store, 'b')?.customTitle).toBe('Other');
  });

  it('a kept copy with a name of its own keeps it', () => {
    const own = NAMED();
    own.windows[0].tabs[0] = { ...own.windows[0].tabs[0], customTitle: 'Mine' };
    const { store } = ready(container([own]));
    store.dispatch(remove('S9'));
    expect(tabOf(store, 'a')?.customTitle).toBe('Mine');
  });

  it('only a copy inside the scope passes its name on', () => {
    const { store } = ready(container([NAMED()]));
    store.dispatch(
      removeDuplicateTabsInternal({
        tabGroupId: 'S9',
        within: { windowId: 'w2' },
        now: T0,
      })
    );
    // In w2, a3 is the first copy of a, so it is kept with its own name; w1 is untouched.
    expect(tabOf(store, 'a')).not.toHaveProperty('customTitle');
    expect(tabOf(store, 'a3')?.customTitle).toBe('Not me');
    expect(tabOf(store, 'b')?.customTitle).toBe('Other');
  });
});
