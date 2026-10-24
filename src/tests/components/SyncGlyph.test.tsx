import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { css } from '@emotion/react';

import Icon from '../../components/common/Icon';
import SyncGlyph from '../../components/common/SyncGlyph';
import type { IconName } from '../../components/common/iconNames';
import {
  CLOUD_DONE_PATH,
  CLOUD_DONE_HALF_TURN,
  CLOUD_DONE_UPRIGHT,
  SYNC_PATH,
  SYNC_PROBLEM_HALF_TURN,
  SYNC_PROBLEM_PATH,
  SYNC_PROBLEM_UPRIGHT,
} from '../../components/common/syncMorph.data';
import {
  easeInOutCubic,
  INTO_TURN_EASE,
  MORPH_MS,
  morphPath,
  SETTLE_DISTANCE_DEG,
  SETTLE_EASE,
  TURN_MS,
} from '../../components/common/syncMotion';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-750. jsdom runs no CSS animations, has no Web Animations, and its frames
// are fake-timer ticks: these tests prove which layers, outlines and animation
// rules are drawn and when the glyph settles, not how the motion looks. That is
// for the recorded popup (e2e).
const glyphCss = css`
  width: 24px;
  height: 24px;
  color: rgb(1, 2, 3);
`;

type Props = { glyph: IconName; turning: boolean };

function one(parent: ParentNode, selector: string): Element {
  const el = parent.querySelector(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

function setup(initial: Props) {
  const view = render(<SyncGlyph {...initial} glyphCss={glyphCss} />);
  const root = () => one(view.container, '[data-glyph]');
  const update = (p: Props) =>
    view.rerender(<SyncGlyph {...p} glyphCss={glyphCss} />);
  const layers = () => [...root().children];
  const paths = () => [...root().querySelectorAll('path')];
  const svg = () => one(root(), 'svg');
  return { view, root, update, layers, paths, svg };
}

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

// jsdom keeps the `animation` shorthand as written and does not expand it.
const animationOf = (el: Element) => getComputedStyle(el).animation;

const animationNameOf = (el: Element) => animationOf(el).split(' ')[0];

// An animation event as the browser fires it: it names the keyframes it is for.
function fireAnimation(
  el: Element,
  type: 'animationend' | 'animationcancel',
  animationName: string
) {
  fireEvent(
    el,
    Object.assign(new Event(type, { bubbles: true }), { animationName })
  );
}

// The @keyframes rule an element's animation names, as emotion wrote it.
function keyframesOf(el: Element): string {
  const name = animationNameOf(el);
  if (!name || name === 'none') return '';
  const rules = [...document.querySelectorAll('style')]
    .map((s) => s.textContent ?? '')
    .join('');
  return (
    rules.match(new RegExp(`@keyframes ${name}\\{[^}]*\\}\\}?`))?.[0] ?? ''
  );
}

function reduceMotion() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      new FakeMediaQueryList(
        query,
        query === '(prefers-reduced-motion: reduce)'
      )
  );
}

