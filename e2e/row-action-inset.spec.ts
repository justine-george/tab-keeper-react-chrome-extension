import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-101. A hovered action icon met the row's border on some rows and sat
// inside it on others -- same build, same theme, same control.
//
// It was never a layout difference. Every row measured identically:
//
//   row  67.081  = 8 padding + 18.1818 title + 2 + 13.6364 counts
//                            + 5 + 12.2727 date + 8 padding
//   icon 66.5412 = 28 padding + 38.544 content
//
// The row's height is three `line-height: normal` line boxes, which are
// font-metric derived and never round. The icon's height is an unrelated
// stack: its own padding plus glyph plus label. The two landed 0.27px apart by
// COINCIDENCE, and 0.27px is below one device pixel -- so at a fractional
// devicePixelRatio (2.2 on the reporter's display) the same CSS rasterised to a
// 0px gap on some rows and 1px on others, and to 0 at the top and 1 at the
// bottom on one row, which read as lopsided.
//
// The fix is not to pick a nicer fraction. It is that the icon's height must be
// DERIVED FROM the row (`align-items: stretch`) rather than happening to come
// out near it, with the inset then stated as a margin. That is what these tests
// pin: not "the gap looks right", but "the gap is a number someone chose".
//
// Measured while choosing the value: no margin is stable at dpr 2.2 -- 1px
// gives 2/3 device px, 2px gives 4/5, 3px gives 6/7, 4px gives 8/9. Every
// option varies by one device pixel because the row positions are fractional.
// So the goal is not an exact device-pixel gap, which is unreachable; it is
// that the gap is stated in CSS and its minimum is comfortably above zero, so
// it can never read as "touching the border" on one row and not another.

/** Per side, in CSS px. Mirrors `ACTION_ICON_INSET` in TabGroupEntry.tsx. */
const INSET_PER_SIDE = 2;
const TOTAL_INSET = INSET_PER_SIDE * 2;

// Compared with toBeCloseTo(_, 0) -- within half a CSS pixel -- and NOT with
// exact equality. The row's height is snapped to the device pixel grid, so the
// leftover is the declared inset plus or minus a fraction of a pixel: measured
// at exactly 4 headless (dpr 1) and 3.9915 on a dpr 2.2 display. Asserting
// equality would pin this spec to dpr 1 and fail on any HiDPI runner.
//
// The tolerance costs nothing in sensitivity. The defect being guarded leaves a
// leftover of ~0.54 (icon sized by its own content) or, once the row grows, 17
// -- both are whole pixels away from 4, not fractions.

async function openWith(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(
    context,
    buildContainer([
      buildSession({ tabGroupId: 'first', title: 'First session' }),
      buildSession({ tabGroupId: 'second', title: 'Second session' }),
      buildSession({ tabGroupId: 'third', title: 'Third session' }),
    ])
  );
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

type RowMetric = { rowH: number; iconH: number; leftover: number };

/**
 * Every session row's height alongside its first action icon's height.
 *
 * Read in CSS pixels rather than device pixels on purpose. The SYMPTOM is a
 * device-pixel rounding flip, but that is display-dependent -- on an integer
 * DPR the same defect may round identically on every row and vanish, so a
 * device-pixel assertion would pass on CI and fail only on the reporter's
 * machine. The DEFECT is in CSS: a leftover nobody chose. That reproduces
 * everywhere.
 */
async function rowMetrics(page: Page): Promise<RowMetric[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-row-actions]')).map((block) => {
      const row = block.parentElement as HTMLElement;
      const icon = block.children[0] as HTMLElement;
      const rowH = row.getBoundingClientRect().height;
      const iconH = icon.getBoundingClientRect().height;
      return { rowH, iconH, leftover: Number((rowH - iconH).toFixed(4)) };
    })
  );
}

