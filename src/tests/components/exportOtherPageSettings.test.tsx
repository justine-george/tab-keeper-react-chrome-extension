import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import de from '../../../public/locales/de/translation.json';

import ExportPage from '../../components/export/ExportPage';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import {
  initialState as settingsInitial,
  Language,
  settingsDataStateSlice,
  Theme,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';

// KAN-305. Every settings reducer saves the WHOLE settings object, so a page
// holding a stale copy undoes, on its next save, whatever another page changed
// meanwhile. The export page is one such page: it must take in other pages'
// settings writes, as App does (KAN-279 D9).

const SESSION = buildSession({ tabGroupId: 'session-kyoto', title: 'Kyoto' });

const STARTING: SettingsData = {
  ...settingsInitial,
  theme: Theme.LIGHT,
  isAutoSync: true,
  exportLayout: 'compact',
};

const renderPage = () =>
  renderWithProviders(
    <ExportPage
      source={{ kind: 'saved', tabGroupId: 'session-kyoto' }}
      from="full"
    />,
    {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([SESSION])));
        store.dispatch(settingsDataStateSlice.actions.replaceState(STARTING));
        // replaceState saves the PREVIOUS state; storage holds this one.
        localStorage.setItem('settingsData', JSON.stringify(STARTING));
      },
    }
  );

// What another page does: write the key, then the browser tells this page.
const otherPageWrites = (settings: SettingsData) => {
  const newValue = JSON.stringify(settings);
  localStorage.setItem('settingsData', newValue);
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'settingsData', newValue })
    );
  });
};

const stored = (): SettingsData =>
  JSON.parse(localStorage.getItem('settingsData') ?? 'null');

beforeEach(() => localStorage.clear());
afterEach(async () => {
  cleanup();
  localStorage.clear();
  await testI18n.changeLanguage('en');
});

describe('the export page keeps settings changed in another page (KAN-305)', () => {
  test('a theme and Auto Sync changed elsewhere survive a Layout change here', async () => {
    const user = userEvent.setup();
    await renderPage();

    otherPageWrites({
      ...STARTING,
      theme: Theme.DARKENHEIMER,
      isAutoSync: false,
    });
    await user.click(screen.getByRole('button', { name: 'Comfortable' }));

    // CONTROL: the click did save, so the reads below are of this page's write.
    expect(stored().exportLayout).toBe('comfortable');
    expect(stored().theme).toBe(Theme.DARKENHEIMER);
    expect(stored().isAutoSync).toBe(false);
  });

  test('a language chosen elsewhere translates this page', async () => {
    await renderPage();
    // After the render: renderWithProviders' init resets the language.
    testI18n.addResourceBundle('de', 'translation', de, true, true);
    expect(screen.getByRole('button', { name: 'Comfortable' })).toBeTruthy();

    otherPageWrites({ ...STARTING, language: Language.DE });

    await waitFor(() => expect(testI18n.language).toBe('de'));
    expect(
      await screen.findByRole('button', { name: 'Komfortabel' })
    ).toBeTruthy();
  });

  test('unreadable settings from another page change nothing, and Layout still saves', async () => {
    const user = userEvent.setup();
    await renderPage();

    localStorage.setItem('settingsData', '[1, 2]');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'settingsData', newValue: '[1, 2]' })
      );
    });
    await user.click(screen.getByRole('button', { name: 'Comfortable' }));

    expect(stored()).toMatchObject({
      theme: Theme.LIGHT,
      isAutoSync: true,
      exportLayout: 'comfortable',
    });
  });
});
