import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TabGroupsPermissionModal } from '../../components/modals/TabGroupsPermissionModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openTabGroupsPrompt } from '../../redux/slices/globalStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { DIALOG } from '../../styles/scale';
import { rgb } from '../setup/hexColor';
import { testI18n } from '../setup/i18nForTests';
import de from '../../../public/locales/de/translation.json';
import ja from '../../../public/locales/ja/translation.json';

// Cleared each time so no test inherits another's stored settings.
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

// The prompt is opened by App.tsx in production. Here it is opened directly,
// synchronously, before first render -- see renderWithProviders' note on why
// seedStore must not defer.
const openWith =
  (count: number) => (store: { dispatch: (a: unknown) => void }) =>
    store.dispatch(openTabGroupsPrompt(count));

describe('TabGroupsPermissionModal', () => {
  test('renders nothing when no prompt is open', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />);

    expect(screen.queryByText('Tab Keeper can save tab groups')).toBeNull();
  });

  test("the footer is the sync dialog's pair: Not now then a filled Turn on", async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    const notNow = screen.getByRole('button', { name: 'Not now' });
    const turnOn = screen.getByRole('button', { name: 'Turn on' });
    // One row, Not now first; the layout itself is measured in e2e.
    expect(notNow.parentElement).toBe(turnOn.parentElement);
    expect(notNow.nextElementSibling).toBe(turnOn);
    expect(turnOn.parentElement?.lastElementChild).toBe(turnOn);
    expect(turnOn.querySelector('.material-symbols-outlined')).toBeNull();
    // KAN-732. Not now is the quiet outlined button, not a link.
    const quiet = getComputedStyle(notNow);
    expect(quiet.textDecorationLine).not.toBe('underline');
    expect(quiet.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(quiet.borderColor).toBe(rgb(LIGHT_THEME.CONTROL_BORDER_COLOR));
    // The `filled` dialog style: TEXT_COLOR ground, PRIMARY_COLOR letters.
    const fill = getComputedStyle(turnOn);
    expect(fill.backgroundColor).toBe(rgb(LIGHT_THEME.TEXT_COLOR));
    expect(fill.color).toBe(rgb(LIGHT_THEME.PRIMARY_COLOR));
    expect(
      screen.queryByRole('button', { name: 'Enable tab group support' })
    ).toBeNull();
  });

  test('one group reads as singular, with no count in the sentence', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(1),
    });

    expect(
      screen.getByText(
        'Turn it on and your tab group comes back exactly as you set it up.'
      )
    ).toBeTruthy();
  });

  // Paired with the singular test above: together they prove the ternary picks
  // a key rather than always landing on one of them.
  test('several groups read as plural and name the count', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(3),
    });

    expect(
      screen.getByText(
        'Turn it on and your 3 tab groups come back exactly as you set them up.'
      )
    ).toBeTruthy();
  });
});

describe('TabGroupsPermissionModal answers', () => {
  // KAN-732. No opt-out: Not now only closes, and the offer returns on the next open.
  test('Not now closes and writes nothing to settings', async () => {
    const { store } = await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });
    const before = localStorage.getItem('settingsData');
    const beforeState = store.getState().settingsDataState;

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
    expect(localStorage.getItem('settingsData')).toBe(before);
    expect(store.getState().settingsDataState).toEqual(beforeState);
  });

  // An older build stored this flag to unlock "Don't ask again"; it unlocks nothing now.
  test('a 1.9 user who answered once sees two buttons and no opt-out', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ isTabGroupsPromptAnsweredOnce: true })
    );

    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(
      within(screen.getByRole('dialog')).getAllByRole('button')
    ).toHaveLength(2);
    expect(screen.queryByText("Don't ask again")).toBeNull();
  });

  // The shared key, as the sync dialog says it; the offer's own read "Jetzt nicht" and "後で".
  test.each([
    ['de', de, 'Nicht jetzt'],
    ['ja', ja, 'あとで'],
  ] as const)(
    "Not now reads as the sync dialog's in %s",
    async (lang, bundle, label) => {
      // After render: renderWithProviders re-inits i18n with en only.
      await renderWithProviders(<TabGroupsPermissionModal />, {
        seedStore: openWith(2),
      });
      testI18n.addResourceBundle(lang, 'translation', bundle);
      try {
        await act(async () => {
          await testI18n.changeLanguage(lang);
        });
        expect(screen.getByRole('button', { name: label })).toBeTruthy();
      } finally {
        await act(async () => {
          await testI18n.changeLanguage('en');
        });
      }
    }
  );
});

describe('TabGroupsPermissionModal permission request', () => {
  test('the CTA asks Chrome for the permission', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(
      await chrome.permissions.contains({ permissions: ['tabGroups'] })
    ).toBe(true);
  });

  // The hard constraint from KAN-11, measured against a real popup:
  // chrome.permissions.request() may never settle, and may destroy the popup
  // outright. Nothing in this handler may wait on it. requestNeverSettles
  // models exactly that -- if the close were moved into a .then/await on the
  // request, this test would hang the modal open forever.
  test('closes even when the permission request never settles', async () => {
    const { store } = await renderWithProviders(<TabGroupsPermissionModal />, {
      seed: { requestNeverSettles: true },
      seedStore: openWith(2),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
  });

  // Nothing may write a "granted" boolean into settings: the grant lives in
  // chrome.permissions and is re-read on the next mount.
  test('turning it on writes nothing to settings', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });
    const before = localStorage.getItem('settingsData');

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(localStorage.getItem('settingsData')).toBe(before);
  });
});
// KAN-501. Built like the confirm dialogs and the review prompt: their width
// and an icon-and-title row with the tab-group glyph.
describe('TabGroupsPermissionModal in the dialog family', () => {
  test('is as wide as the confirm dialogs', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });
    const dialog = document.querySelector('dialog');
    if (dialog === null) throw new Error('no dialog');
    expect(getComputedStyle(dialog).width).toBe(DIALOG.WIDTH);
  });

  test('the title carries the tab-group glyph, hidden from the name', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });
    const title = screen.getByRole('heading', {
      name: 'Tab Keeper can save tab groups',
    });
    expect(title.querySelector('.material-symbols-outlined')?.textContent).toBe(
      'tab_group'
    );
  });
});