test.describe('a row action icon is inset by a stated amount', () => {
  test('every row leaves exactly the declared inset around its action icon', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const metrics = await rowMetrics(page);

    // CONTROL: there are rows to measure at all, and they have real height.
    // Without this an empty list would satisfy every assertion below.
    expect(metrics.length, 'the seeded sessions should render').toBe(3);
    expect(
      metrics.every((m) => m.rowH > 0 && m.iconH > 0),
      'rows and icons should have measurable height'
    ).toBe(true);

    for (const [i, m] of metrics.entries()) {
      expect(
        m.leftover,
        `row ${i} should leave exactly ${TOTAL_INSET}px around its icon ` +
          `(row ${m.rowH}, icon ${m.iconH}) -- a leftover that is not the ` +
          `declared inset means the icon is sized independently of the row ` +
          `and the remainder is a coincidence`
      ).toBeCloseTo(TOTAL_INSET, 0);
    }
  });

  // The assertion above pins the VALUE. This one pins that the value is
  // DERIVED -- which is the actual defect, and the half a fixed number alone
  // would not catch.
  //
  // A content-sized icon keeps its own height when the row grows, so the
  // leftover changes. An icon stretched to the row keeps the leftover constant
  // no matter what the row does. Growing the row is the only way to tell those
  // apart, and nothing in the seeded data changes row height on its own --
  // titles truncate to one line -- so the row is grown here directly.
  test('the inset holds when the row grows', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const before = await rowMetrics(page);

    await page.evaluate(() => {
      document.querySelectorAll('[data-row-actions]').forEach((block) => {
        const left = block.parentElement!.querySelector('button[aria-label]');
        (left as HTMLElement).style.paddingBottom = '24px';
      });
    });

    const after = await rowMetrics(page);

    // CONTROL: the rows actually got taller. If they did not, the assertion
    // below compares two identical measurements and cannot fail.
    for (const [i, m] of after.entries()) {
      expect(
        m.rowH,
        `row ${i} should have grown, otherwise this test proves nothing`
      ).toBeGreaterThan(before[i].rowH);
    }

    for (const [i, m] of after.entries()) {
      expect(
        m.leftover,
        `row ${i} should still leave exactly ${TOTAL_INSET}px after growing ` +
          `(row ${m.rowH}, icon ${m.iconH}) -- a leftover that moved with the ` +
          `row means the icon's height does not follow it`
      ).toBeCloseTo(TOTAL_INSET, 0);
    }
  });
});

// KAN-103. The same lesson one level out: the BLOCK's box must be the row's
// box, not a box computed to land near it.
//
// It used to be centred with `top: 50%` plus `transform: translateY(-50%)`.
// `top: 50%` is a layout value, quantised to 1/64px; the transform is a float
// from the element's own height. On a row height that makes those disagree the
// block sat 0.0036px above the row.
//
// That is far below a device pixel and would be harmless, except the mask is
// opaque and the row separator is immediately beneath it. At dpr 2.2 the
// block's bottom edge and the separator's top landed on the same device pixel,
// the mask antialiased over it, and the separator visibly broke where the strip
// began -- reported with a zoomed screenshot showing the line stopping dead at
// the strip's left edge.
test.describe('the action block takes its box from the row', () => {
  // Swept across many row heights rather than measured once, and that is the
  // whole design of this test.
  //
  // Whether the quantisation error appears at all depends on the row's exact
  // height: at an integer height the percentage and the transform cancel
  // perfectly and the defect is invisible. Headless rows are integers, so a
  // single measurement here would pass against the broken code and prove
  // nothing -- the same trap as asserting device pixels would have been.
  //
  // Measured live on the reporter's display: 11 of 17 sampled heights showed
  // the offset, 6 did not. Sweeping means the test does not depend on landing
  // on a pathological height by luck.
  test('the block matches the row at every row height', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);

    const samples = await page.evaluate(() => {
      const row = document.querySelectorAll('[data-row-actions]')[0]
        .parentElement as HTMLElement;
      const block = row.querySelector('[data-row-actions]') as HTMLElement;
      const left = row.querySelector('button[aria-label]') as HTMLElement;
      const out: { pad: number; rowH: number; top: number; bottom: number }[] =
        [];
      // Stepped in 1/64px -- Chrome's LayoutUnit -- and that is load-bearing.
      //
      // The first version of this swept in 1/16px steps and PASSED against the
      // broken code. Every height was then a multiple of 1/16, so its half was
      // a multiple of 1/32 and exactly representable, and `top: 50%` had
      // nothing to round. The defect only appears when half the row height is
      // NOT representable, which needs an ODD multiple of 1/64.
      //
      // Caught by reverting the fix and watching this test stay green. A sweep
      // that cannot produce the pathological height is not a sweep.
      for (let i = 0; i <= 32; i++) {
        const pad = i / 64;
        left.style.paddingBottom = `${pad}px`;
        const r = row.getBoundingClientRect();
        const b = block.getBoundingClientRect();
        out.push({
          pad,
          rowH: Number(r.height.toFixed(4)),
          top: Number((b.top - r.top).toFixed(4)),
          bottom: Number((b.bottom - r.bottom).toFixed(4)),
        });
      }
      left.style.paddingBottom = '';
      return out;
    });

    // CONTROL: the sweep really did change the row's height. Without this,
    // seventeen identical measurements would satisfy the assertion below.
    expect(
      new Set(samples.map((s) => s.rowH)).size,
      'the sweep should produce a range of row heights'
    ).toBeGreaterThan(8);

    const off = samples.filter((s) => s.top !== 0 || s.bottom !== 0);

    expect(
      off.length,
      `the block must sit exactly on the row at every height; ${off.length} ` +
        `of ${samples.length} sampled heights were off, e.g. row height ` +
        `${off[0]?.rowH} gave top ${off[0]?.top} bottom ${off[0]?.bottom}. ` +
        `An offset here is sub-pixel but the mask is opaque and the separator ` +
        `is directly beneath it, so it paints over the line.`
    ).toBe(0);
  });
});
