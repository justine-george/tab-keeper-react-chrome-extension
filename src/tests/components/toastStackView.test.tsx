import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import {
  closeOfferToast,
  closePlainToasts,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { toastTexts } from '../setup/toasts';
import { initTestI18n } from '../setup/i18nForTests';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-349. The stack on screen: every toast in full, newest at the bottom,
// in the one live region that was there before any of them (KAN-280 O8a).
// Geometry and motion need a real layout; they are measured in
// e2e/toast-stack.spec.ts. This pins what jsdom can see.

type Rendered = Awaited<ReturnType<typeof renderWithProviders>>;

beforeEach(async () => {
  await initTestI18n();
});

afterEach(() => {
  vi.useRealTimers();
});

const region = () => screen.getByRole('status');

// The toasts a screen reader and a pointer can reach, oldest first.
const liveToasts = (): HTMLElement[] =>
  Array.from(region().children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.getAttribute('aria-hidden') !== 'true'
  );

const liveTexts = () => liveToasts().map((el) => el.textContent);

async function show(
  { store }: Rendered,
  toastText: string,
  extra: { reopenOfferId?: number; announcesSavedChange?: boolean } = {}
) {
  await act(async () => {
    await store.dispatch(showToast({ toastText, ...extra }));
  });
}

describe('the stack on screen (KAN-349)', () => {
  test('three toasts sit newest last, in the region that was already there', async () => {
    const rendered = await renderWithProviders(<Toast />);
    const before = region();

    await show(rendered, 'One');
    await show(rendered, 'Two');
    await show(rendered, 'Three');

    expect(region()).toBe(before);
    expect(liveTexts()).toEqual(['One', 'Two', 'Three']);
  });

  test('hovering the oldest toast holds all three (T3)', async () => {
    const rendered = await renderWithProviders(<Toast />);
    vi.useFakeTimers();
    await show(rendered, 'One');
    await show(rendered, 'Two');
    await show(rendered, 'Three');

    fireEvent.mouseEnter(liveToasts()[0]);
    act(() => vi.advanceTimersByTime(30_000));
    expect(toastTexts(rendered.store.getState())).toEqual([
      'One',
      'Two',
      'Three',
    ]);

    // CONTROL: the pointer leaving the stack lets them go.
    fireEvent.mouseLeave(liveToasts()[0]);
    act(() => vi.advanceTimersByTime(5000));
    expect(toastTexts(rendered.store.getState())).toEqual([]);
  });

  // The region is sized to cover the stack, so the 8px gap between two toasts
  // is the region itself: a pointer crossing it has not left the stack.
  test('the pointer in the gap between two toasts is still on the stack', async () => {
    const rendered = await renderWithProviders(<Toast />);
    vi.useFakeTimers();
    await show(rendered, 'One');
    await show(rendered, 'Two');
    const [one] = liveToasts();

    fireEvent.mouseOver(one);
    fireEvent.mouseOut(one, { relatedTarget: region() });
    act(() => vi.advanceTimersByTime(30_000));

    expect(toastTexts(rendered.store.getState())).toEqual(['One', 'Two']);
  });

  test('a leaving toast fades out hidden from screen readers, then goes', async () => {
    const rendered = await renderWithProviders(<Toast />);
    vi.useFakeTimers();
    await show(rendered, 'One');
    await show(rendered, 'Two');

    act(() => {
      rendered.store.dispatch(closePlainToasts());
    });

    // Still drawn, fading, but not reachable.
    expect(region().textContent).toContain('One');
    expect(liveTexts()).toEqual([]);

    act(() => vi.advanceTimersByTime(159));
    expect(region().textContent).toContain('One');
    act(() => vi.advanceTimersByTime(1));
    expect(region().textContent).toBe('');
  });

  test('a new close takes the old offer’s place (T4)', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, TOAST_MESSAGES.TAB_CLOSED, { reopenOfferId: 1 });
    await show(rendered, 'Links copied');
    await show(rendered, 'Window closed', { reopenOfferId: 2 });

    expect(liveTexts()[0]).toContain('Window closed');
    expect(liveTexts()[1]).toBe('Links copied');
  });

  test('focus in a toast that leaves does not hold the rest', async () => {
    const rendered = await renderWithProviders(<Toast />);
    vi.useFakeTimers();
    await show(rendered, TOAST_MESSAGES.TAB_CLOSED, { reopenOfferId: 1 });
    await show(rendered, 'Links copied');
    const button = within(liveToasts()[0]).getByRole('button', {
      name: 'Reopen',
    });
    act(() => button.focus());

    act(() => {
      rendered.store.dispatch(closeOfferToast(1));
    });
    act(() => vi.advanceTimersByTime(5000));

    expect(toastTexts(rendered.store.getState())).toEqual([]);
  });
});

describe('the Reopen hint follows the key (Q1 C′)', () => {
  const reopenButton = () => screen.getByRole('button', { name: 'Reopen' });

  test('a sync toast below the offer leaves its hint', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, TOAST_MESSAGES.TAB_CLOSED, { reopenOfferId: 1 });
    await show(rendered, TOAST_MESSAGES.SYNC_MERGED);

    expect(reopenButton().getAttribute('aria-keyshortcuts')).not.toBeNull();
  });

  test('a saved change below the offer takes its hint away', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, TOAST_MESSAGES.TAB_CLOSED, { reopenOfferId: 1 });
    // CONTROL: the hint reads here, so its absence below is not a blind read.
    expect(reopenButton().getAttribute('aria-keyshortcuts')).not.toBeNull();

    await show(rendered, TOAST_MESSAGES.DELETE_TAB_SUCCESS, {
      announcesSavedChange: true,
    });

    expect(reopenButton().getAttribute('aria-keyshortcuts')).toBeNull();
  });
});
