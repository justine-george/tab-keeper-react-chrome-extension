import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  setCloudConfigured,
  setSignedIn,
  setSyncStatus,
} from '../../redux/slices/globalStateSlice';
import {
  grantCloudConsent,
  setLastSyncedTime,
} from '../../redux/slices/settingsDataStateSlice';
import { getTooltipDate } from '../../utils/functions/local';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { makeTestStore } from '../setup/makeStore';

// KAN-584. "Last synced" reads like a session's date (KAN-347): "today" or
// "yesterday" and the time, no seconds, no year while it is this year. The
// Settings line keeps the full timestamp as its hover, as a session's date
// does; the header's tooltip is itself the hover, so it has only the short
// form.
//
// Only Date and the interval are faked (as in sessionDateToday.test.tsx).

type Store = ReturnType<typeof makeTestStore>['store'];

const NOW = new Date(2026, 9, 13, 18, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** ICU may put U+202F before AM/PM. */
const plain = (s: string | null | undefined) =>
  (s ?? '').replace(/[\u202f\u00a0]/g, ' ');

const CASES = [
  {
    when: 'today',
    at: new Date(2026, 9, 13, 15, 9, 38).getTime(),
    reads: 'Last synced today, 3:09 PM',
  },
  {
    when: 'yesterday',
    at: new Date(2026, 9, 12, 9, 41, 7).getTime(),
    reads: 'Last synced yesterday, 9:41 AM',
  },
  {
    when: 'earlier this year',
    at: new Date(2026, 9, 5, 10, 52, 11).getTime(),
    reads: 'Last synced Oct 5, 10:52 AM',
  },
  {
    when: 'another year',
    at: new Date(2025, 2, 3, 8, 0, 0).getTime(),
    reads: 'Last synced Mar 3, 2025',
  },
];

function synced(at: number) {
  return (store: Store) => {
    store.dispatch(setSignedIn());
    store.dispatch(setCloudConfigured(true));
    store.dispatch(grantCloudConsent());
    store.dispatch(setLastSyncedTime(at));
    store.dispatch(setSyncStatus('success'));
  };
}

const settingsLine = () =>
  screen.getByTestId('sync-status').querySelector('[data-sync-synced]');

const renderSettings = (at: number) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SYNC));
      synced(at)(store);
    },
  });

/** The header's sync button, found by its synced glyph. */
const headerTooltip = () =>
  screen
    .getAllByRole('button')
    .find((b) => b.textContent === 'cloud_done')
    ?.getAttribute('title');

describe('"Last synced" reads like a session date (KAN-584)', () => {
  test.each(CASES)('Settings, $when: "$reads"', async ({ at, reads }) => {
    await renderSettings(at);
    expect(plain(settingsLine()?.textContent)).toBe(reads);
  });

  test.each(CASES)(
    'Settings, $when: the hover is the full timestamp',
    async ({ at }) => {
      await renderSettings(at);
      expect(settingsLine()?.getAttribute('title')).toBe(
        getTooltipDate(at, 'en', 'h12')
      );
    }
  );

  test.each(CASES)('header tooltip, $when: "$reads"', async ({ at, reads }) => {
    await renderWithProviders(<MenuContainer />, { seedStore: synced(at) });
    expect(plain(headerTooltip())).toBe(`Cloud sync on\n${reads}`);
  });

  // Left open across midnight, both say "yesterday", not "today".
  test('both redraw when the day turns', async () => {
    const at = CASES[0].at;
    await renderWithProviders(
      <>
        <MenuContainer />
        <SettingsDetailsContainer />
      </>,
      {
        seedStore: (store) => {
          store.dispatch(selectCategory(SettingsCategory.SYNC));
          synced(at)(store);
        },
      }
    );
    // PREMISE: drawn as today.
    expect(plain(settingsLine()?.textContent)).toBe(CASES[0].reads);

    vi.setSystemTime(new Date(2026, 9, 14, 0, 0, 30));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const reads = 'Last synced yesterday, 3:09 PM';
    expect(plain(settingsLine()?.textContent)).toBe(reads);
    expect(plain(headerTooltip())).toBe(`Cloud sync on\n${reads}`);
  });

  // Worst path: a stored time that is not a date. It reads as never synced:
  // no time line ("Last synced " and nothing would say less than that), so
  // Settings keeps its sentence and the header its "Sync now".
  test('an unreadable time shows no time anywhere', async () => {
    await renderWithProviders(
      <>
        <MenuContainer />
        <SettingsDetailsContainer />
      </>,
      {
        seedStore: (store) => {
          store.dispatch(selectCategory(SettingsCategory.SYNC));
          synced(NaN)(store);
        },
      }
    );
    expect(settingsLine()).toBeNull();
    expect(
      screen.getByTestId('sync-status').querySelector('[data-sync-line]')
    ).not.toBeNull();
    expect(headerTooltip()).toBe('Cloud sync on\nSync now');
  });
});
