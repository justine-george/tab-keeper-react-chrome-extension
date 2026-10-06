import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { RunHelloDialog } from '../../components/modals/RunHelloDialog';
import {
  renderWithProviders,
  type RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  HELLO_ENTRANCE,
  SHUTTER_EASE,
  playHelloEntrance,
  playGetStarted,
  prefersReducedMotion,
  type Animatable,
} from '../../components/modals/getStartedMotion';
import { openCloudConsentModal } from '../../redux/slices/globalStateSlice';
import { beginSetup } from '../../redux/slices/settingsDataStateSlice';
import { newRun } from '../../utils/functions/firstRun';

// jsdom has no Web Animations: a fake records each run and the test finishes it.

interface Run {
  target: Element;
  keyframes: unknown;
  release: () => void;
  isFinished: () => boolean;
  isCancelled: () => boolean;
}
let runs: Run[] = [];

function installAnimate(): void {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, keyframes: unknown) {
      let release: () => void = () => undefined;
      let fail: () => void = () => undefined;
      let isFinished = false;
      let isCancelled = false;
      const finished = new Promise<unknown>((resolve, reject) => {
        release = () => resolve(undefined);
        fail = () => reject(new Error('cancelled'));
      });
      const run: Run = {
        target: this,
        keyframes,
        release,
        isFinished: () => isFinished,
        isCancelled: () => isCancelled,
      };
      finished.catch(() => undefined);
      runs.push(run);
      return {
        finished,
        cancel: () => {
          isCancelled = true;
          fail();
        },
        finish: () => {
          isFinished = true;
        },
      };
    },
  });
}

const welcome = (store: { dispatch: (action: unknown) => void }) => {
  store.dispatch(beginSetup());
  store.dispatch(openCloudConsentModal({ variant: 'welcome' }));
};
const getStarted = () => screen.getByRole('button', { name: 'Get started' });
// The loop plays on open; the moment's runs are the ones started by the press.
function pressGetStarted(): { moment: () => Run[]; loop: Run[] } {
  const loop = [...runs];
  fireEvent.click(getStarted());
  return { moment: () => runs.slice(loop.length), loop };
}
const welcomeDialog = () =>
  document.querySelector('dialog[aria-labelledby="cloud-consent-title"]');
const FULL_RUN = newRun('full', 1);
const microtasks = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  runs = [];
  localStorage.clear();
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the moment on the welcome', () => {
  test('the loop ends at once, then press, the shutter, the welcome leaves; then the full-view run is recorded', async () => {
    installAnimate();
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: welcome,
    });
    expect(
      document.querySelector('[data-hero-frame="start"]')
    ).toBeInTheDocument();
    const { moment, loop } = pressGetStarted();
    expect(loop).toHaveLength(21);
    expect(loop.every((r) => r.isFinished())).toBe(true);
    expect(moment().map((r) => r.target)).toEqual([getStarted()]);

    moment()[0].release();
    await waitFor(() => expect(moment()).toHaveLength(2));
    expect(moment()[1].target).toHaveAttribute('data-hero-part', 'shutter');

    moment()[1].release();
    await waitFor(() => expect(moment()).toHaveLength(3));
    expect(moment()[2].target).toBe(welcomeDialog());
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true);

    expect(store.getState().settingsDataState.firstRun).toBeNull();

    moment()[2].release();
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(FULL_RUN)
    );
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
  });

  test('under StrictMode the loop still plays from its start, and Get started still finishes it', async () => {
    installAnimate();
    await renderWithProviders(
      <StrictMode>
        <MainContainer />
      </StrictMode>,
      { seedStore: welcome }
    );
    const live = runs.filter((r) => !r.isCancelled());
    expect(live).toHaveLength(21);
    expect(live.every((r) => !r.isFinished())).toBe(true);
    pressGetStarted();
    expect(live.every((r) => r.isFinished())).toBe(true);
  });

  test('a second press while it plays does nothing', async () => {
    installAnimate();
    await renderWithProviders(<MainContainer />, { seedStore: welcome });
    const { moment } = pressGetStarted();
    fireEvent.click(getStarted());
    expect(moment()).toHaveLength(1);
  });

  test('Esc while it plays cuts it short, and Get started completes (R12)', async () => {
    installAnimate();
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: welcome,
    });
    const { moment } = pressGetStarted();
    const dialog = welcomeDialog();
    if (dialog === null) throw new Error('no welcome');
    fireEvent(
      dialog,
      new Event('cancel', { bubbles: false, cancelable: true })
    );
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(FULL_RUN)
    );
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    // The press it cancelled finishing late starts nothing after it.
    moment()[0].release();
    await microtasks();
    expect(moment()).toHaveLength(1);
  });

  // Every run record written and every card drawn from now on.
  function watchRunStarts(store: RenderWithProvidersResult['store']) {
    const views: string[] = [];
    let cards = 0;
    const unsubscribe = store.subscribe(() => {
      const run = store.getState().settingsDataState.firstRun;
      if (run !== null && views[views.length - 1] !== run.view)
        views.push(run.view);
    });
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-coach-mark]') !== null) cards += 1;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return {
      read: () => {
        unsubscribe();
        observer.disconnect();
        return { views, cards };
      },
    };
  }

  test('Stay here while it plays neither closes the welcome nor starts the popup run; Get started completes', async () => {
    installAnimate();
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: welcome,
    });
    const watch = watchRunStarts(store);
    const { moment } = pressGetStarted();
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    // Whatever of the beat is still to play, played out.
    for (let i = 0; i < 3; i += 1) {
      moment()[i]?.release();
      await microtasks();
    }
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(FULL_RUN)
    );
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
    expect(watch.read()).toEqual({ views: ['full'], cards: 0 });
  });

  test('CONTROL: Stay here with no beat playing starts the popup run, and the watch sees it', async () => {
    installAnimate();
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: welcome,
    });
    const watch = watchRunStarts(store);
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    await waitFor(() =>
      expect(store.getState().globalState.isRunHere).toBe(true)
    );
    await microtasks();
    const seen = watch.read();
    expect(seen.views).toEqual(['popup']);
    expect(seen.cards).toBeGreaterThan(0);
  });

  test('reduced motion: straight on to the full-view run, and nothing animates', async () => {
    installAnimate();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        new FakeMediaQueryList(
          query,
          query === '(prefers-reduced-motion: reduce)'
        )
    );
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: welcome,
    });
    expect(
      document.querySelector('[data-hero-frame="end"]')
    ).toBeInTheDocument();
    fireEvent.click(getStarted());
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(FULL_RUN)
    );
    expect(runs).toEqual([]);
  });
});

