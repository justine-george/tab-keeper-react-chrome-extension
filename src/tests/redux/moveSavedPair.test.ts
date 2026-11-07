import { describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { pairDrop } from '../../redux/dropSpecs';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import {
  moveSavedPairInternal,
  saveToTabContainerInternal,
  type tabData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { redo, undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';

// KAN-942. A pair moves as one action: both halves, side by side, with one pin and one group.

const t = (tabId: string, extra: Partial<tabData> = {}): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test`,
  ...extra,
});
const half = (tabId: string, extra: Partial<tabData> = {}) =>
  t(tabId, { splitId: 'split', ...extra });

const win = (
  windowId: string,
  tabs: tabData[],
  extra: Partial<windowGroupData> = {}
): windowGroupData => ({
  windowId,
  windowHeight: 100,
  windowWidth: 100,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: windowId,
  tabs,
  ...extra,
});

const seeded = (windows: windowGroupData[]) => {
  const { store } = makeTestStore();
  store.dispatch(
    saveToTabContainerInternal({
      tabGroupId: 'tg',
      title: 'Session',
      createdTime: '2026-11-06 00:00:00',
      windowCount: windows.length,
      tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
      isAutoSave: false,
      isSelected: false,
      windows,
    })
  );
  store.dispatch(setIsNotDirty());
  return store;
};
type Store = ReturnType<typeof seeded>;

const container = (s: Store) => s.getState().tabContainerDataState;
const session = (s: Store) => container(s).tabGroups[0];
const windowOf = (s: Store, id: string) =>
  session(s).windows.find((w) => w.windowId === id);
const ids = (s: Store, id = 'w') => windowOf(s, id)?.tabs.map((x) => x.tabId);
const tabOf = (s: Store, tabId: string, id = 'w') =>
  windowOf(s, id)?.tabs.find((x) => x.tabId === tabId);

const move = (
  toIndex: number,
  extra: {
    toWindowId?: string;
    toChromeGroupId?: string;
    tabId?: string;
    partnerTabId?: string;
  } = {}
) =>
  moveSavedPairInternal({
    tabGroupId: 'tg',
    fromWindowId: 'w',
    toWindowId: 'w',
    tabId: 'h1',
    partnerTabId: 'h2',
    toIndex,
    ...extra,
  });

const plain = () => [t('a'), half('h1'), half('h2'), t('b'), t('c')];

describe('moveSavedPairInternal (KAN-942)', () => {
  test('moves both halves down, side by side, same splitId', () => {
    const s = seeded([win('w', plain())]);
    s.dispatch(move(3));
    expect(ids(s)).toEqual(['a', 'b', 'c', 'h1', 'h2']);
    expect(tabOf(s, 'h1')?.splitId).toBe('split');
    expect(tabOf(s, 'h2')?.splitId).toBe('split');
  });

  test('moves both halves up', () => {
    const s = seeded([win('w', plain())]);
    s.dispatch(move(0));
    expect(ids(s)).toEqual(['h1', 'h2', 'a', 'b', 'c']);
  });

  test('across windows moves the counts by two and keeps the session total', () => {
    const s = seeded([win('w', plain()), win('v', [t('x'), t('y')])]);
    s.dispatch(move(1, { toWindowId: 'v' }));
    expect(ids(s, 'v')).toEqual(['x', 'h1', 'h2', 'y']);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(windowOf(s, 'w')?.tabCount).toBe(3);
    expect(windowOf(s, 'v')?.tabCount).toBe(4);
    expect(session(s).tabCount).toBe(7);
  });

  test('a drop in place is no edit', () => {
    const s = seeded([win('w', plain())]);
    const before = container(s);
    s.dispatch(move(1));
    expect(container(s)).toBe(before);
  });

  test('joining a band gives both halves the group, unpinned', () => {
    const s = seeded([
      win(
        'w',
        [
          half('h1', { pinned: true }),
          half('h2', { pinned: true }),
          t('g1', { chromeGroupId: 'g' }),
          t('g2', { chromeGroupId: 'g' }),
        ],
        { chromeTabGroups: [{ groupId: 'g', title: 'G', color: 'blue' }] }
      ),
    ]);
    s.dispatch(move(1, { toChromeGroupId: 'g' }));
    expect(ids(s)).toEqual(['g1', 'h1', 'h2', 'g2']);
    for (const id of ['h1', 'h2']) {
      expect(tabOf(s, id)?.chromeGroupId).toBe('g');
      expect(tabOf(s, id)?.pinned).toBeUndefined();
    }
  });

  test('leaving a band drops the group from both, and a group left empty loses its entry', () => {
    const s = seeded([
      win(
        'w',
        [
          t('a'),
          half('h1', { chromeGroupId: 'g' }),
          half('h2', { chromeGroupId: 'g' }),
        ],
        { chromeTabGroups: [{ groupId: 'g', title: 'G', color: 'blue' }] }
      ),
    ]);
    s.dispatch(move(0));
    expect(ids(s)).toEqual(['h1', 'h2', 'a']);
    expect(tabOf(s, 'h1')?.chromeGroupId).toBeUndefined();
    expect(tabOf(s, 'h2')?.chromeGroupId).toBeUndefined();
    expect(windowOf(s, 'w')?.chromeTabGroups).toEqual([]);
  });

  test('landing in the pinned run pins both', () => {
    const s = seeded([
      win('w', [
        t('p', { pinned: true }),
        t('q', { pinned: true }),
        half('h1'),
        half('h2'),
      ]),
    ]);
    s.dispatch(move(1));
    expect(ids(s)).toEqual(['p', 'h1', 'h2', 'q']);
    expect(tabOf(s, 'h1')?.pinned).toBe(true);
    expect(tabOf(s, 'h2')?.pinned).toBe(true);
  });

  test('landing below the pinned run unpins both', () => {
    const s = seeded([
      win('w', [
        half('h1', { pinned: true }),
        half('h2', { pinned: true }),
        t('p', { pinned: true }),
        t('a'),
        t('b'),
      ]),
    ]);
    s.dispatch(move(2));
    expect(ids(s)).toEqual(['p', 'a', 'h1', 'h2', 'b']);
    expect(tabOf(s, 'h1')?.pinned).toBeUndefined();
    expect(tabOf(s, 'h2')?.pinned).toBeUndefined();
  });

  test('a source window left empty goes', () => {
    const s = seeded([win('w', [half('h1'), half('h2')]), win('v', [t('x')])]);
    s.dispatch(move(1, { toWindowId: 'v' }));
    expect(windowOf(s, 'w')).toBeUndefined();
    expect(session(s).windowCount).toBe(1);
  });

  test('refuses a pair that was broken', () => {
    const s = seeded([win('w', [half('h1'), t('m'), half('h2'), t('b')])]);
    const before = container(s);
    s.dispatch(move(3));
    expect(container(s)).toBe(before);
  });

  test('refuses swapped ids', () => {
    const s = seeded([win('w', plain())]);
    const before = container(s);
    s.dispatch(move(3, { tabId: 'h2', partnerTabId: 'h1' }));
    expect(container(s)).toBe(before);
  });

  test('refuses with a half gone', () => {
    const s = seeded([win('w', [half('h1'), t('b')])]);
    const before = container(s);
    s.dispatch(move(1));
    expect(container(s)).toBe(before);
  });

  test('forgets an activeTabId that left the window', () => {
    const s = seeded([
      win('w', plain(), { activeTabId: 'h2' }),
      win('v', [t('x')]),
    ]);
    s.dispatch(move(0, { toWindowId: 'v' }));
    expect(windowOf(s, 'w')?.activeTabId).toBeUndefined();
  });

  test('lands past a pair it was aimed inside', () => {
    const s = seeded([
      win('w', [
        half('h1'),
        half('h2'),
        t('a'),
        t('p1', { splitId: 'other' }),
        t('p2', { splitId: 'other' }),
      ]),
    ]);
    s.dispatch(move(2));
    expect(ids(s)).toEqual(['a', 'p1', 'p2', 'h1', 'h2']);
  });
});

describe('moving a pair is a captured action (KAN-942)', () => {
  test('one undo puts both halves back, and redo moves them again', () => {
    const s = seeded([win('w', plain())]);
    s.dispatch(move(3));
    s.dispatch(undo());
    expect(ids(s)).toEqual(['a', 'h1', 'h2', 'b', 'c']);
    s.dispatch(redo());
    expect(ids(s)).toEqual(['a', 'b', 'c', 'h1', 'h2']);
  });

  test('it dirties the container for a cloud write', () => {
    const s = seeded([win('w', plain())]);
    s.dispatch(move(3));
    expect(s.getState().globalState.isDirty).toBe(true);
  });
});

describe('pairDrop (KAN-942)', () => {
  const drop = pairDrop({
    tabGroupId: 'tg',
    tabId: 'h1',
    partnerTabId: 'h2',
    fromWindowId: 'w',
    toWindowId: 'w',
    toIndex: 2,
  });

  test('targetIds leaves out the partner, as reaimIndex lifts only the row', () => {
    const s = seeded([win('w', plain())]);
    expect(drop.targetIds(container(s))).toEqual(['a', 'h1', 'b', 'c']);
  });

  test('rowExists holds while they are a pair', () => {
    const s = seeded([win('w', plain())]);
    expect(drop.rowExists(container(s))).toBe(true);
  });

  test('rowExists is false once they stopped being a pair', () => {
    const s = seeded([win('w', [half('h1'), t('m'), half('h2')])]);
    expect(drop.rowExists(container(s))).toBe(false);
  });

  test('targetIds is null when the band it joins is gone', () => {
    const s = seeded([win('w', plain())]);
    const into = pairDrop({
      tabGroupId: 'tg',
      tabId: 'h1',
      partnerTabId: 'h2',
      fromWindowId: 'w',
      toWindowId: 'w',
      toIndex: 2,
      toChromeGroupId: 'gone',
    });
    expect(into.targetIds(container(s))).toBeNull();
  });
});
