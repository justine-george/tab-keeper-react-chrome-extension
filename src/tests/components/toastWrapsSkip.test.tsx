import { beforeEach, describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import { showToast } from '../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { initTestI18n } from '../setup/i18nForTests';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-280 Part F (Review Focus 4, Justine's pick A). The skip toast's count comes after the session's name, which can
// be long: its message wraps to a second line rather than being cut. Every other toast keeps one cut line.
const TITLE = 'Weekend trip planning: Kyoto and Osaka 26';

beforeEach(async () => {
  await initTestI18n();
});

async function messageOf(
  toastText: string,
  params: Record<string, string | number>
) {
  const { store } = await renderWithProviders(<Toast />);
  await act(async () => {
    await store.dispatch(
      showToast({
        toastText,
        toastParams: params,
        announcesSavedChange: true,
        show: { tabGroupId: 'S2' },
      })
    );
  });
  const message = (await screen.findByText(new RegExp(TITLE))).closest('span');
  if (message === null) throw new Error('no message');
  return getComputedStyle(message);
}

describe('the skip toast wraps (KAN-280 Part F)', () => {
  test('"Copied to … N tabs were already there." wraps, uncut', async () => {
    const style = await messageOf(TOAST_MESSAGES.COPIED_TO_SESSION_SKIPPED, {
      title: TITLE,
      count: 3,
    });
    expect(style.whiteSpace).not.toBe('nowrap');
    expect(style.textOverflow).not.toBe('ellipsis');
  });

  test('CONTROL: "Copied to …" with the same Show chip stays one cut line', async () => {
    const style = await messageOf(TOAST_MESSAGES.COPIED_TO_SESSION, {
      title: TITLE,
    });
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
  });
});
