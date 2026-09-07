import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  saveToTabContainerInternal,
  moveTabInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-10 part 1: drag to reorder tabs within a saved window.
//
// Grouping is a PROPERTY on the tab, not a nested collection, so every move --
// within a run, into a band, out of a band -- is one splice on the flat array
// plus one field write. These tests are the shared layer under both drag
// prototypes; neither prototype's pointer handling is exercised here.
//
// The window deliberately mixes loose tabs with a two-member group AND a
// single-member group. The single-member group is what separates a correct
// prune ("the group I just left is now empty") from the tempting wrong one
// ("some group lost a tab"), which deletes a group a tab was only reordered
// inside.
const session = (): tabContainerData => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-07 00:00:00',
  createdAt: 1757203200000,
  windowCount: 1,
  tabCount: 5,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'w',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 5,
      title: 'Window',
      tabs: [
        {
          tabId: 'loose-1',
          favicon: '',
          title: 'Loose 1',
          url: 'https://a.co',
        },
        {
          tabId: 'a-1',
          favicon: '',
          title: 'A one',
          url: 'https://b.co',
          chromeGroupId: 'grp-a',
        },
        {
          tabId: 'a-2',
          favicon: '',
          title: 'A two',
          url: 'https://c.co',
          chromeGroupId: 'grp-a',
        },
        {
          tabId: 'loose-2',
          favicon: '',
          title: 'Loose 2',
          url: 'https://d.co',
        },
        {
          tabId: 'b-1',
          favicon: '',
          title: 'B one',
          url: 'https://e.co',
          chromeGroupId: 'grp-b',
        },
      ],
      chromeTabGroups: [
        { groupId: 'grp-a', title: 'Research', color: 'blue' },
        { groupId: 'grp-b', title: 'Solo', color: 'red' },
      ],
    },
  ],
});

const base = (): TabMasterContainer => ({
  lastModified: 1,
  selectedTabGroupId: null,
  tabGroups: [],
});

const seed = () => reducer(base(), saveToTabContainerInternal(session()));
const win = (s: TabMasterContainer) => s.tabGroups[0].windows[0];
const tabIds = (s: TabMasterContainer) => win(s).tabs.map((t) => t.tabId);
const groupIds = (s: TabMasterContainer) =>
  (win(s).chromeTabGroups ?? []).map((g) => g.groupId);
const tab = (s: TabMasterContainer, id: string) =>
  win(s).tabs.find((t) => t.tabId === id)!;

const move = (
  state: TabMasterContainer,
  tabId: string,
  toIndex: number,
  toChromeGroupId?: string
) =>
  reducer(
    state,
    moveTabInternal({
      tabGroupId: 'tg',
      windowId: 'w',
      tabId,
      toIndex,
      toChromeGroupId,
    })
  );

// THE INDEX CONTRACT, pinned because it is the one thing about a reorder API
// that is silently ambiguous: toIndex is where the tab ENDS UP in the resulting
// array, which is what dnd-kit's arrayMove means by `to`. The alternative --
// an index into the list as it stood before the tab was lifted out -- differs
// by exactly one on every downward move, and a prototype built against the
// other reading would be subtly wrong in a way no type can catch.
describe('the toIndex contract', () => {
  beforeEach(() => localStorage.clear());

  it('places the tab AT toIndex in the result, moving down', () => {
    const after = move(seed(), 'loose-1', 3);
    expect(tabIds(after)[3]).toBe('loose-1');
  });

  it('places the tab AT toIndex in the result, moving up', () => {
    const after = move(seed(), 'b-1', 1, 'grp-b');
    expect(tabIds(after)[1]).toBe('b-1');
  });

  it('puts an index past the end at the end, keeping every tab', () => {
    const after = move(seed(), 'loose-1', 99);
    expect(tabIds(after)).toHaveLength(5);
    expect(tabIds(after)[4]).toBe('loose-1');
  });

  // splice reads a negative start as an offset from the END, so an unguarded
  // -1 lands the tab second-from-last instead of first -- a wrong position
  // rather than an error, which is the kind that ships.
  it('puts a negative index at the front, not near the back', () => {
    const after = move(seed(), 'loose-2', -1);
    expect(tabIds(after)).toHaveLength(5);
    expect(tabIds(after)[0]).toBe('loose-2');
  });
});

describe('moving a tab within a saved window', () => {
  beforeEach(() => localStorage.clear());

  it('reorders within an ungrouped stretch', () => {
    const after = move(seed(), 'loose-2', 0);
    expect(tabIds(after)).toEqual(['loose-2', 'loose-1', 'a-1', 'a-2', 'b-1']);
  });

  it('leaves an ungrouped tab ungrouped', () => {
    const after = move(seed(), 'loose-2', 0);
    expect('chromeGroupId' in tab(after, 'loose-2')).toBe(false);
  });

  it('reorders within a band without changing membership', () => {
    const after = move(seed(), 'a-2', 1, 'grp-a');
    expect(tabIds(after)).toEqual(['loose-1', 'a-2', 'a-1', 'loose-2', 'b-1']);
    expect(tab(after, 'a-2').chromeGroupId).toBe('grp-a');
  });

  it('joins the group when dropped into a band', () => {
    const after = move(seed(), 'loose-1', 1, 'grp-a');
    expect(tab(after, 'loose-1').chromeGroupId).toBe('grp-a');
  });

  it('leaves the group when dropped outside every band', () => {
    const after = move(seed(), 'a-1', 4);
    expect(tab(after, 'a-1').chromeGroupId).toBeUndefined();
  });

  // Firestore's setDoc rejects an explicit `undefined` outright -- that is
  // KAN-48. Absent is the stored representation, and a deep-equal assertion
  // cannot tell the two apart, so this checks the key itself.
  it('DELETES the group key rather than setting it undefined', () => {
    const after = move(seed(), 'a-1', 4);
    expect('chromeGroupId' in tab(after, 'a-1')).toBe(false);
  });
});

