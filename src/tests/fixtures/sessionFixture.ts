import type {
  TabMasterContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';

// createdAt is the numeric instant the merge sorts on; createdTime is the
// display string. Both are written because the merge contract depends on the
// pair (KAN-25), and a fixture carrying only one drifts from real data.
const CREATED_AT = Date.UTC(2026, 8, 1, 9, 0, 0);

export function buildSession(
  overrides: Partial<tabContainerData> = {}
): tabContainerData {
  return {
    tabGroupId: 'session-1',
    title: 'Research',
    createdTime: '2026-09-01 09:00:00',
    createdAt: CREATED_AT,
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: 'window-1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 'Morning reading',
        tabs: [
          {
            tabId: 'tab-1',
            favicon: '',
            title: 'Example Domain',
            url: 'https://example.com/',
          },
        ],
      },
    ],
    ...overrides,
  };
}

// Nothing is selected by default: selecting a session is step 3 of the golden
// path, so seeding it pre-selected would skip the thing under test.
export function buildContainer(
  sessions: tabContainerData[] = [buildSession()]
): TabMasterContainer {
  return {
    lastModified: CREATED_AT,
    selectedTabGroupId: null,
    tabGroups: sessions,
  };
}
