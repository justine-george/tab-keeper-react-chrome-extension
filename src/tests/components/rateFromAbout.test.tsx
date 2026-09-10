import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import SettingsDetailsContainer from '../../components/settings/rightpane/SettingsDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  SettingsCategory,
  selectCategory,
} from '../../redux/slices/settingsCategoryStateSlice';
import { shouldAskForReview } from '../../utils/functions/reviewAsk';

// KAN-149. Rating from the About screen has to stop the prompt, the same way
// rating from the modal always has.
//
// The modal's CTA has dispatched setUserRatedAndReviewed since it shipped; this
// button only opened the store URL and recorded nothing, so a user who rated
// here kept being asked by the modal afterwards -- asked to do a thing they had
// already done, by an app that had watched them do it.
//
// It records INTENT, not a confirmed review: the Web Store reports nothing back
// about what happens once the tab opens, so a click is the only evidence there
// is. Someone who clicks and never reviews is never asked again, which is the
// right way round -- pestering someone who already went is worse than missing a
// review that was never owed.

beforeEach(() => localStorage.clear());

// Restored here rather than at the end of each test. An inline mockRestore is
// skipped when the assertion above it throws, and vi.spyOn on an
// already-spied function hands back the SAME mock -- so one failing test made
// the next one see its predecessor's call and fail for a reason that had
// nothing to do with the code. Found while mutation-testing this very file.
afterEach(() => vi.restoreAllMocks());

const spyOnOpen = () => vi.spyOn(window, 'open').mockImplementation(() => null);

const renderAbout = () =>
  renderWithProviders(<SettingsDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(selectCategory(SettingsCategory.ABOUT));
    },
  });

const rateButton = () =>
  screen.getByRole('button', { name: /Rate this extension/i });

describe('rating from the About screen', () => {
  test('records that the user has rated', async () => {
    spyOnOpen();
    const { store } = await renderAbout();
    expect(store.getState().settingsDataState.isUserRatedAndReviewed).toBe(
      false
    );

    fireEvent.click(rateButton());

    expect(store.getState().settingsDataState.isUserRatedAndReviewed).toBe(
      true
    );
  });

  test('still opens the store reviews page', async () => {
    const openSpy = spyOnOpen();
    await renderAbout();

    fireEvent.click(rateButton());

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toContain(
      'chromewebstore.google.com'
    );
    expect(String(openSpy.mock.calls[0][0])).toContain('/reviews');
  });

  // The consequence, asserted through the gate rather than the flag, because
  // the flag is only worth writing if the prompt actually reads it. A value
  // moment is present, so this would ask were it not for the rating.
  test('and the review prompt goes quiet afterwards', async () => {
    spyOnOpen();
    const { store } = await renderAbout();
    const now = Date.now();

    // The control: before the click, this user WOULD be asked.
    expect(
      shouldAskForReview(
        { ...store.getState().settingsDataState, lastValueMomentTime: now - 1 },
        now
      )
    ).toBe(true);

    fireEvent.click(rateButton());

    expect(
      shouldAskForReview(
        { ...store.getState().settingsDataState, lastValueMomentTime: now - 1 },
        now
      )
    ).toBe(false);
  });
});
