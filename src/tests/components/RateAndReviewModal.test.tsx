import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RateAndReviewModal } from '../../components/modals/RateAndReviewModal';
import { renderWithProviders } from '../setup/renderWithProviders';
import { classRulesFor } from '../setup/hoverRules';
import { LIGHT_THEME } from '../../hooks/useThemeColors';
import { DIALOG } from '../../styles/scale';
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
// windows: tabs.create rejects a windowId no window carries, as Chrome does.
const ACTIVE_TAB = {
  windows: [{ id: 1 }],
  tabs: [{ active: true, index: 3 }],
};

const BODY_TEXT = "If it's been useful, a review would mean a lot.";

// The RENDERED label, not the i18n key the component passes. `en` re-maps some
// of its own keys and this is one of them: the call site passes
// t('Rate this app'), which en/translation.json:89 maps to "Rate this
// extension". Written from the key, every query below misses and the CONTROL
// fails -- which reads as a broken harness rather than a broken locator.
const CTA_TEXT = 'Rate this extension';

describe('RateAndReviewModal', () => {
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
  test('"Maybe later" records the skip and closes', async () => {
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });

    await userEvent.click(screen.getByText('Maybe later'));

    expect(storedSettings().isSkippedUserReviewOnce).toBe(true);
    expect(screen.queryByText(BODY_TEXT)).toBeNull();
  });

  test('"Never remind again" opts out for good and closes', async () => {
    seedSettings({ isSkippedUserReviewOnce: true });

    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });

    await userEvent.click(screen.getByText('Never remind again'));

    expect(storedSettings().isNeverAskAgainToRate).toBe(true);
    expect(screen.queryByText(BODY_TEXT)).toBeNull();
  });
});

// KAN-501 (A1). Built like the confirm dialogs: their width, an icon-and-title
// row, and the offer's footer with the filled action on the right and a star.
describe('RateAndReviewModal in the dialog family', () => {
  const dialog = () => {
    const found = document.querySelector('dialog');
    if (found === null) throw new Error('no dialog');
    return found;
  };

  test('is as wide as the confirm dialogs', async () => {
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });
    expect(getComputedStyle(dialog()).width).toBe(DIALOG.WIDTH);
  });

  test('the title carries the thumbs-up glyph, hidden from the name', async () => {
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });
    const title = screen.getByRole('heading', { name: 'Enjoying Tab Keeper?' });
    const glyph = title.querySelector('.material-symbols-outlined');
    expect(glyph?.textContent).toBe('thumb_up');
  });

  test('Maybe later comes first, then the filled Rate button with a star', async () => {
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });
    const later = screen.getByRole('button', { name: 'Maybe later' });
    const rate = screen.getByRole('button', { name: CTA_TEXT });
    expect(
      later.compareDocumentPosition(rate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(rate.querySelector('.material-symbols-outlined')?.textContent).toBe(
      'star'
    );
    const resting = classRulesFor(rate)
      .split('\n')
      .filter((rule) => !/:(hover|active|focus)/.test(rule))
      .join('\n');
    expect(resting).toContain(
      `background-color: ${rgb(LIGHT_THEME.TEXT_COLOR)}`
    );
  });

  test('Never remind again stays a quiet line under the footer', async () => {
    seedSettings({ isSkippedUserReviewOnce: true });
    await renderWithProviders(<RateAndReviewModal />, { seedStore: openModal });
    const rate = screen.getByRole('button', { name: CTA_TEXT });
    const never = screen.getByRole('button', { name: 'Never remind again' });
    expect(
      rate.compareDocumentPosition(never) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
