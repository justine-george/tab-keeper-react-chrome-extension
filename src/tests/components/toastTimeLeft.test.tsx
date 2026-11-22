import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import { ToastTimeLeft } from '../../components/common/ToastTimeLeft';
import { showToast } from '../../redux/slices/globalStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import { holdToasts, releaseToasts } from '../../redux/toastTimers';
import { initTestI18n } from '../setup/i18nForTests';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-979. The line along a toast's bottom edge is as long as the share of the
// toast's own time still left, read from its timer every frame. Layout, the
// folded stack and reduced motion need a real page: e2e/toast-time-left.spec.ts.

type Rendered = Awaited<ReturnType<typeof renderWithProviders>>;

beforeEach(async () => {
  await initTestI18n();
  // The line is drawn on animation frames, so they run on the fake clock too.
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const liveToasts = (): HTMLElement[] =>
  Array.from(screen.getByRole('status').children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.getAttribute('aria-hidden') !== 'true'
  );

// The moving bar inside a toast's time-left line.
const bar = (toast: HTMLElement): HTMLElement => {
  const el = toast.querySelector<HTMLElement>('[data-time-left] > span');
  if (el === null) throw new Error('no time-left line');
  return el;
};

// The share of its time a toast's line shows as left.
const drawn = (line: HTMLElement): number => {
  const match = /^scaleX\(([\d.]+)\)$/.exec(line.style.transform);
  if (match === null) throw new Error(`not drawn: ${line.style.transform}`);
  return Number(match[1]);
};

async function show(
  { store }: Rendered,
  toastText: string,
  offersUndo = false
) {
  await act(async () => {
    await store.dispatch(showToast({ toastText, offersUndo }));
  });
}

describe('the time-left line (KAN-979)', () => {
  test("each toast's line shrinks over its own length", async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, 'Plain');
    await show(rendered, 'Session deleted.', true);
    const [plain, undo] = liveToasts();
    expect(drawn(bar(plain))).toBe(1);
    expect(bar(undo).parentElement?.getAttribute('aria-hidden')).toBe('true');

    act(() => vi.advanceTimersByTime(2000));
    // 2s of 5s, and of 8s; a frame (16ms) either side.
    expect(drawn(bar(plain))).toBeCloseTo(0.6, 2);
    expect(drawn(bar(undo))).toBeCloseTo(0.75, 2);
  });

  test('stands still while held and carries on after', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, 'Plain');
    act(() => vi.advanceTimersByTime(1000));
    act(() => holdToasts());
    // The next frame draws the held length.
    act(() => vi.advanceTimersByTime(16));
    const held = drawn(bar(liveToasts()[0]));
    act(() => vi.advanceTimersByTime(3000));
    expect(drawn(bar(liveToasts()[0]))).toBe(held);
    act(() => releaseToasts());
    act(() => vi.advanceTimersByTime(1000));
    expect(drawn(bar(liveToasts()[0]))).toBeCloseTo(held - 0.2, 2);
  });

  test('a toast losing its Undo keeps the same line, so it carries on', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, 'Session deleted.', true);
    act(() => vi.advanceTimersByTime(2000));
    const before = bar(liveToasts()[0]);

    // A new undo step (here a reset history) takes the button off; the toast
    // is then drawn by the plain branch, with its line in the same place.
    act(() => {
      rendered.store.dispatch(
        resetHistory({
          tabContainerDataState:
            rendered.store.getState().tabContainerDataState,
        })
      );
    });
    const older = liveToasts()[0];
    expect(older.querySelector('button')).toBeNull();
    expect(bar(older)).toBe(before);
  });

  test('a line drawn after the toast has run starts part-way in', async () => {
    const rendered = await renderWithProviders(<Toast />);
    await show(rendered, 'Session deleted.', true);
    const id = rendered.store.getState().globalState.toasts[0].id;
    act(() => vi.advanceTimersByTime(2000));

    const late = await renderWithProviders(<ToastTimeLeft id={id} />);
    const line = late.container.querySelector<HTMLElement>(
      '[data-time-left] > span'
    );
    if (!line) throw new Error('no time-left line');
    expect(drawn(line)).toBeCloseTo(0.75, 2);
  });
});

test('draws nothing for a toast with no timer', async () => {
  const { container } = await renderWithProviders(
    <ToastTimeLeft id={424242} />
  );
  expect(container.innerHTML).toBe('');
});
