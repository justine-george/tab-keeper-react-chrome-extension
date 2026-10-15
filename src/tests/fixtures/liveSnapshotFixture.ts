import type {
  tabData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { chromeTabGroupData } from '../../utils/functions/tabGroups';

// KAN-280 Part F. A live window as Open now converts it at pick-up, against sessionMoveFixture's S2
// (d1: u1, u2 h1, u3 h1; d2: u4). Two of its addresses are already in S2: lg1 is u4's, ldup is u1's.
export const LIVE_BOUNDS = { height: 600, width: 900, top: 40, left: 50 };

export const liveTab = (
  tabId: string,
  url: string,
  extra: Partial<tabData> = {}
): tabData => ({ tabId, favicon: '', title: `Live ${tabId}`, url, ...extra });

export const LIVE_GROUP: chromeTabGroupData = {
  groupId: 'lg',
  title: 'Live group',
  color: 'red',
  collapsed: true,
};

export const snapshotWindow = (
  tabs: tabData[],
  groups: chromeTabGroupData[] = [],
  extra: Partial<windowGroupData> = {}
): windowGroupData => ({
  windowId: 'live-w',
  windowHeight: LIVE_BOUNDS.height,
  windowWidth: LIVE_BOUNDS.width,
  windowOffsetTop: LIVE_BOUNDS.top,
  windowOffsetLeft: LIVE_BOUNDS.left,
  tabCount: tabs.length,
  title: '',
  tabs,
  ...(groups.length > 0 ? { chromeTabGroups: groups } : {}),
  ...extra,
});

export const live = (extra: Partial<windowGroupData> = {}): windowGroupData =>
  snapshotWindow(
    [
      liveTab('lp', 'https://lp.test/', { pinned: true }),
      liveTab('l1', 'https://l1.test/', { splitId: 'sp' }),
      liveTab('l1b', 'https://l1b.test/', { splitId: 'sp' }),
      liveTab('lg1', 'https://u4.test/', { chromeGroupId: 'lg' }),
      liveTab('lg2', 'https://lg2.test/', { chromeGroupId: 'lg' }),
      liveTab('ldup', 'https://u1.test/'),
    ],
    [LIVE_GROUP],
    { activeTabId: 'l1', state: 'maximized', ...extra }
  );
