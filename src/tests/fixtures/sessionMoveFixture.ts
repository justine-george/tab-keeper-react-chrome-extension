import type {
  TabMasterContainer,
  tabContainerData,
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { chromeTabGroupData } from '../../utils/functions/tabGroups';

// KAN-350. Three saved sessions for the move between sessions: S1 the source,
// S2 the destination, S3 an unrelated one. Saved oldest first by createdAt and
// never edited, so the list starts S3, S2, S1 (newest first): a move that
// stamps both S1 and S2 has to lift them above S3, target on top.

export const T0 = Date.UTC(2026, 8, 30, 12, 0, 0);
const HOUR = 3_600_000;

export const tab = (tabId: string, chromeGroupId?: string): tabData => ({
  tabId,
  favicon: '',
  title: tabId,
  url: `https://${tabId}.test/`,
  ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
});

export const group = (groupId: string): chromeTabGroupData => ({
  groupId,
  title: `Group ${groupId}`,
  color: 'blue',
});

export const win = (
  windowId: string,
  tabs: tabData[],
  chromeTabGroups?: chromeTabGroupData[],
  bounds = { height: 800, width: 1200, top: 0, left: 0 }
): windowGroupData => ({
  windowId,
  windowHeight: bounds.height,
  windowWidth: bounds.width,
  windowOffsetTop: bounds.top,
  windowOffsetLeft: bounds.left,
  tabCount: tabs.length,
  title: `Window ${windowId}`,
  tabs,
  ...(chromeTabGroups === undefined ? {} : { chromeTabGroups }),
});

export const session = (
  tabGroupId: string,
  title: string,
  createdAt: number,
  windows: windowGroupData[]
): tabContainerData => ({
  tabGroupId,
  title,
  createdTime: '2026-09-30 09:00:00',
  createdAt,
  lastModified: createdAt,
  isAutoSave: false,
  isSelected: false,
  windowCount: windows.length,
  tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
  windows,
});

// w1's bounds are distinct from every other window's, so a new window that
// copied the wrong window's bounds shows it.
export const W1_BOUNDS = { height: 700, width: 1100, top: 10, left: 20 };

// S1: w1 holds a loose tab, a two-member group g1, a loose tab and a
// ONE-member group g2 (the prune case); w2 holds a single tab (the emptied
// window case).
export const s1 = (): tabContainerData =>
  session('S1', 'Source', T0 - 3 * HOUR, [
    win(
      'w1',
      [
        tab('t1'),
        tab('g1a', 'g1'),
        tab('g1b', 'g1'),
        tab('t2'),
        tab('t4', 'g2'),
      ],
      [group('g1'), group('g2')],
      W1_BOUNDS
    ),
    win('w2', [tab('t3')]),
  ]);

// S2: d1 holds a loose tab then a two-member band h1; d2 one tab.
export const s2 = (): tabContainerData =>
  session('S2', 'Target', T0 - 2 * HOUR, [
    win('d1', [tab('u1'), tab('u2', 'h1'), tab('u3', 'h1')], [group('h1')]),
    win('d2', [tab('u4')]),
  ]);

export const s3 = (): tabContainerData =>
  session('S3', 'Other', T0 - HOUR, [win('x1', [tab('v1')])]);

export const container = (
  tabGroups: tabContainerData[] = [s3(), s2(), s1()],
  selectedTabGroupId: string | null = null
): TabMasterContainer => ({
  lastModified: T0 - HOUR,
  selectedTabGroupId,
  tabGroups: tabGroups.map((g) => ({
    ...g,
    isSelected: g.tabGroupId === selectedTabGroupId,
  })),
});

// Lookups that throw rather than return undefined, so a test never needs `!`.
export function sessionIn(
  c: TabMasterContainer,
  tabGroupId: string
): tabContainerData {
  const found = c.tabGroups.find((g) => g.tabGroupId === tabGroupId);
  if (!found) throw new Error(`session ${tabGroupId} is missing`);
  return found;
}

export function windowIn(
  c: TabMasterContainer,
  tabGroupId: string,
  windowId: string
): windowGroupData {
  const found = sessionIn(c, tabGroupId).windows.find(
    (w) => w.windowId === windowId
  );
  if (!found) throw new Error(`window ${windowId} is missing`);
  return found;
}

export const tabIds = (w: windowGroupData): string[] =>
  w.tabs.map((t) => t.tabId);

export const windowIds = (s: tabContainerData): string[] =>
  s.windows.map((w) => w.windowId);

export const sessionIds = (c: TabMasterContainer): string[] =>
  c.tabGroups.map((g) => g.tabGroupId);
