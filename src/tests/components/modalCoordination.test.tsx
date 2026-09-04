import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

// Firebase is the only reason App cannot just be mounted: observeAuthState
// opens a real onAuthStateChanged subscription against a live auth object.
// Nothing in this file is about auth, so it is stubbed to a no-op. App then
// takes its localStorage branch, because isFirebaseAuthed never flips.
vi.mock('../../config/firebase', () => ({
  observeAuthState: () => {},
  signInUserAnonymously: () => {},
}));

import App from '../../App';
import { renderWithProviders } from '../setup/renderWithProviders';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const DAY = 24 * 60 * 60 * 1000;

// Two tab groups open, permission ungranted -- everything the tab-groups offer
// needs. Held constant across both tests below so the ONLY difference is
// whether the rate modal also wants the screen.
const twoGroupsUngranted = {
  tabs: [{ groupId: 11 }, { groupId: 12 }, { groupId: -1 }],
};

// KAN-74. Both modals are position:fixed at z-index 999 and both are opened
// from App's mount effect, so if they ever opened together they would stack
// with no defined winner. They cannot, and this is why: askUserToRateAndReview
// runs synchronously and hands its answer to the tab-groups check as a value.
//
// That handoff is the thing under test. The decision itself is covered in
// tabGroupsOffer.test.ts; what could still break is App passing the wrong
// argument -- a hardcoded `false` would satisfy every other test in the suite.
describe('modal coordination on popup open', () => {
  test('the rate request wins, and the tab-groups offer stands down', async () => {
    // Installed two days ago, never rated, never asked -> the rate modal fires.
    localStorage.setItem(
      'settingsData',
      JSON.stringify({ extensionInstalledTime: Date.now() - 2 * DAY })
    );

    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });

    await waitFor(() =>
      expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(true)
    );

    // The offer's own conditions are all met; only the rate modal suppresses it.
    expect(store.getState().globalState.tabGroupsPromptCount).toBeNull();
  });

  // The control. Same seed, same install age -- only the rate modal is taken
  // out of the running. Without this, the test above passes just as well
  // against an App that never opens the tab-groups offer at all.
  test('with the rate request silenced, the tab-groups offer opens', async () => {
    localStorage.setItem(
      'settingsData',
      JSON.stringify({
        extensionInstalledTime: Date.now() - 2 * DAY,
        isNeverAskAgainToRate: true,
      })
    );

    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });

    await waitFor(() =>
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
    );

    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
  });

  // A brand-new user: the rate path writes extensionInstalledTime and returns
  // without opening anything, so the tab-groups offer is free to fire on the
  // very first open. Verified against a real fresh install too.
  test('a first-run user gets the tab-groups offer, not the rate request', async () => {
    const { store } = await renderWithProviders(<App />, {
      seed: twoGroupsUngranted,
    });

    await waitFor(() =>
      expect(store.getState().globalState.tabGroupsPromptCount).toBe(2)
    );

    expect(store.getState().globalState.isRateAndReviewModalOpen).toBe(false);
  });
});
