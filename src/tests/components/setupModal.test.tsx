import { afterEach, describe, expect, test, vi } from 'vitest';

// Firebase is the only reason App cannot just be mounted; one test below mounts it.
vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  ensureCloudSession: () => {},
  isCloudConfigured: false,
}));

import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useSelector } from 'react-redux';

import App from '../../App';
import { SetupModal } from '../../components/modals/SetupModal';
import { useDialogEscape } from '../../hooks/useDialogEscape';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import type { ChromeSeed } from '../setup/chrome.fake';
import type { RootState } from '../../redux/store';
import { openSetup } from '../../redux/slices/globalStateSlice';
import {
  initialState as settingsInitial,
  Language,
  settingsDataStateSlice,
  Theme,
  type SettingsData,
} from '../../redux/slices/settingsDataStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { RUN_FINISHED_SETTINGS } from '../fixtures/firstRunFixture';
import { classRulesFor } from '../setup/hoverRules';
import { mirrorLanguageOnDocument } from '../../utils/functions/documentLanguage';
import { asWritten } from '../setup/asWritten';
import { rgb } from '../setup/hexColor';

// KAN-7 §5 and Q9. Five or six steps; each pick applies at once; Done, Skip
// setup, ✕ and Esc end it for good. Mounted behind its flag, as in MainContainer.

function Gate() {
  // MainContainer's Esc claim, so a test can press Esc.
  useDialogEscape();
  const isOpen = useSelector((s: RootState) => s.globalState.isSetupOpen);
  return isOpen ? <SetupModal /> : null;
}

