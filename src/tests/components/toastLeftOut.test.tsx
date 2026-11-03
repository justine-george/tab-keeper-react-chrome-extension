import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import { showToast } from '../../redux/slices/globalStateSlice';
import { renderWithProviders } from '../setup/renderWithProviders';
import { initTestI18n } from '../setup/i18nForTests';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-906. A save that left duplicate tabs out says how many, after its own text.

beforeEach(async () => {
  localStorage.clear();
  await initTestI18n();
});

afterEach(() => localStorage.clear());

const SAVED = TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS;

const show = async (
  store: Awaited<ReturnType<typeof renderWithProviders>>['store'],
  leftOut?: number
) =>
  act(async () => {
    await store.dispatch(
      showToast({
        toastText: SAVED,
        announcesSavedChange: true,
        ...(leftOut === undefined ? {} : { leftOut }),
      })
    );
  });

describe('the left-out sentence on a toast (KAN-906)', () => {
  test('two left out: the plural sentence follows the text', async () => {
    const { store } = await renderWithProviders(<Toast />);
    await show(store, 2);
    expect(
      screen.getByText(`${SAVED} 2 duplicate tabs left out.`)
    ).toBeTruthy();
  });

  test('one left out: the singular sentence', async () => {
    const { store } = await renderWithProviders(<Toast />);
    await show(store, 1);
    expect(screen.getByText(`${SAVED} 1 duplicate tab left out.`)).toBeTruthy();
  });

  test('none left out, or no count: the text alone', async () => {
    const { store } = await renderWithProviders(<Toast />);
    await show(store, 0);
    await show(store);
    expect(screen.getAllByText(SAVED)).toHaveLength(2);
    expect(screen.queryByText(/left out/)).toBeNull();
  });
});
