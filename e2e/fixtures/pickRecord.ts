import type { Locator, Page } from '@playwright/test';

// KAN-1024, KAN-1031. What a pick in a picker sets moving, read as Chrome
// holds it.

export interface Seen {
  /** 'page', or a choice's `<name> check`, `<name> frame` or `<name> cell`. */
  who: string;
  pseudo: string | null;
  duration: number;
  easing: string;
  keyframes: Array<Record<string, string | null>>;
}

// Records every animation that starts on the page from now on and runs. One
// gone within two frames was cancelled, not run: the hover's colour transition
// that a pick replaces.
export const record = (page: Page) =>
  page.evaluate(() => {
    const seen = new Map<Animation, { frames: number }>();
    const out: unknown[] = [];
    (window as unknown as { __seen: unknown[] }).__seen = out;
    const who = (el: Element | null): string => {
      if (el === document.documentElement) return 'page';
      const button = el?.closest('button[aria-pressed]');
      // The choice's name: its text, less the check's ligature.
      const name = (button?.textContent ?? '?').replace(/^check/, '').trim();
      if (el?.matches('[data-swatch-check]')) return `${name} check`;
      if (el?.matches('[aria-pressed] > div[aria-hidden="true"]'))
        return `${name} check`;
      if (el?.matches('[data-swatch-tile]')) return `${name} frame`;
      if (el === button) return `${name} cell`;
      return el?.tagName ?? '?';
    };
    const tick = () => {
      for (const a of document.getAnimations()) {
        const known = seen.get(a);
        if (known !== undefined) {
          known.frames++;
          continue;
        }
        const effect = a.effect as KeyframeEffect;
        const timing = effect.getTiming();
        const entry = {
          who: who(effect.target),
          pseudo: effect.pseudoElement,
          duration: Number(timing.duration),
          easing: String(timing.easing),
          keyframes: effect.getKeyframes().map((k) => ({
            opacity: (k.opacity as string) ?? null,
            transform: (k.transform as string) ?? null,
            visibility: (k.visibility as string) ?? null,
            borderColor: (k.borderColor as string) ?? null,
            filter: (k.filter as string) ?? null,
          })),
          frames: 1,
        };
        seen.set(a, entry);
        out.push(entry);
      }
      requestAnimationFrame(tick);
    };
    tick();
  });

export const seenSoFar = (page: Page): Promise<Seen[]> =>
  page.evaluate(() =>
    (window as unknown as { __seen: (Seen & { frames: number })[] }).__seen
      .filter((s) => s.frames > 2)
      .map((s) => ({ ...s, frames: undefined }))
  );

// Everything that started within half a second of a press on `target`. The
// pointer arrives first and settles, so its hover fade is not counted.
export async function afterPress(page: Page, target: Locator) {
  await target.hover();
  await page.waitForTimeout(300);
  await record(page);
  await target.click();
  await page.waitForTimeout(500);
  return seenSoFar(page);
}
