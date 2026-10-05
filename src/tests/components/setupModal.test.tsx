import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useSelector } from 'react-redux';

import { SetupModal } from '../../components/modals/SetupModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import type { ChromeSeed } from '../setup/chrome.fake';
import type { RootState } from '../../redux/store';
import { openSetup } from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  Language,
  settingsDataStateSlice,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { CHROME_SHORTCUTS_URL } from '../../hooks/usePopupShortcut';

// KAN-7 §5. Four steps; each pick applies at once; Done, Skip setup, ✕ and Esc
// end it for good. Mounted behind its flag, as in MainContainer.

function Gate() {
  const isOpen = useSelector((s: RootState) => s.globalState.isSetupOpen);
  return isOpen ? <SetupModal /> : null;
}

const BOUND: ChromeSeed = {
  action: {},
  windows: [{ id: 1, tabs: [] }],
  commands: [
    { name: '_execute_action', shortcut: 'Alt+Shift+K', description: '' },
  ],
};

const render = (
  seed: ChromeSeed = BOUND,
  settings: Partial<SettingsData> = {}
) =>
  renderWithProviders(<Gate />, {
    seed,
    seedStore: (store) => {
      store.dispatch(
        settingsDataStateSlice.actions.replaceState({
          ...settingsInitial,
          setupState: 'pending',
          ...settings,
        })
      );
      store.dispatch(openSetup());
    },
  });

const dialog = () =>
  screen.getByRole('dialog', { name: 'Make Tab Keeper yours' });
const stepHeading = () => within(dialog()).getByRole('heading', { level: 3 });
const press = (name: string) =>
  fireEvent.click(within(dialog()).getByRole('button', { name }));
const languageCodes = () =>
  [...dialog().querySelectorAll('button[lang]')].map((b) =>
    b.getAttribute('lang')
  );

afterEach(async () => {
  localStorage.clear();
  vi.restoreAllMocks();
  await testI18n.changeLanguage('en');
});