const BOUND: ChromeSeed = {
  action: {},
  windows: [{ id: 1, tabs: [] }],
  commands: [
    { name: '_execute_action', shortcut: 'Alt+Shift+K', description: '' },
  ],
  tabGroups: [],
};
const GROUPED: ChromeSeed = {
  ...BOUND,
  windows: [{ id: 1, tabs: [{ id: 5, groupId: 9, url: 'https://a.test/' }] }],
  tabs: [{ id: 5, windowId: 1, groupId: 9, url: 'https://a.test/' }],
  tabGroups: [{ id: 9, windowId: 1, title: 'Trip', color: 'blue' }],
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
          // KAN-731. A user on Paper, like the harness; the new-install test below uses the default.
          theme: Theme.LIGHT,
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
const line = () => within(dialog()).getByRole('progressbar');
// Next on the shortcut step asks Chrome before it moves, so each press is awaited.
const toStep = async (heading: string) => {
  for (let i = 0; i < 6 && stepHeading().textContent !== heading; i++) {
    press('Next');
    await act(async () => {});
  }
  expect(stepHeading()).toHaveTextContent(heading);
};
// The text link; the ✕ shares its name.
const skipLink = () =>
  within(dialog()).getByText('Skip setup', { exact: true });
const pressEscape = () =>
  fireEvent.keyDown(document.activeElement ?? dialog(), { key: 'Escape' });
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
    expect(within(dialog()).queryByRole('button', { name: 'Back' })).toBeNull();
    for (const name of [
      'Chalk',
      'Paper',
      'Parchment',
      'Petal',
      'Charcoal',
      'Graphite',
      'Ink',
    ]) {
      expect(
        within(dialog()).getByRole('button', { name })
      ).toBeInTheDocument();
    }
  });

  test('on a new install Chalk is the pressed theme (KAN-731)', async () => {
    await render(BOUND, { theme: settingsInitial.theme });
    expect(
      within(dialog()).getByRole('button', { name: 'Chalk' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(dialog()).getByRole('button', { name: 'Paper' })
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('the theme step says the choice can be changed in Settings', async () => {
    await render();
    expect(
      within(dialog()).getByText('You can change this any time in Settings.')
    ).toBeInTheDocument();
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
    expect(cross[0]).toHaveAttribute('data-tooltip', 'Skip setup');
    press('Graphite');
    fireEvent.click(cross[0]);
    expect(store.getState().settingsDataState.setupState).toBe('done');
    expect(store.getState().settingsDataState.theme).toBe('Darkenheimer');
    expect(screen.queryByRole('dialog')).toBeNull();
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

  describe('the shortcut step beside the tab (KAN-423)', () => {
    const HINT =
      'Opens Chrome’s shortcuts page next to this tab. Close that page to come back.';
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

describe('step 5, Save tab groups too? (Q9)', () => {
  test('shown with a group open and no grant: the Settings label, Off first, the caption', async () => {
    await render(GROUPED);
    await toStep('Save tab groups too?');
    const pair = within(dialog()).getByRole('group', {
      name: 'Save tab groups',
    });
    expect(
      within(pair)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Off', 'On']);
    expect(dialog()).toHaveTextContent(
      "Saved sessions keep each tab group's name and colour. Chrome will ask you to allow it."
    );
  });

  test('skipped while the grant is held, though a group is open', async () => {
    await render({ ...GROUPED, grantedPermissions: ['tabGroups'] });
    await waitFor(() => expect(line()).toHaveAttribute('aria-valuemax', '5'));
    await toStep('Open Tab Keeper from the keyboard');
    press('Next');
    await act(async () => {});
    expect(stepHeading()).toHaveTextContent('Sync across your devices?');
  });

  for (const how of ['Back', 'Skip setup', 'Esc'] as const) {
    test(`${how} on step 5 is no answer: the pop-up offer stays armed`, async () => {
      const { store } = await render(GROUPED);
      await toStep('Save tab groups too?');
      if (how === 'Back') press('Back');
      else if (how === 'Skip setup') fireEvent.click(skipLink());
      else pressEscape();
      // Each did what it does, so the flag below is read after the action.
      if (how === 'Back') {
        expect(stepHeading()).toHaveTextContent(
          'Open Tab Keeper from the keyboard'
        );
      } else {
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(store.getState().settingsDataState.setupState).toBe('done');
      }
      expect(
        store.getState().settingsDataState.isNeverAskAgainForTabGroups
      ).toBe(false);
    });
  }
});

describe('step 5 with App: the switch follows the grant (Q9, §14)', () => {
  afterEach(() => {
    history.replaceState(null, '', '?');
    localStorage.clear();
    delete document.documentElement.dataset.firstOpen;
  });

  test('On asks Chrome for tabGroups once and stays Off; App’s onAdded listener turns it On', async () => {
    history.replaceState(null, '', '?view=tab&show=setup');
    const settings = {
      cloudConsent: 'granted' as const,
      ...RUN_FINISHED_SETTINGS,
    };
    const { store } = await renderWithProviders(<App />, {
      seed: GROUPED,
      seedStore: (s) => {
        s.dispatch(
          settingsDataStateSlice.actions.replaceState({
            ...settingsInitial,
            ...settings,
          })
        );
        localStorage.setItem('settingsData', JSON.stringify(settings));
      },
    });
    await waitFor(() =>
      expect(store.getState().globalState.isSetupOpen).toBe(true)
    );
    await waitFor(() => expect(line()).toHaveAttribute('aria-valuemax', '6'));
    await toStep('Save tab groups too?');
    const side = (name: 'On' | 'Off') =>
      within(
        within(dialog()).getByRole('group', { name: 'Save tab groups' })
      ).getByRole('button', { name });
    // Chrome's prompt, open and unanswered: the popup may die before it settles.
    const request = vi
      .spyOn(chrome.permissions, 'request')
      .mockImplementationOnce(() => new Promise<boolean>(() => {}));

    fireEvent.click(side('On'));
    await act(async () => {});

    expect(request.mock.calls).toEqual([[{ permissions: ['tabGroups'] }]]);
    expect(side('Off')).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().globalState.hasTabGroupsPermission).toBe(false);

    // The grant lands: the fake adds it and fires onAdded, which App's listener carries to the store.
    await act(async () => {
      await chrome.permissions.request({ permissions: ['tabGroups'] });
    });
    expect(side('On')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('step 6, Sync across your devices? (Q9)', () => {
  test('Off first, pressed on a device that never said yes; the caption links the policy', async () => {
    const { chrome } = await render();
    await toStep('Sync across your devices?');
    const pair = within(dialog()).getByRole('group', { name: 'Auto sync' });
    expect(
      within(pair)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Off', 'On']);
    expect(within(pair).getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(dialog()).toHaveTextContent(
      'Off keeps your sessions on this device. On syncs them across devices. See the privacy policy.'
    );
    const link = within(dialog()).getByRole('link', { name: 'privacy policy' });
    fireEvent.click(link);
    await waitFor(() =>
      expect(chrome.createdTabs.map((tab) => tab.url)).toEqual([
        link.getAttribute('href'),
      ])
    );
    expect(
      within(dialog()).getByRole('button', { name: 'Done' })
    ).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Next' })).toBeNull();
  });

  test('On without consent opens the enable question over setup and turns nothing on', async () => {
    // A new install reaches setup having declined at the welcome.
    const { store } = await render(BOUND, {
      cloudConsent: 'declined',
      isAutoSync: false,
    });
    await toStep('Sync across your devices?');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'On' }));
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true);
    expect(store.getState().globalState.cloudConsentVariant).toBe('enable');
    expect(store.getState().settingsDataState.cloudConsent).toBe('declined');
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(store.getState().globalState.isSetupOpen).toBe(true);
    expect(
      within(dialog()).getByRole('button', { name: 'Off' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('an upgrader with sync on sees On; Off turns it off as Settings does', async () => {
    const { store } = await render(BOUND, {
      cloudConsent: 'granted',
      isAutoSync: true,
    });
    await toStep('Sync across your devices?');
    expect(
      within(dialog()).getByRole('button', { name: 'On' })
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Off' }));
    expect(store.getState().settingsDataState.isAutoSync).toBe(false);
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
  });
});

describe('Next answers one press at a time (review)', () => {
  test('the second click of a double-click on step 5’s Next is no answer', async () => {
    const { store } = await render(GROUPED);
    await toStep('Save tab groups too?');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Next' }), {
      detail: 2,
    });
    await act(async () => {});
    expect(stepHeading()).toHaveTextContent('Save tab groups too?');
    expect(store.getState().settingsDataState.isNeverAskAgainForTabGroups).toBe(
      false
    );
  });

  test('Go back pressed before Chrome answers the re-ask keeps the user where Go back put them', async () => {
    await render();
    await waitFor(() => expect(line()).toHaveAttribute('aria-valuemax', '5'));
    await toStep('Open Tab Keeper from the keyboard');
    // Chrome has not answered yet: the grant check of the shortcut step's re-ask waits.
    let answer: (held: boolean) => void = () => {};
    vi.spyOn(chrome.permissions, 'contains').mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        })
    );
    press('Next');
    await act(async () => {});
    expect(stepHeading()).toHaveTextContent(
      'Open Tab Keeper from the keyboard'
    );
    press('Back');
    expect(stepHeading()).toHaveTextContent('When you click Tab Keeper, open…');

    await act(async () => answer(false));
    await act(async () => {});
    expect(stepHeading()).toHaveTextContent('When you click Tab Keeper, open…');
  });
});

describe('Korean captions keep their words whole (M5 B)', () => {
  // The caption's own keep-all rules whose selector matches it in the document's language now.
  const keepAllMatching = (el: Element) =>
    classRulesFor(el)
      .split('\n')
      .filter((rule) => rule.includes('keep-all'))
      .map((rule) => rule.slice(0, rule.indexOf('{')).trim())
      .filter((selector) => el.matches(selector));
  const syncCaption = async (lang: string) => {
    mirrorLanguageOnDocument(testI18n, document.documentElement);
    await render();
    await act(async () => {
      await testI18n.changeLanguage(lang);
    });
    expect(document.documentElement.lang).toBe(lang);
    await toStep('Sync across your devices?');
    const caption = within(dialog())
      .getByRole('link', { name: 'privacy policy' })
      .closest('p');
    if (caption === null) throw new Error('no caption');
    return caption;
  };

  test('in Korean the step caption breaks only between words', async () => {
    const caption = await syncCaption('ko');
    expect(keepAllMatching(caption)).not.toEqual([]);
  });

  test('CONTROL: in Japanese, which has no spaces, the same caption keeps the normal breaks', async () => {
    const caption = await syncCaption('ja');
    // The rule is there; it does not reach Japanese.
    expect(classRulesFor(caption)).toContain('keep-all');
    expect(keepAllMatching(caption)).toEqual([]);
  });
});

// KAN-501. The way forward is the filled button the tour and Hello use; the way back is Back, as everywhere else.
describe('setup’s buttons (KAN-501)', () => {
  const button = (name: string) =>
    within(dialog()).getByRole('button', { name });
  // The resting rule: jsdom answers a pressed button's computed style with its :hover rung.
  const restingFill = (el: HTMLElement) =>
    classRulesFor(el)
      .split('\n')
      .filter((rule) => !/:(hover|active|focus)/.test(rule))
      .join('\n');
  const FILLED = `background-color: ${rgb(LIGHT_THEME.TEXT_COLOR)}`;

  test('Next and Done are filled, and the way back is Back', async () => {
    await render();
    expect(restingFill(button('Next'))).toContain(FILLED);
    press('Next');
    await act(async () => {});
    expect(button('Back')).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole('button', { name: 'Go back' })
    ).toBeNull();
    for (
      let i = 0;
      i < 6 &&
      within(dialog()).queryByRole('button', { name: 'Done' }) === null;
      i++
    ) {
      press('Next');
      await act(async () => {});
    }
    expect(restingFill(button('Done'))).toContain(FILLED);
  });
});

// KAN-731. 600px keeps the sync caption on one line in every locale (KAN-519); en needs 589.5px.
describe('setup’s width (KAN-731)', () => {
  test('is 600px', async () => {
    await render();
    // jsdom's stylesheet drops the calc() wrapper, so the rule reads min(100% - 32px, …).
    expect(classRulesFor(dialog())).toContain('width: min(100% - 32px, 600px)');
  });
});
