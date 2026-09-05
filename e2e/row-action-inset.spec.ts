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
