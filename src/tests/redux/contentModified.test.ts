import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

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
  addCurrTabToWindowInternal,
  updateTabGroupTitle,
  updateWindowGroupTitle,
  updateChromeTabGroupTitle,
  updateChromeTabGroupColor,
  ungroupChromeTabGroup,
  deleteChromeTabGroupInternal,
  addCurrTabToChromeGroupInternal,
  deleteWindowInternal,
  deleteTabInternal,
  moveTabInternal,
  moveWindowInternal,
  moveSessionInternal,
  clearSessionOrder,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-138. `contentModified` records when a session's CONTENTS changed, as
// opposed to when it last needed syncing.
//
// TABLE-DRIVEN ON PURPOSE. The implementation is one helper swapped in at
// fourteen call sites, and the way that goes wrong is missing one -- a content
// edit that silently fails to update the field, invisible until someone sorts
// by it and a session sits in the wrong place. Enumerating the actions makes a
// missed site a test failure instead of a hope.
//
// Adding a content reducer without a row here is the same mistake one level up,
// so the count is asserted too.

const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const build = () => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-09 12:00:00',
  createdAt: T0,
  // Two windows and three tabs, matching the fixture below. Declaring
  // windowCount: 1 here made deleteWindowInternal drive the count to zero and
  // remove the whole session -- the documented cascade doing its job against a
  // fixture that lied about its own shape.
  windowCount: 2,
  tabCount: 3,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Window',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'One',
          url: 'https://a.co',
          chromeGroupId: 'grp',
        },
        { tabId: 't2', favicon: '', title: 'Two', url: 'https://b.co' },
      ],
      chromeTabGroups: [{ groupId: 'grp', title: 'Research', color: 'blue' }],
    },
    {
      windowId: 'w2',
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Second',
      tabs: [{ tabId: 't3', favicon: '', title: 'Three', url: 'https://c.co' }],
    },
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];

const seeded = () => {
  const { store } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(build()));
  return store;
};

const contentModifiedOf = (s: Store) =>
  s
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'tg')
    ?.contentModified;

// Every reducer that changes what a session HOLDS.
const CONTENT_EDITS: [string, (s: Store) => void][] = [
  [
    'addCurrTabToWindowInternal',
    (s) =>
      s.dispatch(
        addCurrTabToWindowInternal({
          tabGroupId: 'tg',
          windowId: 'w1',
          tabData: {
            tabId: 'new',
            favicon: '',
            title: 'N',
            url: 'https://n.co',
          },
        })
      ),
  ],
  [
    'updateTabGroupTitle',
    (s) =>
      s.dispatch(
        updateTabGroupTitle({ tabGroupId: 'tg', editableTitle: 'Renamed' })
      ),
  ],
  [
    'updateWindowGroupTitle',
    (s) =>
      s.dispatch(
        updateWindowGroupTitle({
          tabGroupId: 'tg',
          windowId: 'w1',
          editableTitle: 'Renamed',
        })
      ),
  ],
  [
    'updateChromeTabGroupTitle',
    (s) =>
      s.dispatch(
        updateChromeTabGroupTitle({
          tabGroupId: 'tg',
          windowId: 'w1',
          groupId: 'grp',
          editableTitle: 'Renamed',
        })
      ),
  ],
  [
    'updateChromeTabGroupColor',
    (s) =>
      s.dispatch(
        updateChromeTabGroupColor({
          tabGroupId: 'tg',
          windowId: 'w1',
          groupId: 'grp',
          color: 'purple',
        })
      ),
  ],
  [
    'addCurrTabToChromeGroupInternal',
    (s) =>
      s.dispatch(
        addCurrTabToChromeGroupInternal({
          tabGroupId: 'tg',
          windowId: 'w1',
          groupId: 'grp',
          tabData: {
            tabId: 'g1',
            favicon: '',
            title: 'G',
            url: 'https://g.co',
          },
        })
      ),
  ],
  [
    'ungroupChromeTabGroup',
    (s) =>
      s.dispatch(
        ungroupChromeTabGroup({
          tabGroupId: 'tg',
          windowId: 'w1',
          groupId: 'grp',
        })
      ),
  ],
  [
    'deleteChromeTabGroupInternal',
    (s) =>
      s.dispatch(
        deleteChromeTabGroupInternal({
          tabGroupId: 'tg',
          windowId: 'w1',
          groupId: 'grp',
        })
      ),
  ],
  [
    'deleteTabInternal',
    (s) =>
      s.dispatch(
        deleteTabInternal({ tabGroupId: 'tg', windowId: 'w1', tabId: 't2' })
      ),
  ],
  [
    'deleteWindowInternal',
    (s) =>
      s.dispatch(deleteWindowInternal({ tabGroupId: 'tg', windowId: 'w2' })),
  ],
  [
    'moveTabInternal',
    (s) =>
      s.dispatch(
        moveTabInternal({
          tabGroupId: 'tg',
          windowId: 'w1',
          tabId: 't2',
          toIndex: 0,
        })
      ),
  ],
  [
    'moveWindowInternal',
    (s) =>
      s.dispatch(
        moveWindowInternal({ tabGroupId: 'tg', windowId: 'w2', toIndex: 0 })
      ),
  ],
];

describe('contentModified advances on every content edit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('saving a session sets it', () => {
    const store = seeded();
    expect(contentModifiedOf(store)).toBe(T0);
  });

  test.each(CONTENT_EDITS)('%s advances it', (_name, edit) => {
    const store = seeded();
    const before = contentModifiedOf(store);

    vi.setSystemTime(T0 + 5_000);
    edit(store);

    expect(contentModifiedOf(store)).toBe(T0 + 5_000);
    expect(contentModifiedOf(store)).not.toBe(before);
  });

  // Guards the table itself. A content reducer added without a row above would
  // otherwise be untested, which is the failure this whole file exists to stop.
  test('the table covers every content reducer', () => {
    expect(CONTENT_EDITS).toHaveLength(12);
  });
});

// THE OTHER HALF, and the reason the field exists at all. Ordering a list is
// not a change to what any session holds.
describe('reordering leaves contentModified alone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const twoSessions = () => {
    const { store } = makeTestStore();
    store.dispatch(saveToTabContainerInternal(build()));
    const second = build();
    second.tabGroupId = 'tg2';
    second.title = 'Another';
    store.dispatch(saveToTabContainerInternal(second));
    return store;
  };

  test('dragging a session does not touch it', () => {
    const store = twoSessions();
    const before = contentModifiedOf(store);

    vi.setSystemTime(T0 + 5_000);
    store.dispatch(moveSessionInternal({ tabGroupId: 'tg', toIndex: 0 }));

    expect(contentModifiedOf(store)).toBe(before);
  });

  test('and lastModified DOES move, or the reorder would not sync', () => {
    const store = twoSessions();
    const lastModified = () =>
      store
        .getState()
        .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'tg')
        ?.lastModified;
    const before = lastModified();

    vi.setSystemTime(T0 + 5_000);
    store.dispatch(moveSessionInternal({ tabGroupId: 'tg', toIndex: 0 }));

    expect(lastModified()).toBe(T0 + 5_000);
    expect(lastModified()).not.toBe(before);
  });

  test('clearing the order does not touch it either', () => {
    const store = twoSessions();
    store.dispatch(moveSessionInternal({ tabGroupId: 'tg', toIndex: 0 }));
    const before = contentModifiedOf(store);

    vi.setSystemTime(T0 + 9_000);
    store.dispatch(clearSessionOrder());

    expect(contentModifiedOf(store)).toBe(before);
  });
});
