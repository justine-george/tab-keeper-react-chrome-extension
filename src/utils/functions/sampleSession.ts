import type {
  tabContainerData,
  windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { getStringDate } from './local';

// KAN-7 §2. Names are translated; tab titles stay English, the page replaces them on open.
export interface SampleNames {
  title: string;
  gettingThere: string;
  thingsToDo: string;
}

interface SampleTab {
  title: string;
  url: string;
}

const GETTING_THERE: readonly SampleTab[] = [
  {
    title: 'Flights to Lisbon - Google Flights',
    url: 'https://www.google.com/travel/flights',
  },
  { title: 'Hotel in Alfama - Booking.com', url: 'https://www.booking.com/' },
  { title: 'Lisbon 10-day weather', url: 'https://weather.com/' },
];

const THINGS_TO_DO: readonly SampleTab[] = [
  {
    title: 'Things to do in Lisbon - Time Out',
    url: 'https://www.timeout.com/lisbon',
  },
  {
    title: 'Belém Tower - opening hours',
    url: 'https://www.torrebelem.gov.pt/',
  },
];

const SAMPLE_URLS = new Set(
  [...GETTING_THERE, ...THINGS_TO_DO].map((tab) => tab.url)
);

// Zero bounds, as a capture of an unmeasured window: restore falls back to its defaults.
function sampleWindow(
  title: string,
  tabs: readonly SampleTab[],
  newId: () => string
): windowGroupData {
  return {
    windowId: newId(),
    windowHeight: 0,
    windowWidth: 0,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: tabs.length,
    title,
    tabs: tabs.map((tab) => ({
      tabId: newId(),
      favicon: '',
      title: tab.title,
      url: tab.url,
    })),
  };
}

// The id marks a sample, so stored data gains no field.
export const SAMPLE_ID_PREFIX = 'sample:';

// A sample is no value moment (KAN-149): the rate prompt must not fire on it.
export function isSampleSession(tabGroupId: string): boolean {
  return tabGroupId.startsWith(SAMPLE_ID_PREFIX);
}

// One `now` for both dates: createdTime is a merge contract (getStringDate).
export function buildSampleSession(
  names: SampleNames,
  now: Date,
  newId: () => string
): tabContainerData {
  const windows = [
    sampleWindow(names.gettingThere, GETTING_THERE, newId),
    sampleWindow(names.thingsToDo, THINGS_TO_DO, newId),
  ];
  return {
    tabGroupId: `${SAMPLE_ID_PREFIX}${newId()}`,
    title: names.title,
    createdTime: getStringDate(now),
    createdAt: now.getTime(),
    windowCount: windows.length,
    tabCount: windows.reduce((count, window) => count + window.tabCount, 0),
    isAutoSave: false,
    isSelected: true,
    windows,
  };
}

// KAN-413. True while every tab is one of the sample's own, wherever it was dragged, and none twice: its URLs are distinct.
export function holdsOnlySampleTabs(session: tabContainerData): boolean {
  const seen = new Set<string>();
  return session.windows.every((window) =>
    window.tabs.every((tab) => {
      if (!SAMPLE_URLS.has(tab.url) || seen.has(tab.url)) return false;
      seen.add(tab.url);
      return true;
    })
  );
}
