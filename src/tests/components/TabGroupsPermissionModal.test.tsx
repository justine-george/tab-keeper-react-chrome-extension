import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TabGroupsPermissionModal } from '../../components/modals/TabGroupsPermissionModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openTabGroupsPrompt } from '../../redux/slices/globalStateSlice';
import { SettingsData } from '../../redux/slices/settingsDataStateSlice';
import {
  asPartialSettings,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// The modal reads its escalation flag straight out of localStorage (as
// RateAndReviewModal does), so these tests write it there rather than into the
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

describe('TabGroupsPermissionModal', () => {
  test('renders nothing when no prompt is open', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />);

    expect(screen.queryByText('Save your tab groups')).toBeNull();
  });

  test('renders the offer when a prompt is open', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(screen.getByText('Save your tab groups')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Enable tab group support' })
    ).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  test('one group reads as singular, with no count in the sentence', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(1),
    });

    expect(
      screen.getByText(
        "Tab Keeper can't save the name and colour of your tab group without permission."
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
        "Tab Keeper can't save the names and colours of your 3 tab groups without permission."
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

  test('the permanent opt-out appears once the user has declined before', async () => {
    seedSettings({ isTabGroupsPromptAnsweredOnce: true });

    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(screen.getByText("Don't ask again")).toBeTruthy();
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

    await userEvent.click(
      screen.getByRole('button', { name: 'Enable tab group support' })
    );

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

    await userEvent.click(
      screen.getByRole('button', { name: 'Enable tab group support' })
    );

    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
  });

  // Control for the test above: with a request that DOES settle the modal also
  // closes, so the assertion there is about not waiting, not about closing.
  test('closes when the permission request settles normally', async () => {
    const { store } = await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Enable tab group support' })
    );

    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
  });

  // Nothing may write a "granted" boolean into settings. The grant lives in
  // chrome.permissions and is re-read on the next mount; a persisted mirror
  // would disagree with reality the moment the user revoked it. Note this
  // asserts on the OPT-OUT flag only: the answered flag below is deliberately
  // set here, and is not a grant mirror -- it records that the offer was put
  // to the user, which is true whatever they then told Chrome.
  test('turning it on persists no grant flag of its own', async () => {
    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Enable tab group support' })
    );

    expect(storedSettings().isNeverAskAgainForTabGroups ?? false).toBe(false);
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

    await userEvent.click(
      screen.getByRole('button', { name: 'Enable tab group support' })
    );

    // Chrome's answer never reaches us, so the flag is what the NEXT popup
    // reads to decide whether the escape hatch has been earned.
    expect(storedSettings().isTabGroupsPromptAnsweredOnce).toBe(true);
  });

  // Control for the test above: the flag alone is not enough to show the
  // opt-out -- it has to actually reach the render on the next showing.
  test('a user who answered once sees the opt-out on the next showing', async () => {
    seedSettings({ isTabGroupsPromptAnsweredOnce: true });

    await renderWithProviders(<TabGroupsPermissionModal />, {
      seedStore: openWith(2),
    });

    expect(
      screen.getByRole('button', { name: "Don't ask again" })
    ).toBeTruthy();
  });
});
