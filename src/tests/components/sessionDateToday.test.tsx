import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import { restoreContainer } from '../../redux/slices/tabContainerDataStateSlice';
import { buildSession } from '../fixtures/sessionFixture';

// KAN-347. A list left open across midnight must not keep saying "today".
// The tab view can stay open for days, so the day is re-checked about once a
// minute, and at once when the page comes back into view.
//
// Only Date and the interval are faked: the render helpers and Testing
// Library's own waits keep real timeouts.

const EDITED = new Date(2026, 8, 29, 23, 0).getTime();
const BEFORE_MIDNIGHT = new Date(2026, 8, 29, 23, 59, 30);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(BEFORE_MIDNIGHT);
});
afterEach(() => {
  vi.useRealTimers();
});

const session = (id: string, isSelected: boolean) => ({
  ...buildSession(),
  tabGroupId: id,
  title: id,
  contentModified: EDITED,
  isSelected,
});

const shown = (text: string) => screen.queryAllByText(text).length;

describe('a list open across midnight (KAN-347)', () => {
  // A traveller's tab view: the zone changes while the list is open. New York
  // to Los Angeles on one afternoon keeps the calendar day, so only a check
  // that knows about the zone redraws; and "today" must be LA's today, not
  // New York's midnight read in LA (Sep 28, 9:00 PM there).
  test('a time-zone change while open redraws in the new zone', async () => {
    try {
      vi.stubEnv('TZ', 'America/New_York');
      // Sep 28, 1:00 PM in New York; 10:00 AM in Los Angeles.
      const edited = Date.UTC(2026, 8, 28, 17, 0);
      vi.setSystemTime(Date.UTC(2026, 8, 29, 19, 0));
      await renderWithProviders(<HeroContainerRight />, {
        seedStore: (store) => {
          store.dispatch(
            restoreContainer({
              lastModified: 1,
              selectedTabGroupId: 'one',
              tabGroups: [{ ...session('one', true), contentModified: edited }],
              deletedTabGroups: [],
            })
          );
        },
      });
      // PREMISE: drawn in New York.
      expect(shown('Edited yesterday, 1:00 PM')).toBe(1);

      vi.stubEnv('TZ', 'America/Los_Angeles');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(shown('Edited yesterday, 10:00 AM')).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
