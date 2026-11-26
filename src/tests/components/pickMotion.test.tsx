import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  noteLanguageShown,
  pickLanguage,
  pickTheme,
} from '../../components/settings/rightpane/pickMotion';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-1024, KAN-1031. A theme or language pick runs inside a view transition
// that pictures the whole page, flagged on <html> with its kind while it runs. Instant where there is no API, or the
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

describe('pickLanguage', () => {
  // The callback the browser runs, as the module hands it over.
  const run = (i: number) =>
    (
      document.startViewTransition as unknown as {
        mock: { calls: [() => Promise<void>][] };
      }
    ).mock.calls[i][0]();

  test('the current language picked again starts no transition', () => {
    const { start } = fakeTransitions();
    const choose = vi.fn(() => Promise.resolve());
    pickLanguage(null, 'en', 'en', choose);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(flagged()).toBe(false);
  });

  test('the old page holds until the new language is drawn', async () => {
    fakeTransitions();
    const choose = vi.fn(() => Promise.resolve());
    pickLanguage(null, 'de', 'en', choose);
    expect(root.dataset.pageFade).toBe('language');
    let done = false;
    void run(0).then(() => (done = true));
    await settle();
    expect(choose).toHaveBeenCalledTimes(1);
    // Chosen, not yet drawn: the browser keeps the old picture.
    expect(done).toBe(false);
    noteLanguageShown('es');
    await settle();
    expect(done).toBe(false);
    noteLanguageShown('de');
    await settle();
    expect(done).toBe(true);
  });

  test('a language never drawn lets the page go on after half a second', async () => {
    vi.useFakeTimers();
    try {
      fakeTransitions();
      pickLanguage(null, 'de', 'en', () => Promise.resolve());
      let done = false;
      void run(0).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(499);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('words drawn before the choice settles still let the page go on', async () => {
    fakeTransitions();
    pickLanguage(null, 'de', 'en', () => {
      noteLanguageShown('de');
      return Promise.resolve();
    });
    let done = false;
    void run(0).then(() => (done = true));
    await settle();
    expect(done).toBe(true);
  });
});
