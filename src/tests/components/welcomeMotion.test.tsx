import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import WelcomeHero from '../../components/modals/WelcomeHero';
import { playWelcomeLoop } from '../../components/modals/welcomeMotion';
import {
  GET_STARTED,
  SHUTTER_EASE,
  playGetStarted,
  type Animatable,
} from '../../components/modals/getStartedMotion';
import { renderWithProviders } from '../setup/renderWithProviders';

// §5 and §10: the loop's beats once, Get started's closing beat, all transform and opacity.

interface Played {
  el: Element;
  keyframes: Keyframe[];
  timing: KeyframeAnimationOptions;
  finished: boolean;
}
let played: Played[];
beforeEach(() => {
  played = [];
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(
      this: Element,
      keyframes: Keyframe[],
      timing: KeyframeAnimationOptions
    ) {
      const entry: Played = { el: this, keyframes, timing, finished: false };
      played.push(entry);
      return {
        finish: () => {
          entry.finished = true;
        },
        cancel: () => undefined,
        finished: Promise.resolve(),
      };
    },
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 44, 16)
  );
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
});

const end = (p: Played) =>
  Number(p.timing.delay ?? 0) + Number(p.timing.duration ?? 0);
const props = (p: Played) =>
  new Set(
    p.keyframes.flatMap((k) => Object.keys(k)).filter((k) => k !== 'offset')
  );

async function heroOf() {
  const { container } = await renderWithProviders(
    <WelcomeHero frame="start" />
  );
  const hero = container.querySelector<HTMLElement>('[data-hero-frame]');
  if (hero === null) throw new Error('no hero');
  return hero;
}

describe('the loop', () => {
  test('every beat plays once, ends by 2.4s, and moves only transform and opacity', async () => {
    playWelcomeLoop(await heroOf());
    expect(played).toHaveLength(21);
    expect(Math.max(...played.map(end))).toBe(2400);
    expect(played.every((p) => p.timing.iterations === undefined)).toBe(true);
    expect(
      played.every((p) =>
        [...props(p)].every((k) => k === 'transform' || k === 'opacity')
      )
    ).toBe(true);
  });

  test('a chip’s smallest scale is 0.35, and the arcs ease in and out', async () => {
    playWelcomeLoop(await heroOf());
    const arcs = played.filter((p) => p.el.matches('[data-hero-part="chip"]'));
    expect(arcs).toHaveLength(6);
    expect(arcs.every((p) => p.timing.easing === 'ease-in-out')).toBe(true);
    expect(String(arcs[0].keyframes[2].transform)).toMatch(/scale\(0\.35\)$/);
  });

  test('finish ends every beat at once', async () => {
    playWelcomeLoop(await heroOf()).finish();
    expect(played).toHaveLength(21);
    expect(played.every((p) => p.finished)).toBe(true);
  });
});

describe('Get started’s closing beat', () => {
  test('press 150ms, the shutter 250ms ease-in-out, then the exit 150ms ease-in to −8px', async () => {
    const fake = () => ({
      animate: vi.fn<Animatable['animate']>(() => ({
        finished: Promise.resolve(),
        cancel: () => undefined,
      })),
    });
    const parts = {
      button: fake(),
      shutter: fake(),
      dialog: fake(),
      onShutter: vi.fn(),
    };
    const motion = playGetStarted(parts);
    expect(await motion.finished).toBe(true);
    expect(GET_STARTED).toEqual({
      PRESS_MS: 150,
      SHUTTER_MS: 250,
      LEAVE_MS: 150,
    });
    expect(parts.shutter.animate.mock.calls[0][1]).toMatchObject({
      duration: 250,
      easing: SHUTTER_EASE,
    });
    expect(SHUTTER_EASE).toBe('ease-in-out');
    expect(parts.dialog.animate.mock.calls[0][0][1]).toMatchObject({
      opacity: 0,
      transform: 'translate(-50%, calc(-50% - 8px))',
    });
    expect(parts.dialog.animate.mock.calls[0][1]).toMatchObject({
      duration: 150,
      easing: 'ease-in',
    });
  });
});
