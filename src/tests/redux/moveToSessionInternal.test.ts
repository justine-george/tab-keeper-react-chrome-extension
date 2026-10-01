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
  moveToSessionInternal,
  replaceState,
  type SessionMove,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';
import {
  partitionTabsIntoItems,
  itemIdOf,
} from '../../utils/functions/tabGroups';
import {
  T0,
  W1_BOUNDS,
  container,
  group,
  s1,
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

// KAN-350 Task 2. moveToSessionInternal moves a tab, a whole Chrome group or a
// whole window out of one saved session and into another, or into a new first
// window. Every stamp is pinned: the source at T0, the target at T0 + 1.

// A fixed namespace, so every re-minted id below is a literal.
const NS = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

const seeded = (c: TabMasterContainer = container()): TabMasterContainer =>
  reducer(undefined, replaceState(c));

const moved = (state: TabMasterContainer, move: SessionMove) =>
  reducer(state, moveToSessionInternal(move, NS));

const itemIds = (
  c: TabMasterContainer,
  tabGroupId: string,
  windowId: string
) => {
  const w = windowIn(c, tabGroupId, windowId);
  return partitionTabsIntoItems(w.tabs, w.chromeTabGroups).map(itemIdOf);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a tab moves into another session', () => {
  it('lands at the exact spot, and the counts move with it', () => {
    const next = moved(seeded(), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 },
    });

    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      'u1',
      't1',
      'u2',
      'u3',
    ]);
    expect(tabIds(windowIn(next, 'S1', 'w1'))).toEqual([
      'g1a',
      'g1b',
      't2',
      't4',
    ]);
    expect(windowIn(next, 'S1', 'w1').tabCount).toBe(4);
    expect(sessionIn(next, 'S1').tabCount).toBe(5);
    expect(windowIn(next, 'S2', 'd1').tabCount).toBe(4);
    expect(sessionIn(next, 'S2').tabCount).toBe(5);
    expect(sessionIn(next, 'S1').windowCount).toBe(2);
    expect(sessionIn(next, 'S2').windowCount).toBe(2);
    // Loose it was and loose it lands: no band was named.
    expect(windowIn(next, 'S2', 'd1').tabs[1].chromeGroupId).toBeUndefined();
  });

  it('joins the band it is dropped in, and leaves its old group behind', () => {
    const next = moved(seeded(), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'g1a' },
      to: {
        tabGroupId: 'S2',
        windowId: 'd1',
        toIndex: 2,
        toChromeGroupId: 'h1',
      },
    });

    const d1 = windowIn(next, 'S2', 'd1');
    expect(tabIds(d1)).toEqual(['u1', 'u2', 'g1a', 'u3']);
    expect(d1.tabs[2].chromeGroupId).toBe('h1');
    // Joining a band adds no entry: h1 is already there, and g1 did not come.
    expect(d1.chromeTabGroups).toEqual([group('h1')]);
    // CONTROL for the prune below: g1 still has g1b, so it stays.
    expect(windowIn(next, 'S1', 'w1').chromeTabGroups).toEqual([
      group('g1'),
      group('g2'),
    ]);
  });

  it('prunes the group entry a tab empties in its source window', () => {
    const next = moved(seeded(), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't4' },
      to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
    });

    expect(windowIn(next, 'S1', 'w1').chromeTabGroups).toEqual([group('g1')]);
    expect(windowIn(next, 'S2', 'd2').tabs[0]).toEqual(tab('t4'));
  });

  it('removes a source window it empties', () => {
    const next = moved(seeded(), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
      to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 1 },
    });

    expect(windowIds(sessionIn(next, 'S1'))).toEqual(['w1']);
    expect(sessionIn(next, 'S1').windowCount).toBe(1);
    expect(sessionIn(next, 'S1').tabCount).toBe(5);
    expect(tabIds(windowIn(next, 'S2', 'd2'))).toEqual(['u4', 't3']);
  });

  it('becomes a new first window with its source window bounds, named after its tab', () => {
    const next = moved(seeded(), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'g1a' },
      to: { tabGroupId: 'S2', newWindowId: 'nw' },
    });

    const target = sessionIn(next, 'S2');
    expect(windowIds(target)).toEqual(['nw', 'd1', 'd2']);
    expect(target.windows[0]).toEqual({
      windowId: 'nw',
      windowHeight: W1_BOUNDS.height,
      windowWidth: W1_BOUNDS.width,
      windowOffsetTop: W1_BOUNDS.top,
      windowOffsetLeft: W1_BOUNDS.left,
      tabCount: 1,
      // A captured window is titled with its first tab's title.
      title: 'g1a',
      // Out of its group: a new window has no band to join.
      tabs: [tab('g1a')],
    });
    expect(target.windowCount).toBe(3);
    expect(target.tabCount).toBe(5);
    expect(sessionIn(next, 'S1').tabCount).toBe(5);
  });

  it('a first tab with no title leaves the new window untitled', () => {
    const source = s1();
    source.windows[0].tabs[1] = { ...tab('g1a', 'g1'), title: '' };
    const next = moved(seeded(container([s3(), s2(), source])), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'g1a' },
      to: { tabGroupId: 'S2', newWindowId: 'nw' },
    });

    expect(sessionIn(next, 'S2').windows[0].title).toBe('');
  });
});

