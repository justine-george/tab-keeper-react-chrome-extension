import type { Locator, Page } from '@playwright/test';

// Per-frame samples of a layout change (KAN-984, KAN-987, KAN-988): where rows
// were on each animation frame, so a glide (in-between positions) can be told
// from a jump (none).

export interface Samples {
  [name: string]: number[];
}

// Each animation frame for `ms`, from now: every named element's top (for a
// name ending in ":h", its height; ":clip", whether it is clipped; ":copy",
// the top of the text in a leaving copy that reads its value; ":sh", its
// scroll height; ":op", its opacity), and how many leaving copies are drawn.
export async function startSampling(
  page: Page,
  targets: Record<string, string>,
  ms = 700
): Promise<void> {
  await page.evaluate(
    ({ targets, ms }) => {
      const out: Record<string, number[]> = { copies: [] };
      Object.keys(targets).forEach((k) => (out[k] = []));
      (window as unknown as { __samples: typeof out }).__samples = out;
      const end = performance.now() + ms;
      const tick = () => {
        for (const [name, sel] of Object.entries(targets)) {
          const el = name.endsWith(':copy')
            ? ([...document.querySelectorAll('[data-leaving-row] *')].find(
                (e) => e.childElementCount === 0 && e.textContent === sel
              ) ?? null)
            : document.querySelector(sel);
          const r = el?.getBoundingClientRect();
          // ":clip": 1 while the element is clipped, else 0.
          out[name].push(
            el === null || r === undefined
              ? NaN
              : name.endsWith(':clip')
                ? getComputedStyle(el).clipPath === 'none'
                  ? 0
                  : 1
                : name.endsWith(':op')
                  ? Number(getComputedStyle(el).opacity)
                  : name.endsWith(':h')
                    ? r.height
                    : name.endsWith(':sh')
                      ? el.scrollHeight
                      : r.top
          );
        }
        out.copies.push(document.querySelectorAll('[data-leaving-row]').length);
        if (performance.now() < end) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { targets, ms }
  );
}

export async function samples(page: Page): Promise<Samples> {
  await page.waitForFunction(() => {
    const s = (window as unknown as { __samples?: Samples }).__samples;
    return s !== undefined && s.copies.length > 20;
  });
  await page.waitForTimeout(750);
  return page.evaluate(
    () => (window as unknown as { __samples: Samples }).__samples
  );
}

// The frames drawn strictly between two places: a glide passes through them, a jump has none.
export const between = (values: number[], from: number, to: number): number[] =>
  values.filter(
    (v) => v > Math.min(from, to) + 2 && v < Math.max(from, to) - 2
  );

export async function topOf(loc: Locator): Promise<number> {
  return (await loc.boundingBox())?.y ?? NaN;
}
