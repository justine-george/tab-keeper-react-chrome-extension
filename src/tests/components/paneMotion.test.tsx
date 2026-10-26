import { afterEach, describe, expect, test, vi } from 'vitest';

import { runPaneMotion } from '../../components/home/paneMotion';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-810. A fold, an unfold or the drawer runs its state change inside a
// view transition, so the CSS can move the before and after pictures. Instant
// where there is no API, or the user asked for reduced motion. jsdom has no
// view transitions: this fakes the one method the module reads.

const root = document.documentElement;
const attrs = () => ({
  move: root.dataset.paneMove,
  dir: root.dataset.paneMoveDir,
  from: root.dataset.paneMoveFrom,
});

// A startViewTransition that holds its callback and its finish for the test to run.
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
  document.body.replaceChildren();
  delete root.dataset.paneMove;
  delete root.dataset.paneMoveDir;
  delete root.dataset.paneMoveFrom;
});

describe('runPaneMotion', () => {
  test('with no view transitions, the change happens at once and marks nothing', () => {
    const update = vi.fn();
    runPaneMotion(update, 'openNow', 'fold');
    expect(update).toHaveBeenCalledTimes(1);
    expect(attrs()).toEqual({
      move: undefined,
      dir: undefined,
      from: undefined,
    });
  });

  test('with reduced motion, the change happens at once and no transition starts', () => {
    const { start } = fakeTransitions();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        new FakeMediaQueryList(q, q === '(prefers-reduced-motion: reduce)')
    );
    const update = vi.fn();
    runPaneMotion(update, 'saved', 'unfold');
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  // KAN-812. The panes' pictures would paint over the tour's card and dim.
  test('with a coach card on screen, the change happens at once and no transition starts', () => {
    const { start } = fakeTransitions();
    const card = document.createElement('div');
    card.setAttribute('data-coach-mark', '');
    document.body.append(card);
    const update = vi.fn();
    runPaneMotion(update, 'saved', 'fold');
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(attrs().move).toBeUndefined();
  });

  test('a coach card not yet placed (hidden) does not stop the motion', () => {
    const { start } = fakeTransitions();
    const card = document.createElement('div');
    card.setAttribute('data-coach-mark', '');
    card.setAttribute('aria-hidden', 'true');
    document.body.append(card);
    runPaneMotion(() => {}, 'saved', 'fold');
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('the change runs inside the transition, marked with its kind and direction, which clear at its end', async () => {
    const { start, runs } = fakeTransitions();
    const update = vi.fn();
    runPaneMotion(update, 'openNow', 'unfold');
    expect(start).toHaveBeenCalledTimes(1);
    // The browser pictures the old page first: nothing has changed yet.
    expect(update).not.toHaveBeenCalled();
    expect(attrs()).toEqual({
      move: 'openNow',
      dir: 'unfold',
      from: undefined,
    });
    runs[0].callback();
    expect(update).toHaveBeenCalledTimes(1);
    runs[0].finish();
    await settle();
    expect(attrs()).toEqual({
      move: undefined,
      dir: undefined,
      from: undefined,
    });
  });

  test('folding the saved session with the drawer open marks it as from the drawer', () => {
    fakeTransitions();
    const drawer = document.createElement('div');
    drawer.dataset.paneLayer = 'drawer';
    document.body.append(drawer);
    runPaneMotion(() => {}, 'saved', 'fold');
    expect(attrs().from).toBe('drawer');
  });

  test('not from the drawer when it is closed or leaving, nor for the other kind', () => {
    fakeTransitions();
    runPaneMotion(() => {}, 'saved', 'fold');
    expect(attrs().from).toBeUndefined();
    const drawer = document.createElement('div');
    drawer.dataset.paneLayer = 'drawer';
    document.body.append(drawer);
    runPaneMotion(() => {}, 'openNow', 'fold');
    expect(attrs().from).toBeUndefined();
    // Nor from a drawer already sliding out.
    drawer.dataset.leaving = '';
    runPaneMotion(() => {}, 'saved', 'fold');
    expect(attrs().from).toBeUndefined();
  });

  test("a press during a motion: the first one's end leaves the second's marks", async () => {
    const { runs } = fakeTransitions();
    runPaneMotion(() => {}, 'openNow', 'fold');
    runPaneMotion(() => {}, 'saved', 'fold');
    runs[0].finish();
    await settle();
    expect(attrs()).toEqual({ move: 'saved', dir: 'fold', from: undefined });
    runs[1].finish();
    await settle();
    expect(attrs().move).toBeUndefined();
  });
});