describe('a group moves into another session', () => {
  it('lands among the window items, taking its entry with it', () => {
    const next = moved(seeded(), {
      carried: {
        kind: 'group',
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
      },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 1 },
    });

    expect(itemIds(next, 'S2', 'd1')).toEqual([
      'tab:u1',
      'group:g1',
      'group:h1',
    ]);
    const d1 = windowIn(next, 'S2', 'd1');
    expect(tabIds(d1)).toEqual(['u1', 'g1a', 'g1b', 'u2', 'u3']);
    expect(d1.chromeTabGroups).toEqual([group('h1'), group('g1')]);
    const w1 = windowIn(next, 'S1', 'w1');
    expect(tabIds(w1)).toEqual(['t1', 't2', 't4']);
    expect(w1.chromeTabGroups).toEqual([group('g2')]);
    expect(w1.tabCount).toBe(3);
    expect(sessionIn(next, 'S1').tabCount).toBe(4);
    expect(d1.tabCount).toBe(5);
    expect(sessionIn(next, 'S2').tabCount).toBe(6);
  });

  it('becomes a new first window holding the group, with the source bounds', () => {
    const next = moved(seeded(), {
      carried: {
        kind: 'group',
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
      },
      to: { tabGroupId: 'S2', newWindowId: 'nw' },
    });

    const target = sessionIn(next, 'S2');
    expect(windowIds(target)).toEqual(['nw', 'd1', 'd2']);
    expect(target.windows[0]).toEqual({
      windowId: 'nw',
      windowHeight: W1_BOUNDS.height,
      windowWidth: W1_BOUNDS.width,
      windowOffsetTop: W1_BOUNDS.top,
      windowOffsetLeft: W1_BOUNDS.left,
      tabCount: 2,
      // The group's first tab names it, as capture names a window.
      title: 'g1a',
      tabs: [tab('g1a', 'g1'), tab('g1b', 'g1')],
      chromeTabGroups: [group('g1')],
    });
    expect(target.windowCount).toBe(3);
    expect(target.tabCount).toBe(6);
  });
});

describe('a window moves into another session', () => {
  it('lands at the window index, whole, and the counts move with it', () => {
    const before = seeded();
    const next = moved(before, {
      carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
      to: { tabGroupId: 'S2', toIndex: 1 },
    });

    const target = sessionIn(next, 'S2');
    expect(windowIds(target)).toEqual(['d1', 'w1', 'd2']);
    expect(windowIn(next, 'S2', 'w1')).toEqual(windowIn(before, 'S1', 'w1'));
    expect(target.windowCount).toBe(3);
    expect(target.tabCount).toBe(9);
    const source = sessionIn(next, 'S1');
    expect(windowIds(source)).toEqual(['w2']);
    expect(source.windowCount).toBe(1);
    expect(source.tabCount).toBe(1);
  });
});

