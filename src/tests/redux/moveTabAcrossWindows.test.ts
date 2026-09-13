import { describe, it, expect, vi } from 'vitest';

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
  moveTabAcrossWindowsInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// Window A mixes a loose tab with a SINGLE-member group, which is what
// separates a correct prune ("the group I just left is now empty") from the
// tempting wrong one ("some group lost a tab").
const session = (): tabContainerData => ({
  tabGroupId: 'tg',
  title: 'Session',
  createdTime: '2026-09-12 00:00:00',
  createdAt: 1757203200000,
  isAutoSave: false,
  isSelected: true,
  windowCount: 2,
  tabCount: 4,
  windows: [
    {
      windowId: 'wA',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      title: 'A',
      tabCount: 2,
      tabs: [
        { tabId: 'a0', favicon: '', title: 'a0', url: 'https://a0.test/' },
        {
          tabId: 'a1',
          favicon: '',
          title: 'a1',
          url: 'https://a1.test/',
          chromeGroupId: 'solo',
        },
      ],
      chromeTabGroups: [{ groupId: 'solo', title: 'Solo', color: 'blue' }],
    },
    {
      windowId: 'wB',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      title: 'B',
      tabCount: 2,
      tabs: [
        { tabId: 'b0', favicon: '', title: 'b0', url: 'https://b0.test/' },
        { tabId: 'b1', favicon: '', title: 'b1', url: 'https://b1.test/' },
      ],
      chromeTabGroups: [],
    },
  ],
});

const seeded = (): TabMasterContainer =>
  reducer(undefined, saveToTabContainerInternal(session()));

const win = (s: TabMasterContainer, id: string) =>
  s.tabGroups[0].windows.find((w) => w.windowId === id);

describe('moveTabAcrossWindowsInternal', () => {
  it('moves the tab into the destination at the given index', () => {
    const next = reducer(
      seeded(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 1,
      })
    );
    expect(win(next, 'wA')!.tabs.map((t) => t.tabId)).toEqual(['a1']);
    expect(win(next, 'wB')!.tabs.map((t) => t.tabId)).toEqual([
      'b0',
      'a0',
      'b1',
    ]);
  });

  it('moves the counts with it, and leaves the session total alone', () => {
    const next = reducer(
      seeded(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 0,
      })
    );
    expect(win(next, 'wA')!.tabCount).toBe(1);
    expect(win(next, 'wB')!.tabCount).toBe(3);
    expect(next.tabGroups[0].tabCount).toBe(4);
  });

  it('prunes a group in the SOURCE window that the move emptied', () => {
    const next = reducer(
      seeded(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a1',
        toIndex: 0,
      })
    );
    expect(win(next, 'wA')!.chromeTabGroups).toEqual([]);
  });

  it('drops membership when no destination group is named', () => {
    const next = reducer(
      seeded(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a1',
        toIndex: 0,
      })
    );
    expect(win(next, 'wB')!.tabs[0].chromeGroupId).toBeUndefined();
  });

  it('joins a destination group when one is named', () => {
    const next = reducer(
      seeded(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 0,
        toChromeGroupId: 'g',
      })
    );
    expect(win(next, 'wB')!.tabs[0].chromeGroupId).toBe('g');
  });

  it('removes the source window when its last tab leaves', () => {
    let s = reducer(
      seeded(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 0,
      })
    );
    s = reducer(
      s,
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a1',
        toIndex: 0,
      })
    );
    expect(win(s, 'wA')).toBeUndefined();
    expect(s.tabGroups[0].windowCount).toBe(1);
    expect(s.tabGroups[0].tabCount).toBe(4);
  });

  it('clamps an index past the end of the destination', () => {
    const next = reducer(
      seeded(),
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 99,
      })
    );
    expect(win(next, 'wB')!.tabs.map((t) => t.tabId)).toEqual([
      'b0',
      'b1',
      'a0',
    ]);
  });

  it('is inert for ids that do not resolve', () => {
    const before = seeded();
    for (const p of [
      {
        tabGroupId: 'nope',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 0,
      },
      {
        tabGroupId: 'tg',
        fromWindowId: 'nope',
        toWindowId: 'wB',
        tabId: 'a0',
        toIndex: 0,
      },
      {
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'nope',
        tabId: 'a0',
        toIndex: 0,
      },
      {
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wB',
        tabId: 'nope',
        toIndex: 0,
      },
    ]) {
      expect(
        reducer(before, moveTabAcrossWindowsInternal(p)).tabGroups
      ).toEqual(before.tabGroups);
    }
  });

  // The one case this reducer deliberately does NOT own.
  it('does nothing when both windows are the same -- moveTabInternal owns that', () => {
    const before = seeded();
    const next = reducer(
      before,
      moveTabAcrossWindowsInternal({
        tabGroupId: 'tg',
        fromWindowId: 'wA',
        toWindowId: 'wA',
        tabId: 'a0',
        toIndex: 1,
      })
    );
    expect(next.tabGroups).toEqual(before.tabGroups);
  });
});
