import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import HeroContainerLeft from '../../components/home/leftpane/HeroContainerLeft';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  installFakeAudio,
  startedTicks,
  uninstallFakeAudio,
} from '../setup/audioFake';

// jsdom has no Web Animations: a fake records each run and the test finishes it.

interface Run {
  target: Element;
  keyframes: unknown;
  options: unknown;
  cancel: ReturnType<typeof vi.fn>;
  release: () => void;
}
let runs: Run[] = [];

function installAnimate(): void {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, keyframes: unknown, options: unknown) {
      let release: () => void = () => undefined;
      const finished = new Promise<unknown>((resolve) => {
        release = () => resolve(undefined);
      });
      const cancel = vi.fn(() => release());
      runs.push({ target: this, keyframes, options, cancel, release });
      return { finished, cancel };
    },
  });
}

const setup = async () => {
  const { container, unmount } = await renderWithProviders(
    <HeroContainerLeft />
  );
  const mark = container.querySelector('svg');
  if (mark === null) throw new Error('no mark rendered');
  const shutter = mark.querySelector('[data-mark-part="shutter"]');
  if (shutter === null) throw new Error('no shutter rendered');
  return { mark, shutter, unmount };
};
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  runs = [];
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  uninstallFakeAudio();
  vi.restoreAllMocks();
});
const reduceMotion = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query: string) =>
        new FakeMediaQueryList(
          query,
          query === '(prefers-reduced-motion: reduce)'
        )
    );
// One shutter click: two ticks, 35ms apart.
const ONE_CLICK = [2, expect.closeTo(2.035, 6)];

describe('clicking the header mark', () => {
  test('presses the mark, and slides the shutter open and back 60ms behind it', async () => {
    installAnimate();
    const { mark, shutter } = await setup();
    fireEvent.click(mark);

    expect(runs.map((r) => r.target)).toEqual([mark, shutter]);
    expect(runs[0].keyframes).toEqual([
      { transform: 'scale(1)' },
      { transform: 'scale(0.92)' },
      { transform: 'scale(1)' },
    ]);
    expect(runs[0].options).toEqual({ duration: 150, easing: 'ease-out' });
    expect(runs[1].keyframes).toEqual([
      { transform: 'translateX(0)' },
      { transform: 'translateX(-36px)', offset: 0.45 },
      { transform: 'translateX(-36px)', offset: 0.55 },
      { transform: 'translateX(0)' },
    ]);
    expect(runs[1].options).toEqual({
      duration: 300,
      delay: 60,
      easing: 'ease-in-out',
    });
  });

  test('a click while it plays starts nothing; after it ends, a click plays again', async () => {
    installAnimate();
    const { mark } = await setup();
    fireEvent.click(mark);
    fireEvent.click(mark);
    expect(runs).toHaveLength(2);

    runs.forEach((r) => r.release());
    await settle();
    fireEvent.click(mark);
    expect(runs).toHaveLength(4);
  });

  test('reduced motion starts nothing', async () => {
    installAnimate();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        new FakeMediaQueryList(
          query,
          query === '(prefers-reduced-motion: reduce)'
        )
    );
    const { mark } = await setup();
    fireEvent.click(mark);

    expect(runs).toHaveLength(0);
  });

  test('without Web Animations a click is harmless', async () => {
    // React reports a throwing handler as a window error, not to fireEvent.
    const errors: unknown[] = [];
    const record = (event: ErrorEvent) => {
      event.preventDefault();
      errors.push(event.error);
    };
    window.addEventListener('error', record);
    const { mark } = await setup();
    fireEvent.click(mark);
    window.removeEventListener('error', record);

    expect(errors).toEqual([]);
  });

  test('leaving while it plays cancels both animations', async () => {
    installAnimate();
    const { mark, unmount } = await setup();
    fireEvent.click(mark);
    expect(runs).toHaveLength(2);
    unmount();

    expect(runs.map((r) => r.cancel.mock.calls.length)).toEqual([1, 1]);
  });

  test('the mark stays decorative: hidden, no role, no tab stop', async () => {
    installAnimate();
    const { mark } = await setup();

    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.hasAttribute('role')).toBe(false);
    expect(mark.hasAttribute('tabindex')).toBe(false);
    for (let el: Element | null = mark; el !== null; el = el.parentElement) {
      expect(el.hasAttribute('role')).toBe(false);
      expect(el.hasAttribute('tabindex')).toBe(false);
    }
  });

  // KAN-521. The click belongs to the shutter shutting, as on Get started (KAN-513).
  test('the click sounds once, as the shutter shuts: not at the press, nor while it slides', async () => {
    installAnimate();
    installFakeAudio();
    const { mark } = await setup();
    fireEvent.click(mark);
    expect(startedTicks()).toEqual([]);
    runs[0].release();
    await settle();
    expect(startedTicks()).toEqual([]);
    runs[1].release();
    await settle();
    expect(startedTicks()).toEqual(ONE_CLICK);
  });

  test('a click cut short before the shutter shuts is silent', async () => {
    installAnimate();
    installFakeAudio();
    const { mark, unmount } = await setup();
    fireEvent.click(mark);
    unmount();
    await settle();
    expect(startedTicks()).toEqual([]);
  });

  test('reduced motion draws nothing, and the click sounds at the press', async () => {
    installAnimate();
    installFakeAudio();
    reduceMotion();
    const { mark } = await setup();
    fireEvent.click(mark);
    expect(runs).toHaveLength(0);
    expect(startedTicks()).toEqual(ONE_CLICK);
  });

  test('without Web Animations the click sounds at the press', async () => {
    installFakeAudio();
    const { mark } = await setup();
    fireEvent.click(mark);
    expect(startedTicks()).toEqual(ONE_CLICK);
  });
});

// KAN-524. Clickable, so it shows a pointer, as every clickable thing here does (cursor-affordance.spec.ts).
test('the mark’s box shows a pointer', async () => {
  const { mark } = await setup();
  expect(getComputedStyle(mark.parentElement!).cursor).toBe('pointer');
});
