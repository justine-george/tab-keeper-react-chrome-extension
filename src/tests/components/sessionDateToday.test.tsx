import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
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

/** The ticket's bound: a day change shows within a minute. */
const A_MINUTE = 60_000;

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

// Two rows and the header: three places that show a date.
const renderBothPanes = () =>
  renderWithProviders(
    <>
      <TabGroupEntryContainer />
      <HeroContainerRight />
    </>,
    {
      seedStore: (store) => {
        store.dispatch(
          restoreContainer({
            lastModified: 1,
            selectedTabGroupId: 'one',
            tabGroups: [session('one', true), session('two', false)],
            deletedTabGroups: [],
          })
        );
      },
    }
  );

const shown = (text: string) => screen.queryAllByText(text).length;

describe('a list open across midnight (KAN-347)', () => {
  test('says yesterday within a minute of midnight, untouched', async () => {
    await renderBothPanes();
    // PREMISE: before midnight, all three say today.
    expect(shown('Edited today, 11:00 PM')).toBe(3);

    act(() => {
      vi.advanceTimersByTime(A_MINUTE);
    });

    expect(shown('Edited yesterday, 11:00 PM')).toBe(3);
    expect(shown('Edited today, 11:00 PM')).toBe(0);
  });

  // A hidden tab's timers are slowed, and a laptop lid can close across
  // midnight: coming back into view re-checks at once, with no timer.
  test('says yesterday at once when the page comes back into view', async () => {
    await renderBothPanes();
    vi.setSystemTime(new Date(2026, 8, 30, 0, 0, 10));
    // CONTROL: the clock alone redraws nothing, so what follows is the event.
    expect(shown('Edited today, 11:00 PM')).toBe(3);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(shown('Edited yesterday, 11:00 PM')).toBe(3);
  });

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

  // Review Focus 5: one interval however many rows, none once they are gone.
  test('three dates share one interval, and unmounting stops it', async () => {
    const { unmount } = await renderBothPanes();
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