describe('a move that empties its source session (S4 B, Q4 A)', () => {
  const lonely = () =>
    session('S1', 'Source', T0 - 3 * 3_600_000, [win('w2', [tab('t3')])]);

  it('removes the source and writes its tombstone', () => {
    const next = moved(seeded(container([s3(), s2(), lonely()])), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
      to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
    });

    expect(sessionIds(next)).toEqual(['S2', 'S3']);
    expect(next.deletedTabGroups).toEqual([
      { tabGroupId: 'S1', deletedAt: T0 },
    ]);
    expect(tabIds(windowIn(next, 'S2', 'd2'))).toEqual(['t3', 'u4']);
  });

  it('a removed window empties it the same way', () => {
    const next = moved(seeded(container([s3(), s2(), lonely()])), {
      carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
      to: { tabGroupId: 'S2', toIndex: 0 },
    });

    expect(sessionIds(next)).toEqual(['S2', 'S3']);
    expect(next.deletedTabGroups).toEqual([
      { tabGroupId: 'S1', deletedAt: T0 },
    ]);
  });

  it('selects the target when the emptied source was selected', () => {
    const next = moved(seeded(container([s3(), s2(), lonely()], 'S1')), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
      to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
    });

    expect(next.selectedTabGroupId).toBe('S2');
    expect(next.tabGroups.map((g) => [g.tabGroupId, g.isSelected])).toEqual([
      ['S2', true],
      ['S3', false],
    ]);
  });

  it('CONTROL: leaves another selection alone', () => {
    const next = moved(seeded(container([s3(), s2(), lonely()], 'S3')), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
      to: { tabGroupId: 'S2', windowId: 'd2', toIndex: 0 },
    });

    expect(next.selectedTabGroupId).toBe('S3');
    // The premise: the source really was emptied and removed.
    expect(sessionIds(next)).toEqual(['S2', 'S3']);
  });
});

describe('where the two sessions sit afterwards', () => {
  it('both go to the top, the target above the source', () => {
    const before = seeded();
    expect(sessionIds(before)).toEqual(['S3', 'S2', 'S1']);

    const next = moved(before, {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
    });

    expect(sessionIds(next)).toEqual(['S2', 'S1', 'S3']);
    expect(sessionIn(next, 'S1').contentModified).toBe(T0);
    expect(sessionIn(next, 'S2').contentModified).toBe(T0 + 1);
    expect(sessionIn(next, 'S1').lastModified).toBe(T0);
    expect(sessionIn(next, 'S2').lastModified).toBe(T0 + 1);
    // Untouched.
    expect(sessionIn(next, 'S3').contentModified).toBeUndefined();
  });

  // The target goes above even when the source was above it to begin with:
  // the ids ('S1' < 'S2') would tiebreak it the other way.
  it('the target goes above a source that sat above it', () => {
    const before = seeded(container([s3(), s1(), s2()]));
    const next = moved(before, {
      carried: { kind: 'tab', tabGroupId: 'S2', windowId: 'd2', tabId: 'u4' },
      to: { tabGroupId: 'S1', windowId: 'w2', toIndex: 0 },
    });

    expect(sessionIds(next)).toEqual(['S1', 'S2', 'S3']);
  });

  it('a list ranked by hand keeps both in their places', () => {
    const ranked = container([
      { ...s1(), rank: 3000 },
      { ...s3(), rank: 2000 },
      { ...s2(), rank: 1000 },
    ]);
    const next = moved(seeded(ranked), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
    });

    expect(sessionIds(next)).toEqual(['S1', 'S3', 'S2']);
    // The premise: the move did happen, and stamped both.
    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      't1',
      'u1',
      'u2',
      'u3',
    ]);
    expect(sessionIn(next, 'S2').contentModified).toBe(T0 + 1);
  });

  it('writes the result to localStorage', () => {
    const before = seeded();
    localStorage.clear();
    const next = moved(before, {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
    });

    const stored = loadFromLocalStorage('tabContainerData');
    if (!isValidTabMasterContainer(stored)) throw new Error('nothing stored');
    expect(stored).toEqual(next);
    expect(tabIds(windowIn(stored, 'S2', 'd1'))).toEqual([
      't1',
      'u1',
      'u2',
      'u3',
    ]);
  });
});

