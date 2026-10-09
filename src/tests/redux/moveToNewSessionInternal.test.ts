import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  moveToNewSessionInternal,
  replaceState,
  type CarriedRef,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { getStringDate } from '../../utils/functions/local';
import {
  T0,
  W1_BOUNDS,
  container,
  s1,
  s2,
  s3,
  session,
  sessionIds,
  sessionIn,
  tab,
  tabIds,
  win,
  windowIn,
} from '../fixtures/sessionMoveFixture';

// KAN-394 P3 Task 13. moveToNewSessionInternal makes a session on top and
// moves the carried item into it, selected. The source is stamped at `now`,
// the new session at `now + 1`.
//
// S1: w1 [t1, g1a*g1, g1b*g1, t2, t4*g2], w2 [t3]. S2: d1, d2. S3: x1.

const NEW = 'NEW';
const NEW_WINDOW = 'NEW-W';
const NS = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const FALLBACK = 'Fallback';

const tabRef = (tabId: string, windowId = 'w1'): CarriedRef => ({
  kind: 'tab',
  tabGroupId: 'S1',
  windowId,
  tabId,
});
const groupRef = (groupId: string): CarriedRef => ({
  kind: 'group',
  tabGroupId: 'S1',
  windowId: 'w1',
  groupId,
});
const windowRef = (windowId: string): CarriedRef => ({
  kind: 'window',
  tabGroupId: 'S1',
  windowId,
});

const seeded = (c: TabMasterContainer = container()): TabMasterContainer =>
  reducer(undefined, replaceState(c));

const movedInto = (
  state: TabMasterContainer,
  carried: CarriedRef,
  typedTitle = '',
  now = T0
) =>
  reducer(
    state,
    moveToNewSessionInternal(carried, FALLBACK, typedTitle, {
      tabGroupId: NEW,
      newWindowId: NEW_WINDOW,
      remintNamespace: NS,
      now,
    })
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a tab moves into a new session', () => {
  it('one session on top, selected, named by the tab, holding the tab in an unnamed window with its source bounds', () => {
    const before = seeded();
    const next = movedInto(before, tabRef('t1'));

    expect(sessionIds(next)).toEqual([NEW, 'S1', 'S3', 'S2']);
    const made = sessionIn(next, NEW);
    expect(made.title).toBe('t1');
    expect(made.isSelected).toBe(true);
    expect(next.selectedTabGroupId).toBe(NEW);
    expect(next.tabGroups.filter((g) => g.isSelected)).toHaveLength(1);
    expect(made.windowCount).toBe(1);
    expect(made.tabCount).toBe(1);

    const w = made.windows[0];
    expect(w.windowId).toBe(NEW_WINDOW);
    expect(w.title).toBe('');
    expect(w.windowHeight).toBe(W1_BOUNDS.height);
    expect(w.windowWidth).toBe(W1_BOUNDS.width);
    expect(w.windowOffsetTop).toBe(W1_BOUNDS.top);
    expect(w.windowOffsetLeft).toBe(W1_BOUNDS.left);
    expect(tabIds(w)).toEqual(['t1']);
    expect(w.tabs[0].url).toBe('https://t1.test/');

    expect(tabIds(windowIn(next, 'S1', 'w1'))).toEqual([
      'g1a',
      'g1b',
      't2',
      't4',
    ]);
    expect(sessionIn(next, 'S1').tabCount).toBe(5);
  });
});

describe('a group moves into a new session', () => {
  it('the band travels, and the session is named by the group', () => {
    const next = movedInto(seeded(), groupRef('g1'));
    const made = sessionIn(next, NEW);

    expect(made.title).toBe('Group g1');
    expect(tabIds(made.windows[0])).toEqual(['g1a', 'g1b']);
    expect(made.windows[0].chromeTabGroups?.map((g) => g.groupId)).toEqual([
      'g1',
    ]);
    expect(
      windowIn(next, 'S1', 'w1').chromeTabGroups?.map((g) => g.groupId)
    ).toEqual(['g2']);
  });
});

describe('a window moves into a new session', () => {
  it('the window itself travels, and names the session', () => {
    const next = movedInto(seeded(), windowRef('w1'));
    const made = sessionIn(next, NEW);

    expect(made.title).toBe('Window w1');
    expect(made.windows.map((w) => w.windowId)).toEqual(['w1']);
    expect(made.windows[0].title).toBe('Window w1');
    expect(made.windows[0].windowHeight).toBe(W1_BOUNDS.height);
    expect(made.windows[0].windowWidth).toBe(W1_BOUNDS.width);
    expect(made.windows[0].windowOffsetTop).toBe(W1_BOUNDS.top);
    expect(made.windows[0].windowOffsetLeft).toBe(W1_BOUNDS.left);
    expect(tabIds(made.windows[0])).toEqual(['t1', 'g1a', 'g1b', 't2', 't4']);
    expect(made.tabCount).toBe(5);
    expect(sessionIn(next, 'S1').windows.map((w) => w.windowId)).toEqual([
      'w2',
    ]);
  });
});

