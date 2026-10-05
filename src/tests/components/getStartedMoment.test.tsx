import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import MainContainer from '../../components/MainContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import {
  ENTER_EASE,
  GET_STARTED,
  SHUTTER_EASE,
  playDialogEntrance,
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
}
let runs: Run[] = [];

function installAnimate(): void {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, keyframes: unknown) {
      let release: () => void = () => undefined;
      let fail: () => void = () => undefined;
      const finished = new Promise<unknown>((resolve, reject) => {
        release = () => resolve(undefined);
        fail = () => reject(new Error('cancelled'));
      });
      runs.push({ target: this, keyframes, release });
      return { finished, cancel: () => fail() };
    },
  });
}

const welcome = (store: { dispatch: (action: unknown) => void }) => {
  store.dispatch(beginSetup());
  store.dispatch(openCloudConsentModal({ variant: 'welcome' }));
};
const getStarted = () => screen.getByRole('button', { name: 'Get started' });
const welcomeDialog = () =>
  document.querySelector('dialog[aria-labelledby="cloud-consent-title"]');
const FULL_RUN = newRun('full', 0, 'welcome');
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
  test('press, then the shutter, then the welcome leaves; then the full-view run is recorded', async () => {
    installAnimate();
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: welcome,
    });
    fireEvent.click(getStarted());
    expect(runs.map((r) => r.target)).toEqual([getStarted()]);

    runs[0].release();
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(runs[1].target).toHaveAttribute('data-hero-part', 'shutter');

    runs[1].release();
    await waitFor(() => expect(runs).toHaveLength(3));
    expect(runs[2].target).toBe(welcomeDialog());
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(true);

    expect(store.getState().settingsDataState.firstRun).toBeNull();

    runs[2].release();
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(FULL_RUN)
    );
    expect(store.getState().globalState.isCloudConsentModalOpen).toBe(false);
  });

  test('a second press while it plays does nothing', async () => {
    installAnimate();
    await renderWithProviders(<MainContainer />, { seedStore: welcome });
    fireEvent.click(getStarted());
    fireEvent.click(getStarted());
    expect(runs).toHaveLength(1);
  });

  test('Esc while it plays cuts it short, and Get started completes (R12)', async () => {
    installAnimate();
    const { store } = await renderWithProviders(<MainContainer />, {
      seedStore: welcome,
    });
    fireEvent.click(getStarted());
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
    runs[0].release();
    await microtasks();
    expect(runs).toHaveLength(1);
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
    fireEvent.click(getStarted());
    await waitFor(() =>
      expect(store.getState().settingsDataState.firstRun).toEqual(FULL_RUN)
    );
    expect(runs).toEqual([]);
  });
});

describe('playGetStarted and playDialogEntrance', () => {
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
        { transform: 'translateX(0)' },
        { transform: 'translateX(-36px)', offset: 0.45 },
        { transform: 'translateX(-36px)', offset: 0.55 },
        { transform: 'translateX(0)' },
      ],
      options: { duration: GET_STARTED.SHUTTER_MS, easing: SHUTTER_EASE },
    });
    expect(log[2]).toEqual({
      keyframes: [
        { opacity: 1, transform: 'translate(-50%, -50%)' },
        { opacity: 0, transform: 'translate(-50%, calc(-50% - 8px))' },
      ],
      options: { duration: 180, easing: 'ease-in', fill: 'forwards' },
    });
    expect(SHUTTER_EASE).toBe('cubic-bezier(0.65, 0, 0.35, 1)');
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

  test('a dialog after Get started enters: opacity 0 to 1, scale 0.97 to 1, 220ms', () => {
    const log: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] =
      [];
    playDialogEntrance(fakeTarget(log).target);
    expect(log).toEqual([
      {
        keyframes: [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.97)' },
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        ],
        options: { duration: GET_STARTED.ENTER_MS, easing: ENTER_EASE },
      },
    ]);
    expect(ENTER_EASE).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
  });

  test('prefersReducedMotion reads the media query', () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, true)
    );
    expect(prefersReducedMotion()).toBe(true);
  });
});
