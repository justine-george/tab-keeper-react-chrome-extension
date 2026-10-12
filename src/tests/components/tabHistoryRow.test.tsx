import { afterEach, describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import { localeDicts } from '../setup/localeT';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { setHasSessionsPermission } from '../../redux/slices/globalStateSlice';

// KAN-280 Part D (spec O9b). "Bring back tab history when reopening" sits in
// Settings > Sessions under Save Tab Groups. Like that row it is not a store
// toggle: the switch IS Chrome's optional `sessions` permission. On asks for
// it, Off gives it back, and the pressed side shows what Chrome holds, read
// from globalState.hasSessionsPermission (which App keeps current).

const LABEL = 'Bring back tab history when reopening';
const HELP =
  'Reopening a closed tab or window from Open now also brings back its Back and Forward pages, except for grouped tabs in a reopened window. It uses Chrome’s list of recently closed tabs.';

const renderSessions = (granted: boolean) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed: granted ? { grantedPermissions: ['sessions'] } : undefined,
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.SESSIONS));
      store.dispatch(setHasSessionsPermission(granted));
    },
  });

const pair = () => screen.getByRole('group', { name: LABEL });

// Each settings section's label -- the first text a section draws.
const sectionLabels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-settings-section]')].map(
    (section) => section.querySelector('span')?.textContent
  );

afterEach(async () => {
  // The i18n instance is shared; a leaked locale would run later tests in it.
  await testI18n.changeLanguage('en');
});

describe('the tab-history row sits under Save Tab Groups', () => {
  test('its own section, after Save Tab Groups and before Default view', async () => {
    const { container } = await renderSessions(false);

    expect(pair()).toHaveAccessibleName(LABEL);
    expect(sectionLabels(container)).toEqual([
      'Save Tab Groups',
      LABEL,
      'Default view',
      'Pin Tab Keeper in new windows',
      'Keyboard shortcut',
    ]);
  });

  test('the help line reads, in full, under the pair', async () => {
    await renderSessions(false);

    const help = screen.getByText(HELP);
    // In the row's own section, and after the pair in document order.
    expect(help.closest('[data-settings-section]')).toBe(
      pair().closest('[data-settings-section]')
    );
    expect(
      pair().compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe('the row is translated', () => {
  // Every shipped locale, so a key missing from one file (English fallback)
  // or a key ending in ":" (i18next resolves it to "") shows here.
  test.each(localeDicts.filter(([locale]) => locale !== 'en'))(
    '%s renders its own label and help line',
    async (locale, dict) => {
      await renderSessions(false);
      testI18n.addResourceBundle(locale, 'translation', dict, true, true);
      await act(async () => {
        await testI18n.changeLanguage(locale);
      });
      expect(testI18n.language).toBe(locale);

      const label = dict[LABEL];
      const help = dict[HELP];
      expect(label).toBeTruthy();
      expect(help).toBeTruthy();
      expect(label).not.toBe(LABEL);
      expect(help).not.toBe(HELP);
      expect(screen.getByRole('group', { name: label })).toBeTruthy();
      expect(screen.getByText(help)).toBeTruthy();
    }
  );
});
