import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TabGroupsPermissionModal } from '../../components/modals/TabGroupsPermissionModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openTabGroupsPrompt } from '../../redux/slices/globalStateSlice';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { DIALOG } from '../../styles/scale';
import { SettingsData } from '../../redux/slices/settingsDataStateSlice';
import {
  asPartialSettings,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// The modal reads its escalation flag straight out of localStorage (as
// showReviewCard does), so these tests write it there rather than into the
// store. Cleared each time so one test's dismissal cannot reveal the permanent
// opt-out in the next.
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const storedSettings = () =>
  asPartialSettings<SettingsData>(loadFromLocalStorage('settingsData'));

const seedSettings = (settings: Partial<SettingsData>) =>
  localStorage.setItem('settingsData', JSON.stringify(settings));

// The prompt is opened by App.tsx in production. Here it is opened directly,
// synchronously, before first render -- see renderWithProviders' note on why
// seedStore must not defer.
const openWith =
  (count: number) => (store: { dispatch: (a: unknown) => void }) =>
    store.dispatch(openTabGroupsPrompt(count));

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

describe('TabGroupsPermissionModal', () => {
  test('renders nothing when no prompt is open', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />);

    expect(screen.queryByText('Tab Keeper can save tab groups')).toBeNull();
  });

  test('the footer is Not now on the left and a filled Turn on on the right', async () => {
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

describe('TabGroupsPermissionModal escalation', () => {
  // The escape hatch is EARNED, not offered. A user seeing this for the first
  // time gets two choices; only one who has already declined once gets the
  // permanent opt-out.
  test('the permanent opt-out is absent on a first showing', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(screen.queryByText("Don't ask again")).toBeNull();
  });

  // Measured in a live popup before this was fixed: rendered as a NormalLabel
  // (a bare `<div onClick>`), "Not now" reached the accessibility tree as
  // StaticText -- a control a keyboard user cannot reach at all. getByRole is
  // the assertion that says so; getByText passes either way, which is why the
  // clicks below are deliberately left on getByText and this test carries the
  // role check on its own.
  test('both dismissals are real buttons, reachable by keyboard', async () => {
    seedSettings({ isTabGroupsPromptAnsweredOnce: true });

    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: "Don't ask again" })
    ).toBeTruthy();
  });

  test('"Not now" records the dismissal and closes, without opting out for good', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    await userEvent.click(screen.getByText('Not now'));

    expect(storedSettings().isTabGroupsPromptAnsweredOnce).toBe(true);
    // The whole point of "later means later": declining once must NOT set the
    // flag that stops the offer permanently.
    expect(storedSettings().isNeverAskAgainForTabGroups ?? false).toBe(false);
  });

  test('"Don\'t ask again" opts out for good', async () => {
    seedSettings({ isTabGroupsPromptAnsweredOnce: true });

    const { store } = await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    await userEvent.click(screen.getByText("Don't ask again"));

    expect(storedSettings().isNeverAskAgainForTabGroups).toBe(true);
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
  });
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

  // Nothing may write a "granted" boolean into settings. The grant lives in
  // chrome.permissions and is re-read on the next mount; a persisted mirror
  // would disagree with reality the moment the user revoked it. The answered
  // flag is the one write allowed: it records that the offer was put to the
  // user, which is true whatever they then told Chrome.
  test('turning it on persists no grant flag of its own', async () => {
    const { store } = await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });
    const before = store.getState().settingsDataState;

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(storedSettings()).toEqual({
      ...before,
      isTabGroupsPromptAnsweredOnce: true,
    });
  });

  // The deny dead end, found by pressing Deny on a real Chrome prompt.
  //
  // The CTA is the ONLY route to a native denial, and a denial is invisible to
  // this popup (permissions.request() may never settle, and may destroy the
  // popup outright). So if clicking the CTA recorded nothing, a user who
  // answered Enable -> Deny every time would never unlock "Don't ask again":
  // an unbounded prompt with no escape hatch. Taking the CTA has to count as
  // having been asked.
  test('the CTA unlocks the opt-out, so an Enable-then-Deny user is not trapped', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(screen.queryByText("Don't ask again")).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    // Chrome's answer never reaches us, so the flag is what the NEXT popup
    // reads to decide whether the escape hatch has been earned.
    expect(storedSettings().isTabGroupsPromptAnsweredOnce).toBe(true);
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
