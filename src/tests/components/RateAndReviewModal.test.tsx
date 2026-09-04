import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RateAndReviewModal } from '../../components/modals/RateAndReviewModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { openRateAndReviewModal } from '../../redux/slices/globalStateSlice';
import { SettingsData } from '../../redux/slices/settingsDataStateSlice';
import {
  asPartialSettings,
  loadFromLocalStorage,
} from '../../utils/functions/local';

// KAN-75. The modal read its escalation flag straight out of localStorage, so
// these tests write it there rather than into the store. Cleared each time so
// one test's dismissal cannot reveal the permanent opt-out in the next.
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const storedSettings = () =>
  asPartialSettings<SettingsData>(loadFromLocalStorage('settingsData'));

const seedSettings = (settings: Partial<SettingsData>) =>
  localStorage.setItem('settingsData', JSON.stringify(settings));

// Opened directly and synchronously before first render -- see
// renderWithProviders' note on why seedStore must not defer.
const openModal = (store: { dispatch: (a: unknown) => void }) =>
  store.dispatch(openRateAndReviewModal());

// handleRateExtension reads `tabs[0].index` from a currentWindow query, so
// there has to be an active tab or it throws before reaching tabs.create.
const ACTIVE_TAB = { tabs: [{ active: true, index: 3 }] };

const BODY_TEXT = 'Please consider helping me out with a good review!';

// The RENDERED label, not the i18n key the component passes. `en` re-maps some
// of its own keys and this is one of them: the call site passes
// t('Rate this app'), which en/translation.json:89 maps to "Rate this
// extension". Written from the key, every query below misses and the CONTROL
// fails -- which reads as a broken harness rather than a broken locator.
const CTA_TEXT = 'Rate this extension';

describe('RateAndReviewModal', () => {
  // The control for every role assertion below. The CTA is a real Button and
  // was never affected, so it is the proof that getByRole can find
  // a button in this harness at all -- without it, a passing role query
  // elsewhere would be indistinguishable from a query that never ran.
  test('CONTROL: the primary CTA is already a real button', async () => {
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });

    expect(screen.getByRole('button', { name: CTA_TEXT })).toBeTruthy();
  });

  // Measured in a live popup on the equivalent KAN-74 modal before it was
  // fixed: rendered as a NormalLabel (a bare `<div onClick>`), the dismissal
  // reached the accessibility tree as StaticText -- a control no keyboard user
  // can reach. getByRole is the assertion that says so; getByText passes
  // against the broken markup either way, which is why the behaviour tests
  // below deliberately keep using getByText and these two carry the role
  // check on their own.
  test('"Maybe Later" is a real button, reachable by keyboard', async () => {
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });

    expect(screen.getByRole('button', { name: 'Maybe Later' })).toBeTruthy();
  });

  test('"Never Remind Again" is a real button, reachable by keyboard', async () => {
    // Earned, not offered: the permanent opt-out renders only after the user
    // has already skipped once.
    seedSettings({ isSkippedUserReviewOnce: true });

    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });

    expect(
      screen.getByRole('button', { name: 'Never Remind Again' })
    ).toBeTruthy();
  });

  // The third control the ticket did not mention. The body sentence carried
  // `onClick={handleRateExtension}` -- an invisible click target that opened
  // the Web Store, duplicating the CTA directly beneath it and equally
  // unreachable by keyboard.
  //
  // Asserted behaviourally rather than by role, because a role query cannot
  // tell the two states apart: a `<div onClick>` is not a button before the
  // fix, and a `<p>` is not a button after it, so getByRole is null either way
  // and would pass against the defect.
  test('the body sentence is not a click target', async () => {
    const { chrome } = await renderWithProviders(<RateAndReviewModal />, {
      seed: ACTIVE_TAB,
      seedStore: openModal,
    });

    await userEvent.click(screen.getByText(BODY_TEXT));

    expect(chrome.createdTabs).toEqual([]);
    // Still open: clicking body copy must not dismiss the modal either.
    expect(screen.getByText(BODY_TEXT)).toBeTruthy();
  });

  // The positive control for the assertion above. Without it, an empty
  // createdTabs proves only that nothing in this harness can ever open a tab.
  test('CONTROL: the CTA does open the review page', async () => {
    const { chrome } = await renderWithProviders(<RateAndReviewModal />, {
      seed: ACTIVE_TAB,
      seedStore: openModal,
    });

    await userEvent.click(screen.getByText(CTA_TEXT));

    expect(chrome.createdTabs).toHaveLength(1);
    expect(chrome.createdTabs[0].url).toContain('/reviews');
    // Opened next to the active tab, not appended to the end.
    expect(chrome.createdTabs[0].index).toBe(4);
  });

  // Swapping a div for a button must not change what the controls DO. These
  // drive the dismissals by text, so they pass against both markups and pin
  // the behaviour rather than the role.
  test('"Maybe Later" records the skip and closes', async () => {
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });

    await userEvent.click(screen.getByText('Maybe Later'));

    expect(storedSettings().isSkippedUserReviewOnce).toBe(true);
    expect(screen.queryByText(BODY_TEXT)).toBeNull();
  });

  test('"Never Remind Again" opts out for good and closes', async () => {
    seedSettings({ isSkippedUserReviewOnce: true });

    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });

    await userEvent.click(screen.getByText('Never Remind Again'));

    expect(storedSettings().isNeverAskAgainToRate).toBe(true);
    expect(screen.queryByText(BODY_TEXT)).toBeNull();
  });
});