describe('the name', () => {
  const blankTab = { ...tab('b'), title: '  ' };
  const blanks = () =>
    container([
      s3(),
      s2(),
      session('S1', 'Source', T0 - 1, [
        { ...win('w1', [blankTab]), title: '' },
        win('w2', [tab('t3')]),
      ]),
    ]);

  it('blank everything falls back', () => {
    const next = movedInto(seeded(blanks()), windowRef('w1'));
    expect(sessionIn(next, NEW).title).toBe(FALLBACK);
  });

  it('a typed name wins over the item and the fallback', () => {
    const next = movedInto(seeded(), tabRef('t1'), '  My trip ');
    expect(sessionIn(next, NEW).title).toBe('My trip');
  });

  it('a blank typed name is no name: the item names it, then the fallback', () => {
    expect(sessionIn(movedInto(seeded(), tabRef('t1'), '   '), NEW).title).toBe(
      't1'
    );
    expect(
      sessionIn(movedInto(seeded(blanks()), windowRef('w1'), '  '), NEW).title
    ).toBe(FALLBACK);
  });
});

describe('the source empties (N5a)', () => {
  const lonely = () =>
    container([
      s3(),
      s2(),
      session('S1', 'Source', T0 - 3_600_000, [win('w2', [tab('t3')])]),
    ]);

  it.each([
    ['its only tab', tabRef('t3', 'w2')],
    ['its only window', windowRef('w2')],
  ])('%s: the source is buried and the new session holds it', (_, carried) => {
    const next = movedInto(seeded(lonely()), carried);

    expect(sessionIds(next)).toEqual([NEW, 'S3', 'S2']);
    expect(next.deletedTabGroups).toEqual([
      { tabGroupId: 'S1', deletedAt: T0 },
    ]);
    expect(tabIds(sessionIn(next, NEW).windows[0])).toEqual(['t3']);
    expect(next.selectedTabGroupId).toBe(NEW);
  });
});

describe('stamps', () => {
  it('the source at now, the new session at now + 1', () => {
    const next = movedInto(seeded(), tabRef('t1'));

    expect(sessionIn(next, 'S1').lastModified).toBe(T0);
    expect(sessionIn(next, NEW).lastModified).toBe(T0 + 1);
    expect(sessionIn(next, NEW).contentModified).toBe(T0 + 1);
  });

  it('createdTime and createdAt are one instant: the action creator’s, not the clock at dispatch', () => {
    const action = moveToNewSessionInternal(tabRef('t1'), FALLBACK, '', {
      tabGroupId: NEW,
      newWindowId: NEW_WINDOW,
      remintNamespace: NS,
      now: T0,
    });
    vi.setSystemTime(T0 + 5_000);
    const next = reducer(seeded(), action);

    const made = sessionIn(next, NEW);
    expect(made.createdAt).toBe(T0);
    expect(made.createdTime).toBe(getStringDate(new Date(T0)));
    expect(sessionIn(next, 'S1').lastModified).toBe(T0);
    expect(made.lastModified).toBe(T0 + 1);
  });

  it('the new session sits where Save’s would: above every ranked session', () => {
    const ranked = container([
      { ...s3(), rank: T0 - 100 },
      { ...s2(), rank: T0 - 200 },
      { ...s1(), rank: T0 - 300 },
    ]);
    const next = movedInto(seeded(ranked), tabRef('t1'));
    expect(sessionIds(next)[0]).toBe(NEW);
    expect(sessionIds(next).slice(1)).toEqual(['S3', 'S2', 'S1']);
  });
});

describe('D20: an item that is not there changes nothing', () => {
  it('a group with no tabs', () => {
    const before = seeded(
      container([
        s3(),
        s2(),
        session('S1', 'Source', T0 - 1, [
          win(
            'w1',
            [tab('t1')],
            [{ groupId: 'empty', title: 'E', color: 'blue' }]
          ),
        ]),
      ])
    );
    const next = reducer(
      before,
      moveToNewSessionInternal(groupRef('empty'), FALLBACK, '', {
        tabGroupId: NEW,
        newWindowId: NEW_WINDOW,
        remintNamespace: NS,
        now: T0,
      })
    );
    expect(next).toBe(before);
  });
});