describe('a move inside one session', () => {
  it('into a new window is a move: the tab leaves its window for a new first one', () => {
    const next = moved(seeded(), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w2', tabId: 't3' },
      to: { tabGroupId: 'S1', newWindowId: 'nw' },
    });

    const s = sessionIn(next, 'S1');
    // w2 emptied and went; nw took its tab.
    expect(windowIds(s)).toEqual(['nw', 'w1']);
    expect(tabIds(windowIn(next, 'S1', 'nw'))).toEqual(['t3']);
    expect(s.windowCount).toBe(2);
    expect(s.tabCount).toBe(6);
  });

  it('a group into a new window keeps its own ids: they only collided with itself', () => {
    const next = moved(seeded(), {
      carried: {
        kind: 'group',
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
      },
      to: { tabGroupId: 'S1', newWindowId: 'nw' },
    });

    const nw = windowIn(next, 'S1', 'nw');
    expect(nw.chromeTabGroups).toEqual([group('g1')]);
    expect(nw.tabs).toEqual([tab('g1a', 'g1'), tab('g1b', 'g1')]);
    expect(sessionIn(next, 'S1').windowCount).toBe(3);
  });
});

// Same-session exact spots belong to tabDrop / groupDrop / windowDrop, and an
// id that does not resolve is data that is no longer there. Nothing is
// stamped, saved or changed: the state is the very same object.
describe('a move that is not this reducer’s to make changes nothing', () => {
  const cases: [string, SessionMove][] = [
    [
      'a tab to an exact spot in its own session',
      {
        carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
        to: { tabGroupId: 'S1', windowId: 'w2', toIndex: 0 },
      },
    ],
    [
      'a group to an exact spot in its own session',
      {
        carried: {
          kind: 'group',
          tabGroupId: 'S1',
          windowId: 'w1',
          groupId: 'g1',
        },
        to: { tabGroupId: 'S1', windowId: 'w2', toIndex: 0 },
      },
    ],
    [
      'a window to its own session',
      {
        carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
        to: { tabGroupId: 'S1', toIndex: 1 },
      },
    ],
    [
      'an unknown tab',
      {
        carried: {
          kind: 'tab',
          tabGroupId: 'S1',
          windowId: 'w1',
          tabId: 'nope',
        },
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
      },
    ],
    [
      'an unknown group',
      {
        carried: {
          kind: 'group',
          tabGroupId: 'S1',
          windowId: 'w1',
          groupId: 'nope',
        },
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
      },
    ],
    [
      'an unknown source window',
      {
        carried: { kind: 'window', tabGroupId: 'S1', windowId: 'nope' },
        to: { tabGroupId: 'S2', toIndex: 0 },
      },
    ],
    [
      'an unknown source session',
      {
        carried: {
          kind: 'tab',
          tabGroupId: 'nope',
          windowId: 'w1',
          tabId: 't1',
        },
        to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
      },
    ],
    [
      'an unknown destination session',
      {
        carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
        to: { tabGroupId: 'nope', windowId: 'd1', toIndex: 0 },
      },
    ],
    [
      'an unknown destination session for a new window',
      {
        carried: {
          kind: 'group',
          tabGroupId: 'S1',
          windowId: 'w1',
          groupId: 'g1',
        },
        to: { tabGroupId: 'nope', newWindowId: 'nw' },
      },
    ],
    [
      'an unknown destination window',
      {
        carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
        to: { tabGroupId: 'S2', windowId: 'nope', toIndex: 0 },
      },
    ],
    [
      'a band that is not in the destination window',
      {
        carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
        to: {
          tabGroupId: 'S2',
          windowId: 'd2',
          toIndex: 0,
          toChromeGroupId: 'h1',
        },
      },
    ],
  ];

  it.each(cases)('%s', (_name, move) => {
    const before = seeded();
    localStorage.clear();

    expect(moved(before, move)).toBe(before);
    expect(localStorage.getItem('tabContainerData')).toBeNull();
  });
});

