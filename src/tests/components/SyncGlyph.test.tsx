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
} from '../../components/common/syncMorph.data';
import {
  easeInOutCubic,
  INTO_TURN_EASE,
  MORPH_MS,
  morphPath,
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

  test('draws sync and cloud_done as outlines and others as ligatures', () => {
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

    const ligature = setup({ glyph: 'sync_problem', turning: false });
    const span = one(ligature.root(), '.material-symbols-outlined');
    expect(span.textContent).toBe('sync_problem');
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
    update({ glyph: 'sync_problem', turning: false });

    expect(root().getAttribute('data-glyph')).toBe('sync_problem');
    const [old, fresh] = layers();
    expect(layers()).toHaveLength(2);
    expect(old.querySelector('path')?.getAttribute('d')).toBe(SYNC_PATH);
    expect(keyframesOf(old)).toMatch(/to\{opacity:0;?\}/);
    expect(animationOf(old)).toMatch(/ 200ms /);
    expect(fresh.textContent).toBe('sync_problem');
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
    const { update, layers } = setup({ glyph: 'cloud_off', turning: false });
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
    expect(layers()[0].textContent).toBe('sync_problem');
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
    expect(layers()[0].textContent).toBe('sync_problem');

    wait(100);
    update({ glyph: 'sync', turning: true });
    expect(root().getAttribute('data-turning')).toBe('false');
    expect(keyframesOf(svg())).toBe('');
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
    expect(fresh.textContent).toBe('sync_problem');
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

// The cloud's first frame as it starts to flow into arrows.
const CLOUD_TO_ARROWS_AT_START = CLOUD_DONE_UPRIGHT.map(({ to }) => ({
  from: to,
  to,
}));
// The upright arrows, unchanged from first frame to last.
const ARROWS_STILL = CLOUD_DONE_UPRIGHT.map(({ from }) => ({ from, to: from }));

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

  // The running CSS turn, as getAnimations() reports it, at a given progress.
  function turnAt(svg: Element, progress: number) {
    Object.defineProperty(svg, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          animationName: 'turn',
          effect: { getComputedTiming: () => ({ progress }) },
        },
      ],
    });
  }

  test.each([
    // 0.4 of a turn is -144 degrees: the next half-turn pose 45 ahead is -360, upright.
    { progress: 0.4, from: -144, to: -360, pairs: CLOUD_DONE_UPRIGHT },
    // 0.3 is -108: -180 is 72 ahead, so it settles a half turn round.
    { progress: 0.3, from: -108, to: -180, pairs: CLOUD_DONE_HALF_TURN },
  ])(
    'at $progress of a turn it settles from $from to $to degrees',
    ({ progress, from, to, pairs }) => {
      const { update, paths, svg } = setup({ glyph: 'sync', turning: true });
      // On a frame boundary, so the frames below land on known times.
      wait(160);
      turnAt(svg(), progress);
      update({ glyph: 'cloud_done', turning: false });

      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0]).toEqual([
        [
          { transform: `rotate(${from}deg)` },
          { transform: `rotate(${to}deg)` },
        ],
        { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'forwards' },
      ]);
      expect(paths()[0].getAttribute('d')).toBe(morphPath(pairs, 0));

      wait(208);
      expect(paths()[0].getAttribute('d')).toBe(
        morphPath(pairs, easeInOutCubic(208 / MORPH_MS))
      );

      expect(cancel).not.toHaveBeenCalled();
      wait(MORPH_MS - 208);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(paths().map((p) => p.getAttribute('d'))).toEqual([
        CLOUD_DONE_PATH,
      ]);
    }
  );

  test('into a turning sync it turns a quarter with the into-turn ease', () => {
    const { update } = setup({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'sync', turning: true });
    expect(animate.mock.calls[0]).toEqual([
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-90deg)' }],
      { duration: MORPH_MS, easing: INTO_TURN_EASE, fill: 'forwards' },
    ]);
  });

  // An edit after a sync: the cloud becomes still arrows where it stands.
  test('into a still sync it morphs without turning', () => {
    const { root, update, paths, svg } = setup({
      glyph: 'cloud_done',
      turning: false,
    });
    wait(100);
    update({ glyph: 'sync', turning: false });
    expect(animate.mock.calls[0]).toEqual([
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(0deg)' }],
      { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'forwards' },
    ]);
    expect(paths()[0].getAttribute('d')).toBe(
      morphPath(CLOUD_TO_ARROWS_AT_START, 0)
    );
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(root().getAttribute('data-turning')).toBe('false');
    expect(keyframesOf(svg())).toBe('');
  });

  test('a landing cut short into a still sync settles upright from the frame on screen', () => {
    const { update, paths, svg } = setup({ glyph: 'sync', turning: true });
    wait(160);
    turnAt(svg(), 0.4);
    update({ glyph: 'cloud_done', turning: false });
    wait(208);
    const shown = paths()[0].getAttribute('d');
    // -144 to -360, half way along its ease: -252 on screen.
    rotationProgress = 0.5;

    update({ glyph: 'sync', turning: false });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    expect(animate.mock.calls[1]).toEqual([
      [{ transform: 'rotate(-252deg)' }, { transform: 'rotate(-360deg)' }],
      { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'forwards' },
    ]);
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
  });

  // The 8 s offline stop, an edit mid-sync, a gate that closes: no snap to 0.
  test.each([
    // 0.4 of a turn is -144: -180 is 36 ahead, under 45, so on to -360.
    { progress: 0.4, from: -144, to: -360 },
    // 0.1 is -36: -180 is 144 ahead.
    { progress: 0.1, from: -36, to: -180 },
  ])(
    'a turn that stops at $from settles to $to with its shape unchanged',
    ({ progress, from, to }) => {
      const { root, update, layers, paths, svg } = setup({
        glyph: 'sync',
        turning: true,
      });
      wait(160);
      turnAt(svg(), progress);
      update({ glyph: 'sync', turning: false });

      // The first settle frame is the last turn frame: the arrows, at its angle.
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0]).toEqual([
        [
          { transform: `rotate(${from}deg)` },
          { transform: `rotate(${to}deg)` },
        ],
        { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'forwards' },
      ]);
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
      { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'forwards' },
    ]);
    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
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

  // A press shows at once and holds 400 ms, under the 420 ms morph: a quick sync
  // lands while the cloud is still flowing into arrows.
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
      { duration: MORPH_MS, easing: SETTLE_EASE, fill: 'forwards' },
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
    turnAt(svg(), 0.4);
    update({ glyph: 'cloud_done', turning: false });
    wait(208);
    const shown = paths()[0].getAttribute('d');
    // -144 to -360, half way along its ease: -252 on screen.
    rotationProgress = 0.5;

    update({ glyph: 'sync', turning: true });
    expect(paths()[0].getAttribute('d')).toBe(shown);
    // A quarter turn on from where it is.
    expect(animate.mock.calls[1]).toEqual([
      [{ transform: 'rotate(-252deg)' }, { transform: 'rotate(-342deg)' }],
      { duration: MORPH_MS, easing: INTO_TURN_EASE, fill: 'forwards' },
    ]);

    wait(MORPH_MS);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([SYNC_PATH]);
    expect(root().getAttribute('data-turning')).toBe('true');
    // The turn picks up at -342: 0.95 of the way round.
    expect(getComputedStyle(svg()).animationDelay).toBe('-950ms');
  });

  test.each([
    // A landing at rest on -180 (0.3 of a turn settles there): on to -270.
    { turn: 0.3, progress: 1, from: -180, to: -270, delay: '-750ms' },
    // Part way from -108 to -180: -126 on screen.
    { turn: 0.3, progress: 0.25, from: -126, to: -216, delay: '-600ms' },
  ])(
    'a press with the landing at $from turns a quarter to $to and the turn picks up there',
    ({ turn, progress, from, to, delay }) => {
      const { update, svg } = setup({ glyph: 'sync', turning: true });
      wait(160);
      turnAt(svg(), turn);
      update({ glyph: 'cloud_done', turning: false });
      wait(208);
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

  test('reduced motion starts no rotation', () => {
    reduceMotion();
    const { update } = setup({ glyph: 'sync', turning: true });
    wait(100);
    update({ glyph: 'cloud_done', turning: false });
    expect(animate).not.toHaveBeenCalled();
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