describe('what a move does to the group list', () => {
  beforeEach(() => localStorage.clear());

  it('prunes a group whose last member was dragged out', () => {
    const after = move(seed(), 'b-1', 0);
    expect(groupIds(after)).toEqual(['grp-a']);
  });

  it('keeps a group that still has members', () => {
    const after = move(seed(), 'a-1', 4);
    expect(groupIds(after)).toEqual(['grp-a', 'grp-b']);
  });

  // The case a "did any group just lose a tab" implementation deletes: the
  // group neither gained nor lost a member, because source and destination are
  // the same group.
  it('keeps a single-member group reordered within itself', () => {
    const after = move(seed(), 'b-1', 4, 'grp-b');
    expect(groupIds(after)).toEqual(['grp-a', 'grp-b']);
    expect(tab(after, 'b-1').chromeGroupId).toBe('grp-b');
  });

  it('prunes only the group that emptied, when a tab moves between groups', () => {
    const after = move(seed(), 'b-1', 1, 'grp-a');
    expect(groupIds(after)).toEqual(['grp-a']);
    expect(tab(after, 'b-1').chromeGroupId).toBe('grp-a');
  });
});

describe('what a move must not disturb', () => {
  beforeEach(() => localStorage.clear());

  it('changes no counts', () => {
    const before = seed();
    const after = move(before, 'a-1', 4);
    expect(after.tabGroups[0].tabCount).toBe(before.tabGroups[0].tabCount);
    expect(after.tabGroups[0].windowCount).toBe(
      before.tabGroups[0].windowCount
    );
    expect(win(after).tabCount).toBe(win(before).tabCount);
  });

  // touch, not stampCreated. stampCreated resets createdAt, and the merge
  // orders the session list by createdInstant -- so calling it here would send
  // a session to the top of the left pane because a tab inside it was nudged.
  it('advances lastModified without restamping creation', () => {
    const before = seed();
    const after = move(before, 'a-1', 4);
    expect(after.tabGroups[0].createdAt).toBe(before.tabGroups[0].createdAt);
    expect(after.tabGroups[0].createdTime).toBe(
      before.tabGroups[0].createdTime
    );
    expect(after.tabGroups[0].lastModified).toBeGreaterThanOrEqual(
      before.tabGroups[0].lastModified ?? 0
    );
  });

  it('leaves every other tab in its original relative order', () => {
    const after = move(seed(), 'a-1', 4);
    expect(tabIds(after)).toEqual(['loose-1', 'a-2', 'loose-2', 'b-1', 'a-1']);
  });
});

// A drop that lands the tab exactly where it started is not an edit. Left
// unguarded it still stamps lastModified, writes localStorage, dirties the
// container for a cloud write and pushes an undo step -- for a change the user
// cannot see. Picking a tab up and putting it back is a normal thing to do.
describe('a move that changes nothing', () => {
  // The clock is driven, not read. Date.now() returns the same millisecond for
  // a seed and a move in the same tick, so lastModified cannot tell "stamped"
  // from "not stamped" on a real clock -- an earlier version of these tests
  // passed for exactly that reason while proving nothing.
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const later = <T>(fn: () => T): T => {
    vi.advanceTimersByTime(5000);
    return fn();
  };

  it('does not stamp the session when index and group are unchanged', () => {
    const before = seed();
    const after = later(() => move(before, 'a-1', 1, 'grp-a'));
    expect(after.tabGroups[0].lastModified).toBe(
      before.tabGroups[0].lastModified
    );
  });

  it('leaves the order alone', () => {
    const before = seed();
    const after = later(() => move(before, 'a-1', 1, 'grp-a'));
    expect(tabIds(after)).toEqual(tabIds(before));
  });

  // The guard must compare BOTH axes. Dropping a tab in place but inside a band
  // changes its membership and is a real edit.
  it('CONTROL: dropping in place INTO a group is still applied', () => {
    const before = seed();
    const after = later(() => move(before, 'loose-1', 0, 'grp-a'));
    expect(tab(after, 'loose-1').chromeGroupId).toBe('grp-a');
    expect(after.tabGroups[0].lastModified).not.toBe(
      before.tabGroups[0].lastModified
    );
  });

  it('CONTROL: dropping in place OUT of a group is still applied', () => {
    const before = seed();
    const after = later(() => move(before, 'a-1', 1));
    expect('chromeGroupId' in tab(after, 'a-1')).toBe(false);
    expect(after.tabGroups[0].lastModified).not.toBe(
      before.tabGroups[0].lastModified
    );
  });
});

describe('a move for data that is no longer there', () => {
  beforeEach(() => localStorage.clear());

  const unknown = (
    state: TabMasterContainer,
    params: { tabGroupId?: string; windowId?: string; tabId?: string }
  ) =>
    reducer(
      state,
      moveTabInternal({
        tabGroupId: params.tabGroupId ?? 'tg',
        windowId: params.windowId ?? 'w',
        tabId: params.tabId ?? 'loose-1',
        toIndex: 0,
      })
    );

  it('is a no-op for an unknown session', () => {
    const before = seed();
    expect(tabIds(unknown(before, { tabGroupId: 'nope' }))).toEqual(
      tabIds(before)
    );
  });

  it('is a no-op for an unknown window', () => {
    const before = seed();
    expect(tabIds(unknown(before, { windowId: 'nope' }))).toEqual(
      tabIds(before)
    );
  });

  it('is a no-op for an unknown tab', () => {
    const before = seed();
    expect(tabIds(unknown(before, { tabId: 'nope' }))).toEqual(tabIds(before));
  });
});
