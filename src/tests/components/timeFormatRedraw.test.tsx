import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import MenuContainer from '../../components/home/leftpane/MenuContainer';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  restoreContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  setCloudConfigured,
  setSignedIn,
  setSyncStatus,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import {
  grantCloudConsent,
  setLastSyncedTime,
  setTimeFormat,
} from '../../redux/slices/settingsDataStateSlice';
import { RECENTLY_DELETED_KEY } from '../../utils/functions/recentlyDeleted';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

// KAN-587. Each place a time shows follows the setting, and redraws in place
// when it changes. Expected strings are literals, not getPrettyDate(...), so
// the oracle does not share the code under test.

type Store = ReturnType<typeof makeTestStore>['store'];

const NOW = new Date(2026, 9, 14, 18, 0, 0);
const AT = new Date(2026, 9, 14, 15, 9, 42).getTime();

/** ICU puts U+202F before AM/PM. */
const plain = (s: string | null | undefined) =>
  (s ?? '').replace(/[\u202f\u00a0]/g, ' ');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const toH23 = (store: Store) =>
  act(() => {
    store.dispatch(setTimeFormat('h23'));
  });

const synced = (store: Store) => {
  store.dispatch(setSignedIn());
  store.dispatch(setCloudConfigured(true));
  store.dispatch(grantCloudConsent());
  store.dispatch(setLastSyncedTime(AT));
  // The sync that landed started this page load (else the boot wait, KAN-750).
  store.dispatch(syncStateWithFirestore.pending('boot', undefined));
  store.dispatch(setSyncStatus('success'));
};

const seedEditedSession = (store: Store) => {
  const session = {
    ...buildSession({ tabGroupId: 's1' }),
    contentModified: AT,
    isSelected: true,
  };
  store.dispatch(
    restoreContainer({
      lastModified: 1,
      selectedTabGroupId: 's1',
      tabGroups: [session],
      deletedTabGroups: [],
    })
  );
};

/** Each element whose own text reads `text`, with the hover of its nearest titled box. */
const dated = (text: string) =>
  screen
    .queryAllByText((content) => plain(content) === text)
    .map((el) =>
      plain(el.closest('[data-tooltip]')?.getAttribute('data-tooltip'))
    );

describe('time format redraws every time (KAN-587)', () => {
  test('a session row and the session header, with their hovers', async () => {
    const { store } = await renderWithProviders(
      <>
        <TabGroupEntryContainer />
        <HeroContainerRight />
      </>,
      { seedStore: seedEditedSession }
    );
    await screen.findAllByText(
      (content) => plain(content) === 'Edited today, 3:09 PM'
    );
    expect(dated('Edited today, 3:09 PM')).toEqual([
      'Oct 14, 2026, 3:09 PM',
      'Oct 14, 2026, 3:09 PM',
    ]);

    toH23(store);
    expect(dated('Edited today, 15:09')).toEqual([
      'Oct 14, 2026, 15:09',
      'Oct 14, 2026, 15:09',
    ]);
  });

  test('Last synced on Sync & Backup, and its hover', async () => {
    const { store } = await renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(selectCategory(SettingsCategory.SYNC));
        synced(s);
      },
    });
    const line = () =>
      screen.getByTestId('sync-status').querySelector('[data-sync-synced]');
    expect(plain(line()?.textContent)).toBe('Last synced today, 3:09 PM');
    expect(plain(line()?.getAttribute('data-tooltip'))).toBe(
      'Oct 14, 2026, 3:09 PM'
    );

    toH23(store);
    expect(line()?.textContent).toBe('Last synced today, 15:09');
    expect(line()?.getAttribute('data-tooltip')).toBe('Oct 14, 2026, 15:09');
  });

  test('the header sync button tooltip', async () => {
    const { store } = await renderWithProviders(<MenuContainer />, {
      seedStore: synced,
    });
    const tooltip = () =>
      screen
        .getAllByRole('button')
        .find(
          (b) =>
            b.querySelector('[data-glyph]')?.getAttribute('data-glyph') ===
            'cloud_done'
        )
        ?.getAttribute('data-tooltip');
    expect(plain(tooltip())).toBe('Cloud sync on · Last synced today, 3:09 PM');

    toH23(store);
    expect(tooltip()).toBe('Cloud sync on · Last synced today, 15:09');
  });

  test('a Recently deleted row', async () => {
    const { store } = await renderWithProviders(<SettingsDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(
          replaceState(buildContainer([buildSession({ tabGroupId: 'K' })]))
        );
        s.dispatch(selectCategory(SettingsCategory.RECENTLY_DELETED));
      },
    });
    await act(async () => {
      await chrome.storage.local.set({
        [RECENTLY_DELETED_KEY]: [
          {
            session: buildSession({ tabGroupId: 'J', title: 'Job search' }),
            deletedAt: new Date(2026, 9, 14, 0, 5).getTime(),
          },
        ],
      });
    });
    const row = await screen.findByTestId('recently-deleted-row');
    expect(plain(row.textContent)).toContain('Deleted today, 12:05 AM');

    toH23(store);
    expect(row.textContent).toContain('Deleted today, 00:05');
  });
});
