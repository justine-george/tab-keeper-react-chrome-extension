import type { BrowserContext, Page } from '@playwright/test';

// KAN-1033. Every animation the page starts from now on, as Chrome holds it:
// its target (tag and data- hooks), timing and keyframes. Unlike pickRecord it
// keeps every property a keyframe names, height and translate included.

export interface Motion {
  /** Tag, then the target's data- attribute names, e.g. `DIV[data-coach-dim]`. */
  who: string;
  duration: number;
  delay: number;
  easing: string;
  iterations: number;
  origin: string;
  keyframes: Array<Record<string, string>>;
}

function install(): void {
  const out: unknown[] = [];
  const seen = new Set<Animation>();
  Object.defineProperty(window, '__motions', {
    value: out,
    configurable: true,
  });
  const who = (el: Element | null): string => {
    if (el === null) return '?';
    const hooks = [...el.attributes]
      .map((a) => a.name)
      .filter((name) => name.startsWith('data-'))
      .sort();
    return el.tagName + hooks.map((h) => `[${h}]`).join('');
  };
  const tick = () => {
    for (const a of document.getAnimations()) {
      if (seen.has(a)) continue;
      seen.add(a);
      const effect = a.effect as KeyframeEffect | null;
      if (effect === null) continue;
      const timing = effect.getTiming();
      const target = effect.target;
      out.push({
        who: who(target),
        duration: Number(timing.duration),
        delay: Number(timing.delay ?? 0),
        easing: String(timing.easing),
        iterations: Number(timing.iterations ?? 1),
        origin: target ? getComputedStyle(target).transformOrigin : '',
        keyframes: effect.getKeyframes().map((k) => {
          const frame: Record<string, string> = {};
          for (const [key, value] of Object.entries(k)) {
            if (
              ['offset', 'computedOffset', 'easing', 'composite'].includes(key)
            )
              continue;
            frame[key] = String(value);
          }
          return frame;
        }),
      });
    }
    requestAnimationFrame(tick);
  };
  tick();
}

/** Starts recording in this page now. */
export const recordMotion = (page: Page) => page.evaluate(install);

/** Records in every page from its first script on. */
export const recordMotionFromStart = (context: BrowserContext) =>
  context.addInitScript(install);

export const motions = (page: Page): Promise<Motion[]> =>
  page.evaluate(() => (window as unknown as { __motions: Motion[] }).__motions);

/** The recorded motions whose target matches `who` (a substring of it). */
export const motionsOf = async (page: Page, who: string) =>
  (await motions(page)).filter((m) => m.who.includes(who));
