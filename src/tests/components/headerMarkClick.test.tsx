import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import HeroContainerLeft from '../../components/home/leftpane/HeroContainerLeft';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// jsdom has no Web Animations: a fake records each run and the test finishes it.

interface Run {
  target: Element;
  keyframes: unknown;
  options: unknown;
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
      runs.push({ target: this, keyframes, options, release });
      return { finished, cancel: () => release() };
    },
  });
}

const setup = async () => {
  const { container } = await renderWithProviders(<HeroContainerLeft />);
  const mark = container.querySelector('svg');
  if (mark === null) throw new Error('no mark rendered');
  const shutter = mark.querySelector('[data-mark-part="shutter"]');
  if (shutter === null) throw new Error('no shutter rendered');
  return { mark, shutter };
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
  vi.restoreAllMocks();
});

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
    const { mark } = await setup();
    expect(() => fireEvent.click(mark)).not.toThrow();
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
});
