import { beforeEach, describe, expect, test } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import { showToast } from '../../redux/slices/globalStateSlice';
import { toastTexts } from '../setup/toasts';
import { initTestI18n } from '../setup/i18nForTests';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-980. Each toast's corner × closes that toast only; so does Escape in a
// focused toast. A keyboard close hands focus to the next front toast's ×.
// Showing the × on hover or focus is CSS: e2e/toast-close.spec.ts.

type Rendered = Awaited<ReturnType<typeof renderWithProviders>>;

beforeEach(async () => {
  await initTestI18n();
});

const region = () => screen.getByRole('status');
const liveToasts = (): HTMLElement[] =>
  Array.from(region().children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.getAttribute('aria-hidden') !== 'true'
  );
const closeIn = (toast: HTMLElement) =>
  within(toast).getByRole('button', { name: 'Close' });

async function show(
  { store }: Rendered,
  toastText: string,
  extra: { show?: { tabGroupId: string } } = {}
) {
  await act(async () => {
    await store.dispatch(showToast({ toastText, ...extra }));
  });
}

async function threeToasts(): Promise<Rendered> {
  const rendered = await renderWithProviders(<Toast />);
  await show(rendered, 'One');
  await show(rendered, 'Two');
  await show(rendered, 'Three');
  return rendered;
}

describe('closing a toast by hand (KAN-980)', () => {
  test('every toast has its own Close button', async () => {
    await threeToasts();
    expect(liveToasts().map((t) => closeIn(t))).toHaveLength(3);
  });

  test('a click on a toast’s × closes that toast only', async () => {
    const rendered = await threeToasts();
    act(() => {
      fireEvent.click(closeIn(liveToasts()[1]), { detail: 1 });
    });
    expect(toastTexts(rendered.store.getState())).toEqual(['One', 'Three']);
  });

  test('a click leaves focus where the pointer put it, not on the next ×', async () => {
    await threeToasts();
    act(() => {
      fireEvent.click(closeIn(liveToasts()[2]), { detail: 1 });
    });
    expect(document.activeElement).toBe(document.body);
  });

  test('Enter on the front ×: it closes, and focus goes to the next front toast’s ×', async () => {
    const rendered = await threeToasts();
    const front = closeIn(liveToasts()[2]);
    front.focus();
    act(() => {
      fireEvent.keyDown(front, { key: 'Enter' });
    });
    expect(toastTexts(rendered.store.getState())).toEqual(['One', 'Two']);
    expect(document.activeElement).toBe(closeIn(liveToasts()[1]));
  });

  test('Enter on an older ×: focus goes to the front toast’s ×', async () => {
    const rendered = await threeToasts();
    const oldest = closeIn(liveToasts()[0]);
    oldest.focus();
    act(() => {
      fireEvent.keyDown(oldest, { key: 'Enter' });
    });
    expect(toastTexts(rendered.store.getState())).toEqual(['Two', 'Three']);
    expect(document.activeElement).toBe(closeIn(liveToasts()[1]));
  });

  test('Enter on the last toast’s ×: it closes and focus goes nowhere', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, 'Only');
    const only = closeIn(liveToasts()[0]);
    only.focus();
    act(() => {
      fireEvent.keyDown(only, { key: 'Enter' });
    });
    expect(toastTexts(rendered.store.getState())).toEqual([]);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('Escape in a focused toast (KAN-980)', () => {
  test('on a chip: closes that toast, is claimed, and focus goes to the next ×', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, 'One');
    await show(rendered, 'Two', { show: { tabGroupId: 'g1' } });
    const chip = within(liveToasts()[1]).getByRole('button', { name: 'Show' });
    chip.focus();
    let claimed = false;
    act(() => {
      claimed = !fireEvent.keyDown(chip, { key: 'Escape' });
    });
    // A claimed Escape is what keeps Chrome's popup open (KAN-426).
    expect(claimed).toBe(true);
    expect(toastTexts(rendered.store.getState())).toEqual(['One']);
    expect(document.activeElement).toBe(closeIn(liveToasts()[0]));
  });

  // The positive case the three controls below are measured against.
  test('on a plain toast’s ×: closes that toast, and focus goes to the next ×', async () => {
    const rendered = await threeToasts();
    const front = closeIn(liveToasts()[2]);
    front.focus();
    let claimed = false;
    act(() => {
      claimed = !fireEvent.keyDown(front, { key: 'Escape' });
    });
    expect(claimed).toBe(true);
    expect(toastTexts(rendered.store.getState())).toEqual(['One', 'Two']);
    expect(document.activeElement).toBe(closeIn(liveToasts()[1]));
  });

  test('an Escape another control already claimed is left alone', async () => {
    const rendered = await threeToasts();
    const front = closeIn(liveToasts()[2]);
    front.focus();
    front.addEventListener('keydown', (e) => e.preventDefault(), {
      once: true,
    });
    act(() => {
      fireEvent.keyDown(front, { key: 'Escape' });
    });
    expect(toastTexts(rendered.store.getState())).toEqual([
      'One',
      'Two',
      'Three',
    ]);
  });

  test('an Escape ending IME composition is left alone', async () => {
    const rendered = await threeToasts();
    const front = closeIn(liveToasts()[2]);
    front.focus();
    act(() => {
      fireEvent.keyDown(front, { key: 'Escape', isComposing: true });
    });
    expect(toastTexts(rendered.store.getState())).toHaveLength(3);
  });

  test('other keys close nothing', async () => {
    const rendered = await threeToasts();
    const front = closeIn(liveToasts()[2]);
    front.focus();
    act(() => {
      fireEvent.keyDown(front, { key: 'Tab' });
      fireEvent.keyDown(front, { key: 'a' });
    });
    expect(toastTexts(rendered.store.getState())).toHaveLength(3);
  });
});
