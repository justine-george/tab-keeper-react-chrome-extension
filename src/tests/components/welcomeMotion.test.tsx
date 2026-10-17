import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import WelcomeHero from '../../components/modals/WelcomeHero';
import { playWelcomeLoop, heroPx } from '../../components/modals/welcomeMotion';
import { renderWithProviders } from '../setup/renderWithProviders';

// §5 and §10: the loop's chips shrink, ease and land home at any size.

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

async function heroOf() {
  const { container } = await renderWithProviders(
    <WelcomeHero frame="start" />
  );
  const hero = container.querySelector<HTMLElement>('[data-hero-frame]');
  if (hero === null) throw new Error('no hero');
  return hero;
}

describe('the loop', () => {
  test('a chip’s smallest scale is 0.35, and the arcs ease in and out', async () => {
    playWelcomeLoop(await heroOf());
    const arcs = played.filter((p) => p.el.matches('[data-hero-part="chip"]'));
    expect(arcs).toHaveLength(6);
    expect(arcs.every((p) => p.timing.easing === 'ease-in-out')).toBe(true);
    expect(String(arcs[0].keyframes[2].transform)).toMatch(/scale\(0\.35\)$/);
  });

  test('arcs undo an ancestor’s scale, so a chip at half size still lands home', async () => {
    const hero = await heroOf();
    const firstLanding = () =>
      String(
        played.find((p) => p.el.matches('[data-hero-part="chip"]'))
          ?.keyframes[2].transform
      );
    vi.spyOn(hero, 'offsetWidth', 'get').mockReturnValue(44);
    playWelcomeLoop(hero);
    // Into the slot, its own depth below the slot's top; twice that at half size.
    const into = heroPx(10);
    expect(firstLanding()).toMatch(
      new RegExp(`^translate\\(0px, ${into}px\\)`)
    );
    played = [];
    vi.spyOn(hero, 'offsetWidth', 'get').mockReturnValue(88);
    playWelcomeLoop(hero);
    expect(firstLanding()).toMatch(
      new RegExp(`^translate\\(0px, ${2 * into}px\\)`)
    );
  });
});