// Review Focus 4. Legacy data and imports can carry the same id twice. A
// carried id already in the destination session is re-minted, so a moved
// group never merges with a same-id group and a tab never shares its id.
describe('ids that collide in the destination are re-minted', () => {
  it('a tab whose id the destination already holds gets a new one', () => {
    const target = s2();
    target.windows[1] = win('d2', [tab('u4'), tab('t1')]);
    target.tabCount = 5;
    const next = moved(seeded(container([s3(), target, s1()])), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
    });

    expect(tabIds(windowIn(next, 'S2', 'd1'))).toEqual([
      '6bb39a7b-d872-5921-8f65-8d62998f8eaf',
      'u1',
      'u2',
      'u3',
    ]);
    // The destination's own t1 keeps its id.
    expect(tabIds(windowIn(next, 'S2', 'd2'))).toEqual(['u4', 't1']);
  });

  it('a group whose id the destination window holds does not merge with it', () => {
    const target = s2();
    target.windows[0] = win(
      'd1',
      [tab('u1'), tab('u2', 'h1'), tab('u3', 'h1'), tab('u9', 'g1')],
      [group('h1'), group('g1')]
    );
    target.tabCount = 5;
    const next = moved(seeded(container([s3(), target, s1()])), {
      carried: {
        kind: 'group',
        tabGroupId: 'S1',
        windowId: 'w1',
        groupId: 'g1',
      },
      to: { tabGroupId: 'S2', windowId: 'd1', toIndex: 0 },
    });

    const fresh = '9124e376-44a0-5942-8cf3-e4c53a016db9';
    // Two bands: the moved one first, the destination's own g1 last.
    expect(itemIds(next, 'S2', 'd1')).toEqual([
      `group:${fresh}`,
      'tab:u1',
      'group:h1',
      'group:g1',
    ]);
    const d1 = windowIn(next, 'S2', 'd1');
    expect(d1.tabs.slice(0, 2)).toEqual([tab('g1a', fresh), tab('g1b', fresh)]);
    expect(d1.tabs[5]).toEqual(tab('u9', 'g1'));
    expect(d1.chromeTabGroups).toEqual([
      group('h1'),
      group('g1'),
      { ...group('g1'), groupId: fresh },
    ]);
  });

  it('a window whose id, and a tab of it, the destination holds gets new ones', () => {
    const target = s2();
    target.windows[1] = win('w2', [tab('t3')]);
    const next = moved(seeded(container([s3(), target, s1()])), {
      carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w2' },
      to: { tabGroupId: 'S2', toIndex: 0 },
    });

    const s = sessionIn(next, 'S2');
    expect(windowIds(s)).toEqual([
      '96782b5e-0d6c-5c0f-8b1d-edcd163e2e49',
      'd1',
      'w2',
    ]);
    expect(tabIds(s.windows[0])).toEqual([
      '2e724dfd-7de5-5e9d-bcb1-94afea5ff271',
    ]);
    // The destination's own window and tab keep theirs.
    expect(tabIds(windowIn(next, 'S2', 'w2'))).toEqual(['t3']);
  });

  it('a new window id the destination already holds gets a new one', () => {
    const target = s2();
    target.windows[1] = win('nw', [tab('u4')]);
    const next = moved(seeded(container([s3(), target, s1()])), {
      carried: { kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 't1' },
      to: { tabGroupId: 'S2', newWindowId: 'nw' },
    });

    expect(windowIds(sessionIn(next, 'S2'))).toEqual([
      '8fc7db64-5f27-52fb-af02-eac6f9869ae7',
      'd1',
      'nw',
    ]);
  });

  it('a window carrying a group whose id the destination holds rewrites its tabs too', () => {
    const target = s2();
    target.windows[1] = win('d2', [tab('u4', 'g2')], [group('g2')]);
    const next = moved(seeded(container([s3(), target, s1()])), {
      carried: { kind: 'window', tabGroupId: 'S1', windowId: 'w1' },
      to: { tabGroupId: 'S2', toIndex: 0 },
    });

    const w1 = windowIn(next, 'S2', 'w1');
    const fresh = '236ccebf-c1a9-58d9-969f-4a2d9200fddb';
    expect(w1.chromeTabGroups).toEqual([
      group('g1'),
      { ...group('g2'), groupId: fresh },
    ]);
    expect(w1.tabs[4]).toEqual(tab('t4', fresh));
    // g1 did not collide, so it and its tabs keep their ids.
    expect(w1.tabs[1]).toEqual(tab('g1a', 'g1'));
  });
});