describe('SyncGlyph', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('sets data-glyph and data-turning', () => {
    const { root, update } = setup({ glyph: 'sync', turning: true });
    expect(root().getAttribute('data-glyph')).toBe('sync');
    expect(root().getAttribute('data-turning')).toBe('true');

    update({ glyph: 'sync', turning: false });
    expect(root().getAttribute('data-turning')).toBe('false');

    // Only sync turns.
    wait(100);
    update({ glyph: 'cloud_off', turning: true });
    expect(root().getAttribute('data-glyph')).toBe('cloud_off');
    expect(root().getAttribute('data-turning')).toBe('false');
  });

  test('a turning sync turns counter-clockwise once per TURN_MS, forever', () => {
    const { update, svg } = setup({ glyph: 'sync', turning: true });
    expect(keyframesOf(svg())).toContain('rotate(-360deg)');
    expect(animationOf(svg())).toMatch(
      new RegExp(` ${TURN_MS}ms linear infinite$`)
    );

    update({ glyph: 'sync', turning: false });
    expect(keyframesOf(svg())).toBe('');
  });

  test('draws sync, cloud_done and sync_problem as outlines and others as ligatures', () => {
    const { root, update, paths, svg } = setup({
      glyph: 'sync',
      turning: false,
    });
    const outline = (d: string) => {
      expect(svg().getAttribute('viewBox')).toBe('0 -960 960 960');
      expect(svg().getAttribute('fill')).toBe('currentColor');
      expect(getComputedStyle(svg()).width).toBe('24px');
      expect(getComputedStyle(svg()).color).toBe('rgb(1, 2, 3)');
      expect(paths().map((p) => p.getAttribute('d'))).toEqual([d]);
      expect(root().querySelector('.material-symbols-outlined')).toBeNull();
    };
    outline(SYNC_PATH);

    // Under 50 ms after mount, so no morph: this is the drawing alone.
    update({ glyph: 'cloud_done', turning: false });
    outline(CLOUD_DONE_PATH);
    update({ glyph: 'sync_problem', turning: false });
    outline(SYNC_PROBLEM_PATH);

    const ligature = setup({ glyph: 'cloud_off', turning: false });
    const span = one(ligature.root(), '.material-symbols-outlined');
    expect(span.textContent).toBe('cloud_off');
    expect(getComputedStyle(span).width).toBe('24px');
    expect(getComputedStyle(span).color).toBe('rgb(1, 2, 3)');
    expect(ligature.root().querySelector('svg')).toBeNull();
  });

  test('the glyph is hidden from assistive tech: the control names itself', () => {
    const { root } = setup({ glyph: 'sync_problem', turning: false });
    expect(root().getAttribute('aria-hidden')).toBe('true');
  });

  test('crossfades a pair with no morph', () => {
    const { root, update, layers } = setup({ glyph: 'sync', turning: true });
    wait(100);
    update({ glyph: 'cloud_off', turning: false });

    expect(root().getAttribute('data-glyph')).toBe('cloud_off');
    const [old, fresh] = layers();
    expect(layers()).toHaveLength(2);
    expect(old.querySelector('path')?.getAttribute('d')).toBe(SYNC_PATH);
    expect(keyframesOf(old)).toMatch(/to\{opacity:0;?\}/);
    expect(animationOf(old)).toMatch(/ 200ms /);
    expect(fresh.textContent).toBe('cloud_off');
    expect(keyframesOf(fresh)).toMatch(/from\{opacity:0;?\}/);

    // Neither the arriving layer's end nor the turn inside the old one removes it.
    fireAnimation(fresh, 'animationend', animationNameOf(fresh));
    const turning = one(old, 'svg');
    fireAnimation(turning, 'animationend', animationNameOf(turning));
    expect(layers()).toHaveLength(2);

    fireAnimation(old, 'animationend', animationNameOf(old));
    expect(layers()).toEqual([fresh]);
    expect(root().querySelector('svg')).toBeNull();
  });

  // A fade-out cut short (its element hidden, say) is over too.
  test('a cancelled fade-out also removes its layer', () => {
    const { update, layers } = setup({ glyph: 'cloud_off', turning: false });
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    const [old, fresh] = layers();
    fireAnimation(old, 'animationcancel', animationNameOf(old));
    expect(layers()).toEqual([fresh]);
  });

  // Chromium cancels the fade-in when a change swaps it for the fade-out mid-way.
  test('a change mid-fade-in fades the layer out instead of dropping it', () => {
    const { update, layers, paths } = setup({
      glyph: 'cloud_off',
      turning: false,
    });
    wait(100);
    update({ glyph: 'cloud', turning: false });
    const arriving = layers()[1];
    const fadeIn = animationNameOf(arriving);
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    expect(layers()).toEqual([arriving, expect.anything()]);

    fireAnimation(arriving, 'animationcancel', fadeIn);
    expect(layers()).toHaveLength(2);
    expect(arriving.isConnected).toBe(true);

    fireAnimation(arriving, 'animationend', animationNameOf(arriving));
    expect(layers()).toHaveLength(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([
      SYNC_PROBLEM_PATH,
    ]);
  });

  test('a glyph up under 50 ms is replaced without motion', () => {
    const quick = setup({ glyph: 'cloud_off', turning: false });
    wait(49);
    quick.update({ glyph: 'cloud_done', turning: false });
    expect(quick.layers()).toHaveLength(1);
    expect(keyframesOf(quick.layers()[0])).toBe('');
    expect(quick.paths().map((p) => p.getAttribute('d'))).toEqual([
      CLOUD_DONE_PATH,
    ]);
    quick.view.unmount();

    // CONTROL: at 50 ms it was seen, so it fades.
    const seen = setup({ glyph: 'cloud_off', turning: false });
    wait(50);
    seen.update({ glyph: 'cloud_done', turning: false });
    expect(seen.layers()).toHaveLength(2);
  });

  test('a sync up under 50 ms becomes cloud_done without a morph', () => {
    const { update, paths } = setup({ glyph: 'sync', turning: true });
    wait(10);
    update({ glyph: 'cloud_done', turning: false });
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([CLOUD_DONE_PATH]);
  });

  test('reduced motion swaps at once', () => {
    reduceMotion();
    const { root, update, layers, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    expect(root().getAttribute('data-turning')).toBe('false');
    expect(keyframesOf(svg())).toBe('');

    wait(100);
    update({ glyph: 'cloud_done', turning: false });
    expect(layers()).toHaveLength(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([CLOUD_DONE_PATH]);

    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    expect(layers()).toHaveLength(1);
    expect(keyframesOf(layers()[0])).toBe('');
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([
      SYNC_PROBLEM_PATH,
    ]);

    wait(100);
    update({ glyph: 'sync', turning: true });
    expect(root().getAttribute('data-turning')).toBe('false');
    expect(keyframesOf(svg())).toBe('');

    // A failure from turning arrows: no morph either.
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    expect(layers()).toHaveLength(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([
      SYNC_PROBLEM_PATH,
    ]);
  });

  test('a morph ends on the exact outline after MORPH_MS, without Web Animations', () => {
    expect(Element.prototype.animate).toBeUndefined();
    const { root, update, layers, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(100);
    update({ glyph: 'cloud_done', turning: false });
    expect(root().getAttribute('data-glyph')).toBe('cloud_done');
    expect(root().getAttribute('data-turning')).toBe('false');
    expect(layers()).toHaveLength(1);
    // Not turning (no CSS turn to read), so it settles a half turn round.
    expect(paths()[0].getAttribute('d')).toBe(
      morphPath(CLOUD_DONE_HALF_TURN, 0)
    );

    wait(MORPH_MS - 1);
    expect(paths()[0].getAttribute('d')).not.toBe(CLOUD_DONE_PATH);
    wait(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([CLOUD_DONE_PATH]);

    // And back: the cloud flows into arrows whose turn starts a quarter in.
    wait(100);
    update({ glyph: 'sync', turning: true });
    expect(paths()[0].getAttribute('d')).toBe(morphPath(CLOUD_DONE_UPRIGHT, 1));
    expect(keyframesOf(svg())).toBe('');
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(keyframesOf(svg())).toContain('rotate(-360deg)');
    expect(getComputedStyle(svg()).animationDelay).toBe(`-${TURN_MS / 4}ms`);
  });

  test('a failed sync morphs into sync_problem, and a press turns it back', () => {
    const { root, update, layers, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    expect(root().getAttribute('data-glyph')).toBe('sync_problem');
    expect(root().getAttribute('data-turning')).toBe('false');
    // One layer, no crossfade: it settles a half turn round, the "!" upright.
    expect(layers()).toHaveLength(1);
    expect(keyframesOf(layers()[0])).toBe('');
    expect(paths()[0].getAttribute('d')).toBe(
      morphPath(SYNC_PROBLEM_HALF_TURN, 0)
    );
    wait(MORPH_MS - 1);
    expect(paths()[0].getAttribute('d')).not.toBe(SYNC_PROBLEM_PATH);
    wait(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([
      SYNC_PROBLEM_PATH,
    ]);

    // The retry: the "!" shrinks away as the arrows turn back in.
    wait(100);
    update({ glyph: 'sync', turning: true });
    expect(layers()).toHaveLength(1);
    expect(paths()[0].getAttribute('d')).toBe(
      morphPath(SYNC_PROBLEM_UPRIGHT, 1)
    );
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(keyframesOf(svg())).toContain('rotate(-360deg)');
    expect(getComputedStyle(svg()).animationDelay).toBe(`-${TURN_MS / 4}ms`);
  });

  test('sync_problem and cloud_done crossfade: no morph between the two', () => {
    const { update, layers } = setup({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    expect(layers()).toHaveLength(2);
    expect(keyframesOf(layers()[1])).toMatch(/from\{opacity:0;?\}/);
    expect(layers()[1].querySelector('path')?.getAttribute('d')).toBe(
      SYNC_PROBLEM_PATH
    );

    const back = setup({ glyph: 'sync_problem', turning: false });
    wait(100);
    back.update({ glyph: 'cloud_done', turning: false });
    expect(back.layers()).toHaveLength(2);
    expect(back.layers()[1].querySelector('path')?.getAttribute('d')).toBe(
      CLOUD_DONE_PATH
    );
  });

  // The sets differ in ring count (arrows + check, arrows + bar + dot).
  test.each([
    { first: 'cloud_done', then: 'sync_problem' },
    { first: 'sync_problem', then: 'cloud_done' },
  ] as const)(
    'a $then mid-press-morph from $first ends exact on $then',
    ({ first, then }) => {
      const error = vi.spyOn(console, 'error');
      const { root, update, layers, paths } = setup({
        glyph: first,
        turning: false,
      });
      wait(100);
      update({ glyph: 'sync', turning: true });
      wait(208);
      const shown = paths()[0].getAttribute('d');
      update({ glyph: then, turning: false });
      // From the frame on screen: no jump. Into sync_problem the "!" dot also
      // starts, from a point (at most 4 units across) that the check never had.
      const drawn = paths()[0].getAttribute('d') ?? '';
      expect(drawn.startsWith(shown ?? '-')).toBe(true);
      const seed = drawn.slice(shown?.length).match(/-?\d+(\.\d+)?/g) ?? [];
      expect(seed.length).toBe(then === 'sync_problem' ? 24 : 0);
      const xs = seed.filter((_, i) => i % 2 === 0).map(Number);
      const ys = seed.filter((_, i) => i % 2 === 1).map(Number);
      if (seed.length) {
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(4);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4);
      }
      expect(layers()).toHaveLength(1);
      wait(MORPH_MS);
      expect(root().getAttribute('data-glyph')).toBe(then);
      expect(paths().map((p) => p.getAttribute('d'))).toEqual([
        then === 'cloud_done' ? CLOUD_DONE_PATH : SYNC_PROBLEM_PATH,
      ]);
      expect(vi.getTimerCount()).toBe(0);
      expect(error).not.toHaveBeenCalled();
    }
  );

  test('a change during a morph ends on the newest glyph', () => {
    const error = vi.spyOn(console, 'error');
    const { root, update, layers, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(100);
    update({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'sync', turning: true });
    expect(root().getAttribute('data-glyph')).toBe('sync');
    expect(root().getAttribute('data-turning')).toBe('true');

    // Past where the first morph would have ended, and the second.
    wait(MORPH_MS);
    expect(root().getAttribute('data-glyph')).toBe('sync');
    expect(root().getAttribute('data-turning')).toBe('true');
    expect(layers()).toHaveLength(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(keyframesOf(svg())).toContain('rotate(-360deg)');
    expect(vi.getTimerCount()).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  test('a crossfade during a morph ends the morph on its outline, then fades it', () => {
    const { root, update, layers } = setup({ glyph: 'sync', turning: true });
    wait(100);
    update({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    const [old, fresh] = layers();
    expect(old.querySelector('path')?.getAttribute('d')).toBe(CLOUD_DONE_PATH);
    expect(keyframesOf(old)).toMatch(/to\{opacity:0;?\}/);
    expect(fresh.querySelector('path')?.getAttribute('d')).toBe(
      SYNC_PROBLEM_PATH
    );
    wait(MORPH_MS);
    expect(root().getAttribute('data-glyph')).toBe('sync_problem');
    expect(old.querySelector('path')?.getAttribute('d')).toBe(CLOUD_DONE_PATH);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('unmounting mid-morph leaves nothing running', () => {
    const error = vi.spyOn(console, 'error');
    const { view, update } = setup({ glyph: 'sync', turning: true });
    wait(100);
    update({ glyph: 'cloud_done', turning: false });
    wait(50);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    wait(MORPH_MS);
    expect(error).not.toHaveBeenCalled();
  });
});

// The glyph's first frame as it starts to flow into arrows.
const atStart = (glyph: 'cloud_done' | 'sync_problem') =>
  (glyph === 'cloud_done' ? CLOUD_DONE_UPRIGHT : SYNC_PROBLEM_UPRIGHT).map(
    ({ to }) => ({ from: to, to })
  );
const CLOUD_TO_ARROWS_AT_START = atStart('cloud_done');
// The two upright arrows, unchanged from first frame to last.
const ARROWS_STILL = CLOUD_DONE_UPRIGHT.slice(0, 2).map(({ from }) => ({
  from,
  to: from,
}));

// The x,y points of each ring in a drawn path.
const ringsOf = (d: string | null): number[][] =>
  (d ?? '')
    .split('Z')
    .filter((ring) => ring !== '')
    .map((ring) => ring.slice(1).split(/[ L]/).map(Number));
const centroidOf = (ring: number[]): [number, number] => {
  const n = ring.length / 2;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] / n;
    y += ring[i + 1] / n;
  }
  return [x, y];
};

// With Web Animations present: the settle turns from where the CSS turn is.
describe('SyncGlyph with Web Animations', () => {
  const cancel = vi.fn();
  // How far along its easing the running rotation reports it is.
  let rotationProgress = 0;
  const animate = vi.fn<
    (
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions
    ) => {
      cancel(): void;
      effect: { getComputedTiming(): { progress: number } };
      // Set by a settle timed to its turn.
      startTime?: number | null;
    }
  >(() => ({
    cancel,
    effect: { getComputedTiming: () => ({ progress: rotationProgress }) },
  }));

  beforeEach(() => {
    // Cleared here, not after: the last test's unmount runs after its afterEach.
    animate.mockClear();
    cancel.mockClear();
    rotationProgress = 0;
    vi.useFakeTimers();
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // The running CSS turn, as getAnimations() reports it: `progress` of the way
  // round now, and going on round at one turn per TURN_MS.
  function turnFrom(svg: Element, progress: number) {
    const from = performance.now();
    Object.defineProperty(svg, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          animationName: 'turn',
          effect: {
            getComputedTiming: () => ({
              progress: (progress + (performance.now() - from) / TURN_MS) % 1,
            }),
          },
        },
      ],
    });
  }

  const settleArgs = (from: number, to: number, easing = SETTLE_EASE) => [
    [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }],
    { duration: MORPH_MS, easing, fill: 'both' },
  ];

  // KAN-750 "same every time": from wherever the turn is, it turns on to the spot
  // SETTLE_DISTANCE_DEG before the next half-turn pose, then settles from there.
  test.each([
    // 0.375 of a turn is -135: on 135 degrees (300 ms) to -270, then to -360, upright.
    {
      glyph: 'cloud_done',
      progress: 0.375,
      waitMs: 300,
      from: -270,
      to: -360,
      pairs: CLOUD_DONE_UPRIGHT,
      path: CLOUD_DONE_PATH,
    },
    // Just past a spot (-90): on almost half a turn, to the next one.
    {
      glyph: 'cloud_done',
      progress: 0.25 + 1 / 1024,
      waitMs: ((180 - 360 / 1024) * TURN_MS) / 360,
      from: -270,
      to: -360,
      pairs: CLOUD_DONE_UPRIGHT,
      path: CLOUD_DONE_PATH,
    },
    // On a spot: it settles at once, a half turn round.
    {
      glyph: 'cloud_done',
      progress: 0.25,
      waitMs: 0,
      from: -90,
      to: -180,
      pairs: CLOUD_DONE_HALF_TURN,
      path: CLOUD_DONE_PATH,
    },
    // A failed sync lands the same way, into the arrows with a "!".
    {
      glyph: 'sync_problem',
      progress: 0.625,
      waitMs: 100,
      from: -270,
      to: -360,
      pairs: SYNC_PROBLEM_UPRIGHT,
      path: SYNC_PROBLEM_PATH,
    },
    // -315 turns on through -360 to -450 (= -90): upside down, so the half-turn set.
    {
      glyph: 'sync_problem',
      progress: 0.875,
      waitMs: 300,
      from: -450,
      to: -540,
      pairs: SYNC_PROBLEM_HALF_TURN,
      path: SYNC_PROBLEM_PATH,
    },
  ] as const)(
    'into $glyph at $progress of a turn it turns on $waitMs ms, then settles from $from to $to degrees',
    ({ glyph, progress, waitMs, from, to, pairs, path }) => {
      const { root, update, paths, svg } = setup({
        glyph: 'sync',
        turning: true,
      });
      // On a frame boundary, so the frames below land on known times.
      wait(160);
      turnFrom(svg(), progress);
      const askedAt = performance.now();
      update({ glyph, turning: false });

      if (waitMs > 1) {
        wait(Math.ceil(waitMs) - 1);
        // R21: still the turning arrows, and data-glyph says so.
        expect(animate).not.toHaveBeenCalled();
        expect(root().getAttribute('data-glyph')).toBe('sync');
        expect(root().getAttribute('data-turning')).toBe('true');
        expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
        wait(1);
      }
      expect(root().getAttribute('data-glyph')).toBe(glyph);
      expect(root().getAttribute('data-turning')).toBe('false');
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0]).toEqual(settleArgs(from, to));
      expect(from - to).toBe(SETTLE_DISTANCE_DEG);
      // Timed from the moment the turn reached the spot, not when the timer ran.
      expect(animate.mock.results[0].value.startTime).toBeCloseTo(
        askedAt + waitMs,
        6
      );
      expect(paths()[0].getAttribute('d')).toBe(morphPath(pairs, 0));

      expect(cancel).not.toHaveBeenCalled();
      wait(MORPH_MS);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(paths().map((p) => p.getAttribute('d'))).toEqual([path]);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  test('the shape eases in step with the settle', () => {
    const { update, paths, svg } = setup({ glyph: 'sync', turning: true });
    // On a frame boundary, so the frames below land on known times.
    wait(160);
    // On a spot, so the settle starts now.
    turnFrom(svg(), 0.25);
    update({ glyph: 'cloud_done', turning: false });
    wait(208);
    expect(paths()[0].getAttribute('d')).toBe(
      morphPath(CLOUD_DONE_HALF_TURN, easeInOutCubic(208 / MORPH_MS))
    );
  });

  test('a press while the turn runs on to its spot keeps it turning: no settle', () => {
    const { root, update, layers, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(160);
    turnFrom(svg(), 0.375);
    update({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'sync', turning: true });
    wait(TURN_MS + MORPH_MS);
    expect(animate).not.toHaveBeenCalled();
    expect(root().getAttribute('data-glyph')).toBe('sync');
    expect(root().getAttribute('data-turning')).toBe('true');
    expect(layers()).toHaveLength(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(keyframesOf(svg())).toContain('rotate(-360deg)');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('another landing while the turn runs on settles there instead, at the same spot', () => {
    const { root, update, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(160);
    turnFrom(svg(), 0.375);
    const askedAt = performance.now();
    update({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    wait(199);
    expect(animate).not.toHaveBeenCalled();
    wait(1);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]).toEqual(settleArgs(-270, -360));
    expect(animate.mock.results[0].value.startTime).toBe(askedAt + 300);
    expect(root().getAttribute('data-glyph')).toBe('sync_problem');
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([
      SYNC_PROBLEM_PATH,
    ]);
  });

  test('a crossfade while the turn runs on starts at once, from the turning arrows', () => {
    const { root, update, layers, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(160);
    turnFrom(svg(), 0.375);
    update({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'cloud_off', turning: false });
    expect(root().getAttribute('data-glyph')).toBe('cloud_off');
    expect(layers()).toHaveLength(2);
    wait(TURN_MS);
    expect(animate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('unmounting while the turn runs on to its spot leaves nothing running', () => {
    const error = vi.spyOn(console, 'error');
    const { view, update, svg } = setup({ glyph: 'sync', turning: true });
    wait(160);
    turnFrom(svg(), 0.375);
    update({ glyph: 'cloud_done', turning: false });
    wait(100);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    wait(TURN_MS);
    expect(animate).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  test('a sync up under 50 ms becomes cloud_done at once, with no turn on', () => {
    const { update, paths, svg } = setup({ glyph: 'sync', turning: true });
    turnFrom(svg(), 0.375);
    wait(10);
    update({ glyph: 'cloud_done', turning: false });
    expect(animate).not.toHaveBeenCalled();
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([CLOUD_DONE_PATH]);
  });

  test.each(['cloud_done', 'sync_problem'] as const)(
    'from %s into a turning sync it turns a quarter with the into-turn ease',
    (glyph) => {
      const { update, paths } = setup({ glyph, turning: false });
      wait(100);
      update({ glyph: 'sync', turning: true });
      expect(animate.mock.calls[0]).toEqual([
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-90deg)' }],
        { duration: MORPH_MS, easing: INTO_TURN_EASE, fill: 'both' },
      ]);
      // It starts from the glyph itself, upright.
      expect(paths()[0].getAttribute('d')).toBe(morphPath(atStart(glyph), 0));
    }
  );

  // An edit after a sync, or after a failed one: the glyph becomes still arrows where it stands.
  test.each(['cloud_done', 'sync_problem'] as const)(
    'from %s into a still sync it morphs without turning',
    (glyph) => {
      const { root, update, paths, svg } = setup({
        glyph,
        turning: false,
      });
      wait(100);
      update({ glyph: 'sync', turning: false });
      expect(animate.mock.calls[0]).toEqual([
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(0deg)' }],
        { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'both' },
      ]);
      expect(paths()[0].getAttribute('d')).toBe(morphPath(atStart(glyph), 0));
      wait(MORPH_MS);
      expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
      expect(root().getAttribute('data-turning')).toBe('false');
      expect(keyframesOf(svg())).toBe('');
    }
  );

  // No turn on: the frame on screen is already settling.
  test('a landing cut short into a still sync settles upright from the frame on screen', () => {
    const { update, paths, svg } = setup({ glyph: 'sync', turning: true });
    wait(160);
    turnFrom(svg(), 0.375);
    update({ glyph: 'cloud_done', turning: false });
    wait(300 + 150);
    const shown = paths()[0].getAttribute('d');
    // -270 to -360, half way along its ease: -315 on screen.
    rotationProgress = 0.5;

    update({ glyph: 'sync', turning: false });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    expect(animate.mock.calls[1]).toEqual(settleArgs(-315, -360));
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
  });

  // The 8 s offline stop, an edit mid-sync, a gate that closes: no snap to 0.
  test.each([
    // 0.375 of a turn is -135: on to -270 (300 ms), then settles to -360.
    { progress: 0.375, waitMs: 300, from: -270, to: -360 },
    // 0.125 is -45: on to -90 (100 ms), then to -180.
    { progress: 0.125, waitMs: 100, from: -90, to: -180 },
  ])(
    'a turn stopped at $progress turns on $waitMs ms and settles from $from to $to, its shape unchanged',
    ({ progress, waitMs, from, to }) => {
      const { root, update, layers, paths, svg } = setup({
        glyph: 'sync',
        turning: true,
      });
      wait(160);
      turnFrom(svg(), progress);
      update({ glyph: 'sync', turning: false });
      wait(waitMs - 1);
      expect(animate).not.toHaveBeenCalled();
      expect(root().getAttribute('data-turning')).toBe('true');
      wait(1);

      // The first settle frame is where the turn is: the arrows, at its angle.
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0]).toEqual(settleArgs(from, to));
      expect(root().getAttribute('data-turning')).toBe('false');
      expect(layers()).toHaveLength(1);
      expect(paths()[0].getAttribute('d')).toBe(morphPath(ARROWS_STILL, 0));
      wait(208);
      expect(paths()[0].getAttribute('d')).toBe(morphPath(ARROWS_STILL, 0));

      wait(MORPH_MS - 208);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
      expect(keyframesOf(svg())).toBe('');
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  test('a stop during the press morph settles from the frame on screen', () => {
    const { update, paths } = setup({ glyph: 'cloud_done', turning: false });
    wait(160);
    update({ glyph: 'sync', turning: true });
    wait(208);
    const shown = paths()[0].getAttribute('d');
    // 0 to -90, 40% along its ease: -36 on screen.
    rotationProgress = 0.4;

    update({ glyph: 'sync', turning: false });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    expect(animate.mock.calls[1]).toEqual([
      [{ transform: 'rotate(-36deg)' }, { transform: 'rotate(-180deg)' }],
      { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'both' },
    ]);
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
  });

  // Its rings are the arrows, the "!" bar and dot; still arrows have no bar.
  test('a stop during a retry morph settles from the frame on screen, the "!" gone', () => {
    const error = vi.spyOn(console, 'error');
    const { update, paths } = setup({ glyph: 'sync_problem', turning: false });
    wait(160);
    update({ glyph: 'sync', turning: true });
    wait(208);
    const shown = paths()[0].getAttribute('d');
    rotationProgress = 0.4;

    update({ glyph: 'sync', turning: false });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    expect(animate.mock.calls[1]).toEqual([
      [{ transform: 'rotate(-36deg)' }, { transform: 'rotate(-180deg)' }],
      { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'both' },
    ]);
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(error).not.toHaveBeenCalled();
  });

  // Still arrows have only the two arrows, so every other ring shrinks where it is.
  test('a stop during a retry morph shrinks the "!" in place', () => {
    const { update, paths } = setup({ glyph: 'sync_problem', turning: false });
    wait(160);
    update({ glyph: 'sync', turning: true });
    wait(208);
    const shown = ringsOf(paths()[0].getAttribute('d'));
    expect(shown).toHaveLength(4);
    rotationProgress = 0.4;

    update({ glyph: 'sync', turning: false });
    wait(MORPH_MS / 2);
    const halfway = ringsOf(paths()[0].getAttribute('d'));
    expect(halfway).toHaveLength(4);
    for (const i of [2, 3]) {
      const [x0, y0] = centroidOf(shown[i]);
      const [x1, y1] = centroidOf(halfway[i]);
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(0.5);
    }
  });

  test('a press mid-failure-morph turns back from the frame on screen', () => {
    const { root, update, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(160);
    // On a spot, so it settles at once.
    turnFrom(svg(), 0.25);
    update({ glyph: 'sync_problem', turning: false });
    wait(150);
    const shown = paths()[0].getAttribute('d');
    // -90 to -180, half way along its ease: -135 on screen.
    rotationProgress = 0.5;

    update({ glyph: 'sync', turning: true });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    expect(animate.mock.calls[1]).toEqual(
      settleArgs(-135, -225, INTO_TURN_EASE)
    );
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(root().getAttribute('data-turning')).toBe('true');
    // The turn picks up at -225: 0.625 of the way round.
    expect(getComputedStyle(svg()).animationDelay).toBe(
      `-${0.625 * TURN_MS}ms`
    );
  });

  test('a stop under reduced motion changes nothing: there was no turn', () => {
    reduceMotion();
    const { update, layers, paths } = setup({ glyph: 'sync', turning: true });
    wait(160);
    update({ glyph: 'sync', turning: false });
    expect(animate).not.toHaveBeenCalled();
    expect(layers()).toHaveLength(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
  });

  // The 400 ms hold now outlasts the 300 ms morph, so the shown status lands after
  // it; a landing that does come mid-morph still starts from the frame on screen.
  test('a landing mid-press-morph starts from the frame on screen', () => {
    const { root, update, paths, svg } = setup({
      glyph: 'cloud_done',
      turning: false,
    });
    wait(160);
    update({ glyph: 'sync', turning: true });
    wait(208);
    const shown = paths()[0].getAttribute('d');
    expect(shown).not.toBe(morphPath(CLOUD_TO_ARROWS_AT_START, 0));
    // 0 to -90, 40% along its ease: turned -36 on screen.
    rotationProgress = 0.4;

    update({ glyph: 'cloud_done', turning: false });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    expect(animate.mock.calls[1]).toEqual([
      [{ transform: 'rotate(-36deg)' }, { transform: 'rotate(-180deg)' }],
      { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'both' },
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);

    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([CLOUD_DONE_PATH]);
    expect(root().getAttribute('data-turning')).toBe('false');
    expect(keyframesOf(svg())).toBe('');
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  test('a press mid-landing-morph starts from the frame on screen', () => {
    const { root, update, paths, svg } = setup({
      glyph: 'sync',
      turning: true,
    });
    wait(160);
    turnFrom(svg(), 0.25);
    update({ glyph: 'cloud_done', turning: false });
    wait(150);
    const shown = paths()[0].getAttribute('d');
    // -90 to -180, half way along its ease: -135 on screen.
    rotationProgress = 0.5;

    update({ glyph: 'sync', turning: true });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    // A quarter turn on from where it is.
    expect(animate.mock.calls[1]).toEqual(
      settleArgs(-135, -225, INTO_TURN_EASE)
    );

    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(root().getAttribute('data-turning')).toBe('true');
    // The turn picks up at -225: 0.625 of the way round.
    expect(getComputedStyle(svg()).animationDelay).toBe(
      `-${0.625 * TURN_MS}ms`
    );
  });

  test.each([
    // A landing at rest on -180 (from the spot at -90): on to -270.
    { progress: 1, from: -180, to: -270, delay: `-${0.75 * TURN_MS}ms` },
    // Part way from -90 to -180: -112.5 on screen.
    {
      progress: 0.25,
      from: -112.5,
      to: -202.5,
      delay: `-${(202.5 / 360) * TURN_MS}ms`,
    },
  ])(
    'a press with the landing at $from turns a quarter to $to and the turn picks up there',
    ({ progress, from, to, delay }) => {
      const { update, svg } = setup({ glyph: 'sync', turning: true });
      wait(160);
      turnFrom(svg(), 0.25);
      update({ glyph: 'cloud_done', turning: false });
      wait(150);
      rotationProgress = progress;

      update({ glyph: 'sync', turning: true });
      expect(animate.mock.calls[1][0]).toEqual([
        { transform: `rotate(${from}deg)` },
        { transform: `rotate(${to}deg)` },
      ]);
      wait(MORPH_MS);
      expect(getComputedStyle(svg()).animationDelay).toBe(delay);
    }
  );

  test('an unmount mid-morph cancels the rotation', () => {
    const { view, update } = setup({ glyph: 'sync', turning: true });
    wait(100);
    update({ glyph: 'cloud_done', turning: false });
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('reduced motion starts no rotation and swaps at once', () => {
    reduceMotion();
    const { update, paths, svg } = setup({ glyph: 'sync', turning: true });
    wait(100);
    turnFrom(svg(), 0.375);
    update({ glyph: 'cloud_done', turning: false });
    expect(animate).not.toHaveBeenCalled();
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([CLOUD_DONE_PATH]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Icon renderGlyph', () => {
  test('draws the glyph in place of the ligature, at the ligature size and colour', async () => {
    const { container } = await renderWithProviders(
      <Icon
        type="sync"
        size="40px"
        color="rgb(4, 5, 6)"
        onClick={() => {}}
        ariaLabel="Sync now"
        renderGlyph={(c) => (
          <SyncGlyph glyph="sync" turning={false} glyphCss={c} />
        )}
      />
    );
    const svg = one(container, '[data-glyph="sync"] svg');
    expect(getComputedStyle(svg).width).toBe('40px');
    expect(getComputedStyle(svg).height).toBe('40px');
    expect(getComputedStyle(svg).color).toBe('rgb(4, 5, 6)');
    expect(
      container.querySelectorAll('.material-symbols-outlined')
    ).toHaveLength(0);
  });

  test('CONTROL: without it the ligature draws as before', async () => {
    const { container } = await renderWithProviders(
      <Icon type="sync" onClick={() => {}} ariaLabel="Sync now" />
    );
    expect(
      container.querySelector('.material-symbols-outlined')?.textContent
    ).toBe('sync');
    expect(container.querySelector('[data-glyph]')).toBeNull();
  });
});
