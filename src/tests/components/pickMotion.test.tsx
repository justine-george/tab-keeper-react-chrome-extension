import { afterEach, describe, expect, test, vi } from 'vitest';

import { pickTheme } from '../../components/settings/rightpane/pickMotion';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-1024. A theme pick runs inside a view transition that pictures the whole
// page, flagged on <html> while it runs. Instant where there is no API, or the
// user asked for reduced motion. jsdom has no view transitions: this fakes the
// one method the module reads.

const root = document.documentElement;
const flagged = () => root.hasAttribute('data-page-fade');

function fakeTransitions() {
  const runs: { callback: () => void; finish: () => void }[] = [];
  const start = vi.fn((callback?: () => void | Promise<void>) => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    runs.push({ callback: () => void callback?.(), finish });
    return {
      finished,
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      skipTransition: () => finish(),
    };
  });
  document.startViewTransition = start;
  return { start, runs };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete document.startViewTransition;
  vi.restoreAllMocks();
  delete root.dataset.pageFade;
});

describe('pickTheme', () => {
  test('with no view transitions, the theme changes at once and nothing is flagged', () => {
    const update = vi.fn();
    pickTheme(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(flagged()).toBe(false);
  });

  test('with reduced motion, the theme changes at once and no transition starts', () => {
    const { start } = fakeTransitions();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        new FakeMediaQueryList(q, q === '(prefers-reduced-motion: reduce)')
    );
    const update = vi.fn();
    pickTheme(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(flagged()).toBe(false);
  });

  test('the change runs inside the transition, flagged until it ends', async () => {
    const { start, runs } = fakeTransitions();
    const update = vi.fn();
    pickTheme(update);
    expect(start).toHaveBeenCalledTimes(1);
    // Flagged before the browser pictures the old page.
    expect(flagged()).toBe(true);
    expect(update).not.toHaveBeenCalled();
    runs[0].callback();
    expect(update).toHaveBeenCalledTimes(1);
    runs[0].finish();
    await settle();
    expect(flagged()).toBe(false);
  });

  test('a second pick mid-fade keeps its flag when the first fade ends', async () => {
    const { runs } = fakeTransitions();
    pickTheme(vi.fn());
    pickTheme(vi.fn());
    runs[0].finish();
    await settle();
    expect(flagged()).toBe(true);
    runs[1].finish();
    await settle();
    expect(flagged()).toBe(false);
  });
});
