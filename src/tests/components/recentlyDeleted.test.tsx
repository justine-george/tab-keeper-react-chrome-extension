import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { RECENTLY_DELETED_KEY } from '../../utils/functions/recentlyDeleted';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { testI18n } from '../setup/i18nForTests';
import de from '../../../public/locales/de/translation.json';

// KAN-595. Settings → Recently deleted, as round 3 drew it: Restore on every
// row, a red Empty beside the heading, both the same width.

const DAY = 86_400_000;
// Local noon, so "today" holds whatever the machine's timezone.
const NOW = new Date(2026, 9, 13, 12, 0, 0).getTime();

const lisbon = buildSession({ tabGroupId: 'L', title: 'Lisbon trip' });
const firebase = {
  ...buildSession({ tabGroupId: 'F', title: 'Firebase console' }),
  tabCount: 12,
};

const entries = [
  { session: firebase, deletedAt: NOW - 60_000 },
  { session: { ...lisbon, tabCount: 1 }, deletedAt: NOW - 27 * DAY },
];

const renderPage = async (live = [buildSession({ tabGroupId: 'K' })]) => {
  const made = await renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer(live)));
      store.dispatch(selectCategory(SettingsCategory.RECENTLY_DELETED));
    },
  });
  return made;
};

const stock = async (list: unknown) => {
  await act(async () => {
    await chrome.storage.local.set({ [RECENTLY_DELETED_KEY]: list });
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Recently deleted page (KAN-595)', () => {
  test('lists each deleted session with its count, its day, and its last week', async () => {
    await renderPage();
    await stock(entries);
    const rows = await screen.findAllByTestId('recently-deleted-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Firebase console'),
      expect.stringContaining('Lisbon trip'),
    ]);
    expect(within(rows[0]).getByText('12 tabs · Deleted today')).toBeTruthy();
    expect(
      within(rows[1]).getByText(/^1 tab · Deleted Sep 16 · 3 days left$/)
    ).toBeTruthy();
  });

  test('every row offers Restore, named for its session, without a hover', async () => {
    await renderPage();
    await stock(entries);
    const restore = await screen.findByRole('button', {
      name: 'Restore Lisbon trip',
    });
    expect(restore).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Restore Firebase console' })
    ).toBeVisible();
  });

  test('Restore and Empty are the same width', async () => {
    await renderPage();
    await stock(entries);
    const restore = await screen.findByRole('button', {
      name: 'Restore Lisbon trip',
    });
    const empty = screen.getByRole('button', { name: 'Empty' });
    // 8rem; jsdom resolves it against its 16px root.
    expect(getComputedStyle(restore).width).toBe('128px');
    expect(getComputedStyle(empty).width).toBe(getComputedStyle(restore).width);
  });

  test('Restore brings the session back, selected, says so, and leaves the list', async () => {
    const { store } = await renderPage();
    await stock(entries);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Restore Lisbon trip' })
    );
    await waitFor(() =>
      expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
        'L'
      )
    );
    expect(store.getState().tabContainerDataState.tabGroups[0].tabGroupId).toBe(
      'L'
    );
    expect(store.getState().globalState.toasts.map((t) => t.text)).toContain(
      TOAST_MESSAGES.SESSION_RESTORED
    );
    await waitFor(() => expect(screen.queryByText('Lisbon trip')).toBeNull());
  });

  test('Empty asks first; Cancel keeps everything', async () => {
    const { chrome } = await renderPage();
    await stock(entries);
    fireEvent.click(await screen.findByRole('button', { name: 'Empty' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Permanently delete 2 sessions?',
    });
    expect(
      within(dialog).getByText('You can’t restore them after this.')
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByTestId('recently-deleted-row')).toHaveLength(2);
    expect(RECENTLY_DELETED_KEY in chrome.localArea()).toBe(true);
  });

  test('Empty, confirmed, deletes them all for good', async () => {
    const { chrome } = await renderPage();
    await stock(entries);
    fireEvent.click(await screen.findByRole('button', { name: 'Empty' }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    await waitFor(() =>
      expect(
        screen.getByText('Nothing deleted in the last 30 days.')
      ).toBeTruthy()
    );
    expect(RECENTLY_DELETED_KEY in chrome.localArea()).toBe(false);
  });

  test('one session: the dialog says session, not sessions', async () => {
    await renderPage();
    await stock([entries[0]]);
    fireEvent.click(await screen.findByRole('button', { name: 'Empty' }));
    expect(
      screen.getByRole('dialog', { name: 'Permanently delete 1 session?' })
    ).toBeTruthy();
  });

  test('nothing deleted: the empty line, and no Empty', async () => {
    await renderPage();
    expect(
      await screen.findByText('Nothing deleted in the last 30 days.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Empty' })).toBeNull();
  });

  test('a session live again is not listed', async () => {
    await renderPage([buildSession({ tabGroupId: 'L', title: 'Lisbon trip' })]);
    await stock(entries);
    await screen.findByText('Firebase console');
    expect(screen.queryByText('Lisbon trip')).toBeNull();
  });

  test('the heading and its line', async () => {
    await renderPage();
    // A label, as every other Settings section titles itself.
    expect(screen.getByText('Recently deleted')).toBeTruthy();
    expect(
      screen.getByText('Kept for 30 days, then permanently deleted.')
    ).toBeTruthy();
  });

  // One key, two meanings: `Empty` is the adjective an empty window shows
  // (de "Leer"); the button is the verb (de "Leeren"). English cannot tell.
  test('Empty is the verb, in a language that spells it differently', async () => {
    await renderPage();
    testI18n.addResourceBundle('de', 'translation', de);
    try {
      await act(async () => {
        await testI18n.changeLanguage('de');
      });
      await stock(entries);
      expect(
        await screen.findByRole('button', { name: 'Leeren' })
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Leer' })).toBeNull();
    } finally {
      await act(async () => {
        await testI18n.changeLanguage('en');
      });
    }
  });
});