describe('Make Tab Keeper yours', () => {
  test('opens unlit on the theme step, with no Go back', async () => {
    await render();
    expect(document.activeElement).toBe(dialog());
    expect(stepHeading()).toHaveTextContent('Pick a theme');
    expect(
      within(dialog()).queryByRole('button', { name: 'Go back' })
    ).toBeNull();
    for (const name of ['Paper', 'Parchment', 'Petal', 'Graphite', 'Ink']) {
      expect(
        within(dialog()).getByRole('button', { name })
      ).toBeInTheDocument();
    }
  });

  test('the theme step says the choice can be changed in Settings', async () => {
    await render();
    expect(
      within(dialog()).getByText('You can change this any time in Settings.')
    ).toBeInTheDocument();
  });

  test('a theme pick applies at once and stays on the step', async () => {
    const { store } = await render();
    press('Graphite');
    expect(store.getState().settingsDataState.theme).toBe('Darkenheimer');
    expect(stepHeading()).toHaveTextContent('Pick a theme');
  });

  test('Next and Go back walk the steps, and a new step takes the focus', async () => {
    await render();
    press('Next');
    expect(stepHeading()).toHaveTextContent('Which language do you prefer?');
    expect(document.activeElement).toBe(stepHeading());
    press('Go back');
    expect(stepHeading()).toHaveTextContent('Pick a theme');
  });

  test('the language step: picker order when Chrome says nothing, the current one pressed with a ✓', async () => {
    await render();
    press('Next');
    expect(languageCodes()).toEqual([
      'de',
      'en',
      'es',
      'fr',
      'it',
      'pt',
      'sv',
      'ru',
      'hi',
      'ko',
      'ja',
      'zh',
      'zh-TW',
    ]);
    const english = dialog().querySelector('button[lang="en"]');
    expect(english).toHaveAttribute('aria-pressed', 'true');
    expect(
      english?.querySelector('.material-symbols-outlined')?.textContent
    ).toBe('check');
  });

  test('the pressed language cell is filled TEXT with a PRIMARY label; the others stay unfilled', async () => {
    await render();
    press('Next');
    const asWritten = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
    };
    const cell = (code: string) => {
      const el = dialog().querySelector(`button[lang="${code}"]`);
      if (!(el instanceof HTMLElement)) throw new Error(`no cell ${code}`);
      return el;
    };
    const pressed = getComputedStyle(cell('en'));
    expect(pressed.backgroundColor).toMatch(asWritten(LIGHT_THEME.TEXT_COLOR));
    expect(pressed.color).toMatch(asWritten(LIGHT_THEME.PRIMARY_COLOR));
    expect(
      cell('en').querySelector('.material-symbols-outlined')
    ).not.toBeNull();
    const other = getComputedStyle(cell('de'));
    expect(other.backgroundColor).not.toMatch(
      asWritten(LIGHT_THEME.TEXT_COLOR)
    );
    expect(cell('de').querySelector('.material-symbols-outlined')).toBeNull();
  });

  test('Chrome in Japanese puts 日本語 first, even when the current language is another', async () => {
    await render({ ...BOUND, uiLanguage: 'ja-JP' }, { language: Language.DE });
    press('Next');
    expect(languageCodes()[0]).toBe('ja');
    expect(dialog().querySelector('button[lang="de"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('Chrome in French and German current: Français first, Deutsch pressed in its own slot', async () => {
    await render({ ...BOUND, uiLanguage: 'fr-FR' }, { language: Language.DE });
    press('Next');
    const codes = languageCodes();
    expect(codes).toEqual([
      'fr',
      'de',
      'en',
      'es',
      'it',
      'pt',
      'sv',
      'ru',
      'hi',
      'ko',
      'ja',
      'zh',
      'zh-TW',
    ]);
    expect(dialog().querySelector('button[lang="de"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(codes.indexOf('de')).toBe(1);
  });

  test('a language pick applies like Settings, presses its cell in place, and keeps the step', async () => {
    const { store } = await render();
    press('Next');
    const before = languageCodes();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Deutsch' }));

    expect(store.getState().settingsDataState.language).toBe('de');
    expect(testI18n.language).toBe('de');
    expect(languageCodes()).toEqual(before);
    expect(dialog().querySelector('button[lang="de"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(dialog().querySelector('button[lang="en"]')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(dialog().querySelectorAll('button[lang]')).toHaveLength(13);
  });

  test('the default view step: Compact pressed; Full applies as Settings does', async () => {
    const { store, chrome } = await render();
    press('Next');
    press('Next');
    expect(stepHeading()).toHaveTextContent('When you click Tab Keeper, open…');
    expect(
      within(dialog()).getByRole('button', { name: 'Compact view' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(dialog()).getByText('You can change this any time in Settings.')
    ).toBeInTheDocument();

    press('Full view');
    await waitFor(() => expect(chrome.popupsSet).toEqual(['']));
    expect(store.getState().settingsDataState.defaultView).toBe('full');
  });

  test('the shortcut step names the bound key, and Change shortcut opens Chrome’s page', async () => {
    const { chrome } = await render();
    press('Next');
    press('Next');
    press('Next');
    expect(stepHeading()).toHaveTextContent(
      'Open Tab Keeper from the keyboard'
    );
    await waitFor(() =>
      expect(screen.getByTestId('setup-shortcut')).toHaveTextContent('K')
    );
    expect(
      within(dialog()).getByText('Works in any window.')
    ).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Next' })).toBeNull();

    press('Change shortcut');
    // The tab opens after the current tab has been asked for.
    await waitFor(() =>
      expect(chrome.createdTabs.map((tab) => tab.url)).toEqual([
        CHROME_SHORTCUTS_URL,
      ])
    );
  });

  test('no shortcut bound: says so, and offers to set one', async () => {
    await render({
      action: {},
      windows: [{ id: 1, tabs: [] }],
      commands: [{ name: '_execute_action', shortcut: '', description: '' }],
    });
    press('Next');
    press('Next');
    press('Next');
    expect(
      await within(dialog()).findByText('No shortcut is set.')
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByRole('button', { name: 'Set a shortcut' })
    ).toBeInTheDocument();
  });

  test('Done ends setup for good', async () => {
    const { store } = await render();
    press('Next');
    press('Next');
    press('Next');
    press('Done');
    expect(store.getState().settingsDataState.setupState).toBe('done');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Skip setup ends it for good on any step, and keeps what was picked', async () => {
    const { store } = await render();
    press('Graphite');
    press('Next');
    // The text link; the ✕ shares its name.
    fireEvent.click(within(dialog()).getByText('Skip setup'));
    expect(store.getState().settingsDataState.setupState).toBe('done');
    expect(store.getState().settingsDataState.theme).toBe('Darkenheimer');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // §"Error and edge cases": the guide already closed; a pin now changes nothing.
  test('a pin while setup is open changes nothing', async () => {
    const { store, chrome } = await render({
      ...BOUND,
      action: { isOnToolbar: false },
    });
    press('Next');
    act(() => chrome.setToolbarPin(true));
    expect(stepHeading()).toHaveTextContent('Which language do you prefer?');
    expect(store.getState().globalState.isPinGuideOpen).toBe(false);
    expect(store.getState().globalState.isSetupOpen).toBe(true);
  });

  test('Esc ends it for good: closed, done, and the Esc is consumed (KAN-403)', async () => {
    const { store } = await render();
    const notPrevented = fireEvent(
      dialog(),
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.getState().settingsDataState.setupState).toBe('done');
  });

  test('the ✕ is Skip setup: named so, ends it for good, keeping what was picked (D4)', async () => {
    const { store } = await render();
    const named = within(dialog()).getAllByRole('button', {
      name: 'Skip setup',
    });
    // The text link and the ✕, told apart by the ✕'s glyph.
    expect(named).toHaveLength(2);
    const cross = named.filter((el) => el.textContent === 'close');
    expect(cross).toHaveLength(1);
    // The hover tip says what it does, not "Close".
    expect(cross[0]).toHaveAttribute('title', 'Skip setup');
    press('Graphite');
    fireEvent.click(cross[0]);
    expect(store.getState().settingsDataState.setupState).toBe('done');
    expect(store.getState().settingsDataState.theme).toBe('Darkenheimer');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('four decorative step dots, the current one filled (D4)', async () => {
    await render();
    const dots = () => [...dialog().querySelectorAll('[data-step-dot]')];
    const current = () =>
      dots().map((dot) => dot.getAttribute('data-current') === 'true');

    expect(dots()).toHaveLength(4);
    expect(dots()[0].parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(current()).toEqual([true, false, false, false]);
    press('Next');
    expect(current()).toEqual([false, true, false, false]);
    press('Next');
    press('Next');
    expect(current()).toEqual([false, false, false, true]);
  });

  test('the default view step: the pressed card carries a ✓ in its label strip, the other none (D2)', async () => {
    await render();
    press('Next');
    press('Next');
    const strip = (name: string) =>
      within(dialog())
        .getByRole('button', { name })
        .querySelector('[data-view-label]');
    expect(
      strip('Compact view')?.querySelector('.material-symbols-outlined')
        ?.textContent
    ).toBe('check');
    expect(
      strip('Full view')?.querySelector('.material-symbols-outlined')
    ).toBeNull();
  });

  test('each default-view card says where it opens, under its name', async () => {
    await render();
    press('Next');
    press('Next');
    const card = (name: string) =>
      within(dialog()).getByRole('button', { name });
    expect(card('Compact view')).toHaveAccessibleDescription(
      'Opens under the toolbar icon'
    );
    expect(card('Full view')).toHaveAccessibleDescription(
      'Opens in its own tab'
    );
    const lines = card('Full view').querySelector('[data-view-label]');
    expect(lines?.textContent).toBe('Full viewOpens in its own tab');
  });

  test('the picked card caption wears the strip label colour; the other keeps LABEL_L1', async () => {
    await render();
    press('Next');
    press('Next');
    const caption = (name: string) => {
      const el = within(dialog())
        .getByRole('button', { name })
        .querySelector('[data-view-caption]');
      if (!(el instanceof HTMLElement)) throw new Error(`no caption ${name}`);
      return getComputedStyle(el).color;
    };
    const asWritten = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
    };
    expect(caption('Compact view')).toMatch(
      asWritten(LIGHT_THEME.PRIMARY_COLOR)
    );
    expect(caption('Full view')).toMatch(asWritten(LIGHT_THEME.LABEL_L1_COLOR));
  });

  describe('the shortcut step beside the tab (KAN-423)', () => {
    const HINT = 'Opens next to this tab. Close it to come back.';
    const inTab: ChromeSeed = {
      ...BOUND,
      windows: [{ id: 1, tabs: [{ id: 10 }, { id: 11 }] }],
      currentTabId: 10,
    };
    const toShortcutStep = () => {
      press('Next');
      press('Next');
      press('Next');
    };
    afterEach(() => history.replaceState(null, '', '/'));

    test('in the full view the hint sits beside Change shortcut, and the page opens beside the tab', async () => {
      history.replaceState(null, '', '/?view=tab');
      const { chrome } = await render(inTab);
      toShortcutStep();
      await within(dialog()).findByRole('button', { name: 'Change shortcut' });
      expect(within(dialog()).getByText(HINT)).toBeInTheDocument();
      press('Change shortcut');
      await waitFor(() =>
        expect(chrome.createdTabs).toEqual([
          {
            url: CHROME_SHORTCUTS_URL,
            index: 1,
            openerTabId: 10,
            windowId: 1,
          },
        ])
      );
    });

    test('in the full view the no-shortcut branch carries the hint too', async () => {
      history.replaceState(null, '', '/?view=tab');
      await render({
        ...inTab,
        commands: [{ name: '_execute_action', shortcut: '', description: '' }],
      });
      toShortcutStep();
      await within(dialog()).findByRole('button', { name: 'Set a shortcut' });
      expect(within(dialog()).getByText(HINT)).toBeInTheDocument();
    });

    test('in the popup there is no hint', async () => {
      await render();
      toShortcutStep();
      await within(dialog()).findByRole('button', { name: 'Change shortcut' });
      expect(within(dialog()).queryByText(HINT)).toBeNull();
    });
  });
});
