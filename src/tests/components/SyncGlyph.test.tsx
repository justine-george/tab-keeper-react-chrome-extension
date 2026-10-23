import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { css } from '@emotion/react';

import Icon from '../../components/common/Icon';
import SyncGlyph from '../../components/common/SyncGlyph';
import type { IconName } from '../../components/common/iconNames';
import {
  CLOUD_DONE_PATH,
  MORPH_HALF_TURN,
  MORPH_UPRIGHT,
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

// The @keyframes rule an element's animation names, as emotion wrote it.
function keyframesOf(el: Element): string {
  const name = animationOf(el).split(' ')[0];
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
    fireEvent.animationEnd(fresh);
    fireEvent.animationEnd(one(old, 'svg'));
    expect(layers()).toHaveLength(2);

    fireEvent.animationEnd(old);
    expect(layers()).toEqual([fresh]);
    expect(root().querySelector('svg')).toBeNull();
  });

  // Reduced motion switched on mid-fade sets `animation: none`, which cancels it.
  test('a cancelled fade-out also removes its layer', () => {
    const { update, layers } = setup({ glyph: 'cloud_off', turning: false });
    wait(100);
    update({ glyph: 'sync_problem', turning: false });
    const [old, fresh] = layers();
    fireEvent(old, new Event('animationcancel', { bubbles: true }));
    expect(layers()).toEqual([fresh]);
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
    expect(paths()[0].getAttribute('d')).toBe(morphPath(MORPH_HALF_TURN, 0));

    wait(MORPH_MS - 1);
    expect(paths()[0].getAttribute('d')).not.toBe(CLOUD_DONE_PATH);
    wait(1);
    expect(paths().map((p) => p.getAttribute('d'))).toEqual([CLOUD_DONE_PATH]);

    // And back: the cloud flows into arrows whose turn starts a quarter in.
    wait(100);
    update({ glyph: 'sync', turning: true });
    expect(paths()[0].getAttribute('d')).toBe(morphPath(MORPH_UPRIGHT, 1));
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

// With Web Animations present: the settle turns from where the CSS turn is.
describe('SyncGlyph with Web Animations', () => {
  const cancel = vi.fn();
  const animate = vi.fn<
    (
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions
    ) => {
      cancel(): void;
    }
  >(() => ({ cancel }));

  beforeEach(() => {
    // Cleared here, not after: the last test's unmount runs after its afterEach.
    animate.mockClear();
    cancel.mockClear();
    vi.useFakeTimers();
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.useRealTimers();
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
    { progress: 0.4, from: -144, to: -360, pairs: MORPH_UPRIGHT },
    // 0.3 is -108: -180 is 72 ahead, so it settles a half turn round.
    { progress: 0.3, from: -108, to: -180, pairs: MORPH_HALF_TURN },
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

  test('into a still sync it turns a half', () => {
    const { update } = setup({ glyph: 'cloud_done', turning: false });
    wait(100);
    update({ glyph: 'sync', turning: false });
    expect(animate.mock.calls[0][0]).toEqual([
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-180deg)' },
    ]);
  });

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
