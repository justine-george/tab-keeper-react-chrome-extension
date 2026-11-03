import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import { showToast } from '../../redux/slices/globalStateSlice';
import ja from '../../../public/locales/ja/translation.json';
import ko from '../../../public/locales/ko/translation.json';
import zh from '../../../public/locales/zh/translation.json';
import { renderWithProviders } from '../setup/renderWithProviders';
import { initTestI18n, testI18n } from '../setup/i18nForTests';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-906. A save that left duplicate tabs out says how many, after its own text.

beforeEach(async () => {
  localStorage.clear();
  await initTestI18n();
});

afterEach(async () => {
  localStorage.clear();
  // The instance is shared: a leaked locale would run later tests in it.
  await testI18n.changeLanguage('en');
});

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

// Sentences ending in full-width punctuation run on with no space; others take one.
describe('the left-out sentence joins as the language writes (KAN-906)', () => {
  const cases = [
    ['zh', zh, ''],
    ['ja', ja, ''],
    ['ko', ko, ' '],
  ] as const;

  test.each(cases)('%s', async (locale, dict, gap) => {
    const { store, container } = await renderWithProviders(<Toast />);
    testI18n.addResourceBundle(locale, 'translation', dict, true, true);
    await act(async () => {
      await testI18n.changeLanguage(locale);
    });
    // CONTROL: the assertions below are in the locale, not English.
    expect(testI18n.language).toBe(locale);

    await show(store, 2);

    // From the raw JSON, never through t(): the expectation must not share the machinery.
    expect(SAVED).toBe('Current window saved as a session.');
    const saved = dict['Current window saved as a session.'];
    const sentence = dict.DuplicateTabsLeftOut_other.replace('{{count}}', '2');
    expect(container.textContent).toBe(`${saved}${gap}${sentence}`);
  });
});
