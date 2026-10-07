import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Firebase is the only reason App cannot just be mounted -- see
// appSessionsPermissionWiring.test.tsx. Only the last describe mounts App.
vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
  isCloudConfigured: false,
}));

import App from '../../App';
import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { testI18n } from '../setup/i18nForTests';
import { localeDicts } from '../setup/localeT';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import {
  openSettingsPage,
  setHasSessionsPermission,
} from '../../redux/slices/globalStateSlice';
import {
  removeSessionsPermission,
  requestSessionsPermission,
} from '../../utils/functions/permissions';

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

type Side = 'On' | 'Off';
const SIDES: readonly Side[] = ['On', 'Off'];

const pair = () => screen.getByRole('group', { name: LABEL });
const side = (word: Side) => within(pair()).getByRole('button', { name: word });
// Which sides are pressed -- a list, so "both" or "neither" would show too.
const pressed = () =>
  SIDES.filter((word) => side(word).getAttribute('aria-pressed') === 'true');

// What Chrome holds, asked through the installed fake's own API.
const holdsSessions = () =>
  new Promise<boolean>((r) =>
    chrome.permissions.contains({ permissions: ['sessions'] }, r)
  );

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

  // Fix round 1. A screen reader lands on the pair and hears its name and
  // On/Off; without this it never hears what the switch does. The description
  // is on the element carrying role="group" (SlidingPair's track), where ARIA
  // allows it -- on a role-less wrapper it would be ignored.
  test('the pair is described by the help line', async () => {
    await renderSessions(false);

    expect(pair()).toHaveAccessibleDescription(HELP);
  });

  // Only this row opts in: the pair above it has no help line to point at.
  test('the Save Tab Groups pair carries no description', async () => {
    await renderSessions(false);

    const saveTabGroups = screen.getByRole('group', {
      name: 'Save Tab Groups',
    });
    expect(saveTabGroups.hasAttribute('aria-describedby')).toBe(false);
    expect(saveTabGroups).toHaveAccessibleDescription('');
  });
});

describe('the pressed side is what Chrome holds, not a stored setting', () => {
  test('Off when the store says the permission is not held', async () => {
    await renderSessions(false);
    expect(pressed()).toEqual(['Off']);
  });

  test('On when the store says it is held', async () => {
    await renderSessions(true);
    expect(pressed()).toEqual(['On']);
  });

  // No click: the store changing is enough, whoever changed it.
  test('a grant or revoke written to the store moves the pressed side', async () => {
    const { store } = await renderSessions(false);

    act(() => {
      store.dispatch(setHasSessionsPermission(true));
    });
    expect(pressed()).toEqual(['On']);

    act(() => {
      store.dispatch(setHasSessionsPermission(false));
    });
    expect(pressed()).toEqual(['Off']);
  });
});

// Two renders, as for Save Tab Groups: nothing here subscribes to Chrome, so
// the store does not move after a click, and a pointer on the pressed side
// flips the pair (KAN-218) -- a second click would be a second request, not
// the opposite call.
describe('choosing a side asks Chrome, and only for a change', () => {
  test('from Off, choosing On asks Chrome for the sessions permission', async () => {
    const user = userEvent.setup();
    await renderSessions(false);
    expect(await holdsSessions()).toBe(false);

    await user.click(side('On'));
    expect(await holdsSessions()).toBe(true);
  });

  test('from On, choosing Off gives the sessions permission back', async () => {
    const user = userEvent.setup();
    await renderSessions(true);
    expect(await holdsSessions()).toBe(true);

    await user.click(side('Off'));
    expect(await holdsSessions()).toBe(false);
  });

  // From the keyboard the pressed side is a no-op (KAN-225): SlidingPair does
  // not call onChange for it. Were that to change, this row would ask Chrome
  // for the permission from a key press on Off.
  test('choosing the side already pressed asks Chrome for nothing', async () => {
    const user = userEvent.setup();
    await renderSessions(false);

    side('Off').focus();
    await user.keyboard(' ');
    expect(await holdsSessions()).toBe(false);
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

describe('App: a grant made outside moves the row with no click', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test('chrome://extensions grants, then revokes, while Settings is open', async () => {
    // Skips the first-open modals; see appSessionsPermissionWiring.test.tsx.
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ cloudConsent: 'granted' })
    );
    const { store } = await renderWithProviders(<App />);
    await act(async () => {
      await store.dispatch(openSettingsPage(SettingsCategory.SESSIONS));
    });
    await waitFor(() => expect(pressed()).toEqual(['Off']));

    // Not this row's click: the fake fires permissions.onAdded, App's
    // observer writes the store, and the row follows.
    requestSessionsPermission();
    await waitFor(() => expect(pressed()).toEqual(['On']));

    removeSessionsPermission();
    await waitFor(() => expect(pressed()).toEqual(['Off']));
  });
});
