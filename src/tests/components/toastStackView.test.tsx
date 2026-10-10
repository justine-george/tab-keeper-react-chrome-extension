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

  // role="status" is aria-atomic by default: without this, every new toast
  // would make a screen reader read the whole stack again, not only the new
  // one (settled rule A). What a screen reader does with it is a real-browser
  // claim; e2e/toast-stack.spec.ts reads Chrome's accessibility tree.
  test('the region announces each new toast alone, not the whole stack', async () => {
    await renderWithProviders(<Toast />);
    expect(region().getAttribute('aria-atomic')).toBe('false');
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

  // Each toast's hit area reaches over the 8px gap above it (e2e test 1
  // measures that), so the pointer leaving one toast for the gap lands on the
  // next toast, still inside the stack.
  test('the pointer crossing from one toast to the next is not leaving', async () => {
    const rendered = await renderWithProviders(<Toast />);
    vi.useFakeTimers();
    await show(rendered, 'One');
    await show(rendered, 'Two');
    const [one, two] = liveToasts();

    fireEvent.mouseOver(one);
    fireEvent.mouseOut(one, { relatedTarget: two });
    fireEvent.mouseOver(two, { relatedTarget: one });
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

// KAN-488. At rest the stack sits collapsed: the newest toast in front, the
// older ones peeking 8px apiece above it, narrower, their content hidden.
// Hover or focus in the stack opens it into the full layout above.
describe('the stack sits collapsed until hovered or focused (KAN-488)', () => {
  // jsdom lays nothing out: every toast is 40px, so the open places are known.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const transforms = () => liveToasts().map((el) => el.style.transform);
  const OPEN = ['translateY(-96px)', 'translateY(-48px)', 'translateY(0px)'];
  const COLLAPSED = [
    'translateY(-16px) scale(0.9)',
    'translateY(-8px) scale(0.95)',
    'translateY(0px)',
  ];
  // Whether each toast's content shows, oldest first.
  const contentShown = () =>
    liveToasts().map((el) => {
      const first = el.firstElementChild;
      if (first === null) throw new Error('a toast with no content element');
      return getComputedStyle(first).opacity !== '0';
    });

  async function three() {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, TOAST_MESSAGES.TAB_CLOSED, { reopenOfferId: 1 });
    await show(rendered, 'Two');
    await show(rendered, 'Three');
    return rendered;
  }

  test('at rest: the newest in front, the older two peek 8px and 16px above it, narrower, content hidden', async () => {
    await three();
    expect(transforms()).toEqual(COLLAPSED);
    expect(contentShown()).toEqual([false, false, true]);
    // Newest drawn over the older ones.
    const z = liveToasts().map((el) => Number(el.style.zIndex));
    expect(z[2]).toBeGreaterThan(z[1]);
    expect(z[1]).toBeGreaterThan(z[0]);
  });

  test('hovering opens it into the full stack, and leaving closes it', async () => {
    await three();
    fireEvent.mouseEnter(liveToasts()[2]);
    expect(transforms()).toEqual(OPEN);
    expect(contentShown()).toEqual([true, true, true]);

    fireEvent.mouseLeave(liveToasts()[2]);
    expect(transforms()).toEqual(COLLAPSED);
  });

  test('focus on an older toast’s Reopen opens it; focus leaving the stack closes it', async () => {
    await three();
    const reopen = within(liveToasts()[0]).getByRole('button', {
      name: 'Reopen',
    });
    act(() => reopen.focus());
    expect(transforms()).toEqual(OPEN);

    act(() => reopen.blur());
    expect(transforms()).toEqual(COLLAPSED);
  });

  test('one toast sits in place, collapsed or open', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, 'Only');
    expect(transforms()).toEqual(['translateY(0px)']);
    expect(contentShown()).toEqual([true]);
    fireEvent.mouseEnter(liveToasts()[0]);
    expect(transforms()).toEqual(['translateY(0px)']);
  });
});
