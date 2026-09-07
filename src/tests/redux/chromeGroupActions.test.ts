import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  addCurrTabToChromeGroupInternal,
  ungroupChromeTabGroup,
  deleteChromeTabGroupInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// The three actions that finish the Chrome tab group row, beside the rename
// added in KAN-107.

// A window whose tabs deliberately do NOT start with the group, so that a
// reducer which unshifts to the front of the window is distinguishable from
// one that splices next to the group's own members. partitionTabsIntoRuns
// emits a group at the position of its FIRST member, so an unshift would drag
// the whole group to the top of the window.
const session = (): tabContainerData => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-06 00:00:00',
  windowCount: 1,
  tabCount: 4,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'w',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 4,
      title: 'Window',
      tabs: [
        {
          tabId: 'loose-1',
          favicon: '',
          title: 'Loose 1',
          url: 'https://a.co',
        },
        {
          tabId: 'g-1',
          favicon: '',
          title: 'In group 1',
          url: 'https://b.co',
          chromeGroupId: 'grp',
        },
        {
          tabId: 'g-2',
          favicon: '',
          title: 'In group 2',
          url: 'https://c.co',
          chromeGroupId: 'grp',
        },
        {
          tabId: 'loose-2',
          favicon: '',
          title: 'Loose 2',
          url: 'https://d.co',
        },
      ],
      chromeTabGroups: [{ groupId: 'grp', title: 'Research', color: 'blue' }],
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

const NEW_TAB = {
  tabId: 'added',
  favicon: '',
  title: 'Added',
  url: 'https://added.co',
};

describe('adding the current tab to a Chrome group', () => {
  beforeEach(() => localStorage.clear());

  const add = (state: TabMasterContainer) =>
    reducer(
      state,
      addCurrTabToChromeGroupInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        groupId: 'grp',
        tabData: NEW_TAB,
      })
    );

  it('carries the group id, so the tab actually joins the group', () => {
    const after = add(seed());
    expect(
      win(after).tabs.find((t) => t.tabId === 'added')?.chromeGroupId
    ).toBe('grp');
  });

  // The headline trap. addCurrTabToWindowInternal unshifts, which for a
  // grouped tab would move the group's whole run to the top of the window.
  it('lands beside the group members, not at the front of the window', () => {
    const after = add(seed());
    expect(tabIds(after)).toEqual([
      'loose-1',
      'g-1',
      'g-2',
      'added',
      'loose-2',
    ]);
  });

  it('increments both tab counts', () => {
    const after = add(seed());
    expect(after.tabGroups[0].tabCount).toBe(5);
    expect(win(after).tabCount).toBe(5);
  });

  it('leaves an unknown group alone', () => {
    const after = reducer(
      seed(),
      addCurrTabToChromeGroupInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        groupId: 'nope',
        tabData: NEW_TAB,
      })
    );
    expect(tabIds(after)).toEqual(['loose-1', 'g-1', 'g-2', 'loose-2']);
  });
});

describe('ungrouping a Chrome group', () => {
  beforeEach(() => localStorage.clear());

  const ungroup = (state: TabMasterContainer) =>
    reducer(
      state,
      ungroupChromeTabGroup({ tabGroupId: 'tg', windowId: 'w', groupId: 'grp' })
    );

  it('keeps every tab', () => {
    expect(tabIds(ungroup(seed()))).toEqual([
      'loose-1',
      'g-1',
      'g-2',
      'loose-2',
    ]);
  });

  it('removes the group entry', () => {
    expect(win(ungroup(seed())).chromeTabGroups).toEqual([]);
  });

  // Removing only the entry would already render as ungrouped, because
  // partitionTabsIntoRuns treats an unmatched id as ungrouped on purpose. The
  // ids are cleared anyway: leaving them would be data pointing at nothing.
  it('clears the group id from its former members', () => {
    const after = ungroup(seed());
    expect(
      after.tabGroups[0].windows[0].tabs.every(
        (t) => t.chromeGroupId === undefined
      )
    ).toBe(true);
  });

  it('leaves an unknown group alone', () => {
    const after = reducer(
      seed(),
      ungroupChromeTabGroup({
        tabGroupId: 'tg',
        windowId: 'w',
        groupId: 'nope',
      })
    );
    expect(win(after).chromeTabGroups).toHaveLength(1);
  });
});

describe('deleting a Chrome group and its tabs', () => {
  beforeEach(() => localStorage.clear());

  const del = (state: TabMasterContainer) =>
    reducer(
      state,
      deleteChromeTabGroupInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        groupId: 'grp',
      })
    );

  it('removes the group members and nothing else', () => {
    expect(tabIds(del(seed()))).toEqual(['loose-1', 'loose-2']);
  });

  it('removes the group entry too', () => {
    expect(win(del(seed())).chromeTabGroups).toEqual([]);
  });

  it('decrements both tab counts by the members removed', () => {
    const after = del(seed());
    expect(after.tabGroups[0].tabCount).toBe(2);
    expect(win(after).tabCount).toBe(2);
  });

  // The cascade the trash icon inherits: a window emptied by the delete goes,
  // and a session emptied by that goes too, with a tombstone so the deletion
  // propagates rather than being resurrected by the next merge.
  it('deletes the window when the group was all of it, and buries the session', () => {
    const onlyGroupTabs = (): tabContainerData => ({
      ...session(),
      tabCount: 2,
      windows: [
        {
          ...session().windows[0],
          tabCount: 2,
          tabs: [
            {
              tabId: 'g-1',
              favicon: '',
              title: 'a',
              url: 'https://b.co',
              chromeGroupId: 'grp',
            },
            {
              tabId: 'g-2',
              favicon: '',
              title: 'b',
              url: 'https://c.co',
              chromeGroupId: 'grp',
            },
          ],
        },
      ],
    });
    const seeded = reducer(base(), saveToTabContainerInternal(onlyGroupTabs()));
    const after = del(seeded);

    expect(after.tabGroups).toHaveLength(0);
    expect(after.deletedTabGroups?.some((t) => t.tabGroupId === 'tg')).toBe(
      true
    );
  });

  // THE CONTROL for the cascade above. A reducer that deleted the session on
  // every call would satisfy it; this proves the cascade is conditional on the
  // window actually emptying.
  it('CONTROL: the session survives when other tabs remain', () => {
    const after = del(seed());
    expect(after.tabGroups).toHaveLength(1);
    expect(after.deletedTabGroups?.some((t) => t.tabGroupId === 'tg')).not.toBe(
      true
    );
  });

  it('leaves an unknown group alone', () => {
    const after = reducer(
      seed(),
      deleteChromeTabGroupInternal({
        tabGroupId: 'tg',
        windowId: 'w',
        groupId: 'nope',
      })
    );
    expect(tabIds(after)).toEqual(['loose-1', 'g-1', 'g-2', 'loose-2']);
  });
});
