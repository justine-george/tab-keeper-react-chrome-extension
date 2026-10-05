import { afterEach, describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import {
  selectCategory,
  SettingsCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  Language,
  setLanguage,
} from '../../redux/slices/settingsDataStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import ru from '../../../public/locales/ru/translation.json';

// KAN-244. A language picker is the one screen that must be usable by someone
// who cannot read the current UI language -- that is why they are on it. It
// was ten buttons labelled through t(), so in Russian the way back to English
// read "Английский", and nothing on it said which language was current: the
// theme picker beside it marks its active swatch (KAN-237); this marked
// nothing, in pixels or in aria.
//
// Each language now names itself, in its own script, whatever the UI language;
// the current one is aria-pressed and filled with a check; and the order
// is the endonyms' own collation, stated here so it cannot drift back to the
// order they happened to be written in.

const ENDONYMS = [
  'Deutsch',
  'English',
  'Español',
  'Français',
  'Italiano',
  'Português',
  'Svenska',
  'Русский',
  'हिन्दी',
  '한국어',
  '日本語',
  '简体中文',
  '繁體中文',
];

const renderLanguagePane = (uiLanguage?: string) =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seed: uiLanguage ? { uiLanguage } : undefined,
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.LANGUAGE));
    },
  });

const option = (name: string) => screen.getByRole('button', { name });

const checkIn = (name: string) =>
  option(name).querySelector('.material-symbols-outlined')?.textContent ??
  undefined;

/** A colour as emotion wrote it, or as jsdom normalises it. */
const asWritten = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
};

afterEach(async () => {
  // The instance is shared, so a leaked locale would run every later test in
  // the wrong language.
  await testI18n.changeLanguage('en');
});

// changeLanguage AFTER the render: renderWithProviders calls init({ lng: 'en' }),
// which RESETS the language, so switching first silently runs English.
const switchUiTo = async (locale: 'ru') => {
  testI18n.addResourceBundle(locale, 'translation', ru, true, true);
  await act(async () => {
    await testI18n.changeLanguage(locale);
  });
  expect(testI18n.language).toBe(locale);
};

describe('the language picker names each language in its own language (KAN-244)', () => {
  test('with the UI in Russian, the way back to English still reads "English"', async () => {
    await renderLanguagePane();
    await switchUiTo('ru');

    // CONTROL: the switch took. The pane's heading is translated, so it is
    // Russian now -- which is exactly the condition the options must survive.
    expect(screen.getByText(ru['Choose Language'])).toBeTruthy();

    // The options are not: each is written in the language it names.
    expect(option('English')).toBeTruthy();
    expect(option('日本語')).toBeTruthy();
    expect(option('हिन्दी')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Английский' })).toBeNull();
  });

  test('the options are ordered by their own names, Latin scripts first', async () => {
    await renderLanguagePane();

    const names = screen
      .getAllByRole('button')
      // The pressed cell's ✓ is a ligature whose text is its name.
      .map((b) => b.textContent?.trim().replace(/^check/, ''))
      .filter((n): n is string => ENDONYMS.includes(n ?? ''));

    expect(names).toEqual(ENDONYMS);
    // The rule the list above follows, so a new language has somewhere to go
    // that is not "the end".
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  test('exactly one is pressed -- the current language -- and it alone wears the marker', async () => {
    const { store } = await renderLanguagePane();
    act(() => {
      store.dispatch(setLanguage(Language.RU));
    });

    const pressed = ENDONYMS.filter(
      (n) => option(n).getAttribute('aria-pressed') === 'true'
    );
    expect(pressed).toEqual(['Русский']);
    for (const n of ENDONYMS) {
      if (n === 'Русский') continue;
      expect(option(n).getAttribute('aria-pressed')).toBe('false');
    }

    // Setup's pressed look: TEXT fill with a PRIMARY label, and a check. The
    // rest keep the resting fill and no check.
    const fill = (name: string) => getComputedStyle(option(name));
    expect(fill('Русский').backgroundColor).toMatch(
      asWritten(LIGHT_THEME.TEXT_COLOR)
    );
    expect(fill('Русский').color).toMatch(asWritten(LIGHT_THEME.PRIMARY_COLOR));
    expect(fill('English').backgroundColor).toMatch(
      asWritten(LIGHT_THEME.PRIMARY_COLOR)
    );
    expect(checkIn('Русский')).toBe('check');
    for (const n of ENDONYMS) {
      if (n !== 'Русский') expect(checkIn(n)).toBeUndefined();
    }
  });

  test("with Chrome in French, Français is first, and picking Español changes no cell's place", async () => {
    const user = userEvent.setup();
    await renderLanguagePane('fr-FR');
    const order = () =>
      screen
        .getAllByRole('button')
        .map((b) => b.textContent?.trim().replace(/^check/, ''))
        .filter((n): n is string => ENDONYMS.includes(n ?? ''));

    const before = order();
    expect(before).toEqual([
      'Français',
      ...ENDONYMS.filter((n) => n !== 'Français'),
    ]);

    await user.click(option('Español'));
    expect(option('Español').getAttribute('aria-pressed')).toBe('true');
    expect(order()).toEqual(before);
    expect(order().indexOf('Español')).toBe(before.indexOf('Español'));
  });

  test('activating an option selects its language, in the store and in i18n', async () => {
    const user = userEvent.setup();
    const { store } = await renderLanguagePane();
    expect(store.getState().settingsDataState.language).toBe(Language.EN);

    await user.click(option('Deutsch'));
    expect(store.getState().settingsDataState.language).toBe(Language.DE);
    expect(testI18n.language).toBe('de');

    // And the marker follows: the store is the source of the pressed state.
    expect(option('Deutsch').getAttribute('aria-pressed')).toBe('true');
    expect(option('English').getAttribute('aria-pressed')).toBe('false');
  });
});
