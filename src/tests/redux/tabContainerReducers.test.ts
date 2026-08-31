import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
// Keep in step with src/tests/setup/domStub.ts.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// Not optional, and not about this test's subject. Importing the slice reaches
// globalStateSlice -> utils/functions/external -> config/firebase, which calls
// getAuth() at module load and throws `auth/invalid-api-key` when no Firebase
// config is present. A developer machine has a .env and never sees it; CI has
// none, so without this the suite passes locally and fails only on the runner.
// Every other slice-importing test stubs the same module for the same reason.
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  saveToTabContainerInternal,
  selectTabContainer,
  updateTabGroupTitle,
  updateWindowGroupTitle,
  addCurrWindowToTabGroupInternal,
  addCurrTabToWindowInternal,
  deleteTabContainerInternal,
  deleteWindowInternal,
  deleteTabInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' },
        ],
      },
    ],
  };
}

// A fresh object per test: Immer freezes what it returns, and a shared literal
// would leak state between cases.
const base = (): TabMasterContainer => ({
  lastModified: 1,
  selectedTabGroupId: null,
  tabGroups: [],
});

const byId = (s: TabMasterContainer, id: string) =>
  s.tabGroups.find((g) => g.tabGroupId === id)!;

describe('per-session timestamps', () => {
  beforeEach(() => localStorage.clear());

  it('saving a session stamps it', () => {
    const s = reducer(base(), saveToTabContainerInternal(group('a')));
    expect(typeof s.tabGroups[0].lastModified).toBe('number');
  });

  it('editing a title restamps only that session', () => {
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    s = reducer(s, saveToTabContainerInternal(group('b')));
    // Captured by id, not by position: saving unshifts, so indices move and an
    // index-based comparison could pass while comparing the wrong session.
    const beforeB = byId(s, 'b').lastModified;

    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    s = reducer(
      s,
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'X' })
    );
    vi.restoreAllMocks();

    expect(byId(s, 'a').lastModified).toBe(9_999_999);
    expect(byId(s, 'b').lastModified).toBe(beforeB);
    expect(byId(s, 'b').lastModified).not.toBe(9_999_999);
  });

  it('SELECTION DOES NOT restamp a session', () => {
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    s = reducer(s, saveToTabContainerInternal(group('b')));
    const before = s.tabGroups.map((g) => g.lastModified);

    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    s = reducer(s, selectTabContainer('a'));
    vi.restoreAllMocks();

    expect(s.tabGroups.map((g) => g.lastModified)).toEqual(before);
  });
});

describe('tombstones', () => {
  beforeEach(() => localStorage.clear());

  it('deleting a session records a tombstone', () => {
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    s = reducer(s, deleteTabContainerInternal('a'));
    expect(s.tabGroups).toEqual([]);
    expect(s.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual(['a']);
  });

  it('does not duplicate a tombstone for the same id', () => {
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    s = reducer(s, deleteTabContainerInternal('a'));
    s = reducer(s, saveToTabContainerInternal(group('a')));
    s = reducer(s, deleteTabContainerInternal('a'));
    expect(s.deletedTabGroups).toHaveLength(1);
  });

  it('refreshes deletedAt when the same id is deleted again', () => {
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    s = reducer(s, deleteTabContainerInternal('a'));
    vi.restoreAllMocks();
    expect(s.deletedTabGroups![0].deletedAt).toBe(1000);

    s = reducer(s, saveToTabContainerInternal(group('a')));
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    s = reducer(s, deleteTabContainerInternal('a'));
    vi.restoreAllMocks();
    expect(s.deletedTabGroups![0].deletedAt).toBe(5000);
  });

  // The cascade path: removing the last window removes the group itself, so it
  // has to leave a tombstone too, or a delete-by-emptying is invisible to the
  // other device and the session comes back.
  it('records a tombstone when deleting the last window removes the group', () => {
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    s = reducer(s, deleteWindowInternal({ tabGroupId: 'a', windowId: 'w-a' }));
    expect(s.tabGroups).toEqual([]);
    expect(s.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual(['a']);
  });
});

// Every reducer that gained a touch() or bury() call, so none of them is
// modified-but-unexercised. The two cascade paths matter most: they are the
// only places a group disappears without deleteTabContainerInternal running,
// and a missing tombstone there means the other device re-adds the session.
describe('every content mutation stamps its session', () => {
  beforeEach(() => localStorage.clear());

  const stamped = (
    action: Parameters<typeof reducer>[1],
    setup: TabMasterContainer = reducer(
      base(),
      saveToTabContainerInternal(group('a'))
    )
  ) => {
    const before = byId(setup, 'a').lastModified;
    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    const after = reducer(setup, action);
    vi.restoreAllMocks();
    return { before, after };
  };

  it('adding a window stamps the session', () => {
    const { after } = stamped(
      addCurrWindowToTabGroupInternal({
        tabGroupId: 'a',
        window: {
          windowId: 'w-new',
          windowHeight: 100,
          windowWidth: 100,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 't',
          tabs: [
            { tabId: 't-new', favicon: '', title: 't', url: 'https://b.co' },
          ],
        },
      })
    );
    expect(byId(after, 'a').lastModified).toBe(9_999_999);
  });

  it('adding a tab stamps the session', () => {
    const { after } = stamped(
      addCurrTabToWindowInternal({
        tabGroupId: 'a',
        windowId: 'w-a',
        tabData: {
          tabId: 't-new',
          favicon: '',
          title: 't',
          url: 'https://b.co',
        },
      })
    );
    expect(byId(after, 'a').lastModified).toBe(9_999_999);
  });

  it('renaming a window group stamps the session', () => {
    const { after } = stamped(
      updateWindowGroupTitle({
        tabGroupId: 'a',
        windowId: 'w-a',
        editableTitle: 'renamed window',
      })
    );
    expect(byId(after, 'a').lastModified).toBe(9_999_999);
  });

  it('deleting a tab stamps the session when the group survives', () => {
    // two tabs, so removing one leaves the group standing
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    s = reducer(
      s,
      addCurrTabToWindowInternal({
        tabGroupId: 'a',
        windowId: 'w-a',
        tabData: {
          tabId: 't-extra',
          favicon: '',
          title: 't',
          url: 'https://b.co',
        },
      })
    );

    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    s = reducer(
      s,
      deleteTabInternal({ tabGroupId: 'a', windowId: 'w-a', tabId: 't-extra' })
    );
    vi.restoreAllMocks();

    expect(byId(s, 'a').lastModified).toBe(9_999_999);
    expect(s.deletedTabGroups ?? []).toEqual([]);
  });

  // The second cascade. Removing the last tab removes its window, which
  // removes the group - so it needs a tombstone just as much as an explicit
  // delete does, or the deletion never reaches the other device.
  it('records a tombstone when deleting the last tab removes the group', () => {
    let s = reducer(base(), saveToTabContainerInternal(group('a')));
    s = reducer(
      s,
      deleteTabInternal({ tabGroupId: 'a', windowId: 'w-a', tabId: 't-a' })
    );

    expect(s.tabGroups).toEqual([]);
    expect(s.deletedTabGroups!.map((t) => t.tabGroupId)).toEqual(['a']);
  });
});
