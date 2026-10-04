import { describe, expect, test } from 'vitest';

import { buildSampleSession } from '../../../utils/functions/sampleSession';
import {
  getStringDate,
  isValidTabMasterContainer,
} from '../../../utils/functions/local';

// KAN-7 §2. The sample is an ordinary session: the mock fixture's five tabs,
// translated session and window names, English tab titles.

const NAMES = {
  title: 'Sample: Weekend trip',
  gettingThere: 'Getting there',
  thingsToDo: 'Things to do',
};
const NOW = new Date(2026, 9, 4, 9, 30, 0);
const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('buildSampleSession', () => {
  test('two windows, three tabs then two, stamped with one now', () => {
    const sample = buildSampleSession(NAMES, NOW, counter());
    expect(sample).toEqual({
      tabGroupId: 'id-8',
      title: 'Sample: Weekend trip',
      createdTime: getStringDate(NOW),
      createdAt: NOW.getTime(),
      windowCount: 2,
      tabCount: 5,
      isAutoSave: false,
      isSelected: true,
      windows: [
        {
          windowId: 'id-1',
          windowHeight: 0,
          windowWidth: 0,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 3,
          title: 'Getting there',
          tabs: [
            {
              tabId: 'id-2',
              favicon: '',
              title: 'Flights to Lisbon - Google Flights',
              url: 'https://www.google.com/travel/flights',
            },
            {
              tabId: 'id-3',
              favicon: '',
              title: 'Hotel in Alfama - Booking.com',
              url: 'https://www.booking.com/',
            },
            {
              tabId: 'id-4',
              favicon: '',
              title: 'Lisbon 10-day weather',
              url: 'https://weather.com/',
            },
          ],
        },
        {
          windowId: 'id-5',
          windowHeight: 0,
          windowWidth: 0,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 2,
          title: 'Things to do',
          tabs: [
            {
              tabId: 'id-6',
              favicon: '',
              title: 'Things to do in Lisbon - Time Out',
              url: 'https://www.timeout.com/lisbon',
            },
            {
              tabId: 'id-7',
              favicon: '',
              title: 'Belém Tower - opening hours',
              url: 'https://www.torrebelem.gov.pt/',
            },
          ],
        },
      ],
    });
  });

  test('passes the stored-session schema', () => {
    const sample = buildSampleSession(NAMES, NOW, counter());
    expect(
      isValidTabMasterContainer({
        lastModified: NOW.getTime(),
        selectedTabGroupId: sample.tabGroupId,
        tabGroups: [sample],
      })
    ).toBe(true);
  });
});