describe('Hello enters (A7)', () => {
  const renderHello = () =>
    renderWithProviders(
      <RunHelloDialog hello="welcome" onStart={vi.fn()} onSkip={vi.fn()} />
    );

  test('as the dialog: opacity 0 to 1 and scale 0.97 to 1, 220ms', async () => {
    installAnimate();
    await renderHello();
    expect(runs).toHaveLength(1);
    expect(runs[0].target).toBe(document.querySelector('[data-run-hello]'));
    expect(runs[0].keyframes).toEqual([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.97)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    ]);
  });

  test('reduced motion: it shows at once', async () => {
    installAnimate();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        new FakeMediaQueryList(
          query,
          query === '(prefers-reduced-motion: reduce)'
        )
    );
    await renderHello();
    expect(document.querySelector('[data-run-hello]')).toBeInTheDocument();
    expect(runs).toEqual([]);
  });
});

describe('playGetStarted and playHelloEntrance', () => {
  function fakeTarget(
    log: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[]
  ) {
    const pending: (() => void)[] = [];
    const target: Animatable = {
      animate: (keyframes, options) => {
        log.push({ keyframes, options });
        const finished = new Promise<unknown>((resolve) => {
          pending.push(() => resolve(undefined));
        });
        return { finished, cancel: () => undefined };
      },
    };
    return { target, finishAll: () => pending.forEach((done) => done()) };
  }

  test('the spec’s keyframes, durations and easings', async () => {
    const log: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] =
      [];
    const button = fakeTarget(log);
    const shutter = fakeTarget(log);
    const dialog = fakeTarget(log);
    const motion = playGetStarted({
      button: button.target,
      shutter: shutter.target,
      dialog: dialog.target,
    });
    button.finishAll();
    await vi.waitFor(() => expect(log).toHaveLength(2));
    shutter.finishAll();
    await vi.waitFor(() => expect(log).toHaveLength(3));
    dialog.finishAll();
    expect(await motion.finished).toBe(true);

    expect(log[0]).toEqual({
      keyframes: [
        { transform: 'scale(1)' },
        { transform: 'scale(0.96)' },
        { transform: 'scale(1)' },
      ],
      options: { duration: 150, easing: 'ease-out' },
    });
    expect(log[1]).toEqual({
      keyframes: [
        { transform: 'translateX(0px)' },
        { transform: 'translateX(-14px)', offset: 0.5 },
        { transform: 'translateX(0px)' },
      ],
      options: { duration: 250, easing: 'ease-in-out' },
    });
    expect(log[2]).toEqual({
      keyframes: [
        { opacity: 1, transform: 'translate(-50%, -50%)' },
        { opacity: 0, transform: 'translate(-50%, calc(-50% - 8px))' },
      ],
      options: { duration: 150, easing: 'ease-in', fill: 'forwards' },
    });
    expect(SHUTTER_EASE).toBe('ease-in-out');
  });

  test('a mark without its shutter still presses and leaves', async () => {
    const log: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] =
      [];
    const button = fakeTarget(log);
    const dialog = fakeTarget(log);
    const motion = playGetStarted({
      button: button.target,
      shutter: null,
      dialog: dialog.target,
    });
    button.finishAll();
    await vi.waitFor(() => expect(log).toHaveLength(2));
    dialog.finishAll();
    expect(await motion.finished).toBe(true);
  });

  test('Hello enters: opacity 0 to 1, scale 0.97 to 1, 220ms', () => {
    const log: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] =
      [];
    playHelloEntrance(fakeTarget(log).target);
    expect(log).toEqual([
      {
        keyframes: [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.97)' },
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        ],
        options: { duration: HELLO_ENTRANCE.MS, easing: HELLO_ENTRANCE.EASE },
      },
    ]);
    expect(HELLO_ENTRANCE.EASE).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
  });

  test('prefersReducedMotion reads the media query', () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, true)
    );
    expect(prefersReducedMotion()).toBe(true);
  });
});
