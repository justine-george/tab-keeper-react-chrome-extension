import { test, expect } from './fixtures/extension';
import { contrast, pixelsAt, rgbToHex } from './fixtures/pixels';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// The line between sessions was BORDER_COLOR: near-black on Light, 7.54:1
// against the pane, and visibly cut off where it stops at the scrollbar
// gutter. It is now its own quieter token. dividerContrast.test.ts holds the
// palette to that; this holds the PAINT to it, which is the only thing that
// catches <Divider/> still drawing BORDER_COLOR while the token sits unused.
//
// Measured against the scrollbar thumb painted beside it, not against a
// literal: "clearly quieter than the control next to it" is the design rule,
// and both halves come from the same screenshot.

test.use({ showScrollbars: true });

// Values in settingsData.theme, as stored.
const THEMES = ['Light', 'WarmLight', 'BBPink', 'Darkenheimer', 'Blue'];

// The same rules, and the same reasons, as dividerContrast.test.ts.
const VISIBLE_FLOOR = 1.2;
const QUIETER_THAN_THUMB = 1.3;

for (const theme of THEMES) {
  test(`${theme}: the line between sessions is visible and quieter than the scrollbar thumb`, async ({
    context,
    extensionId,
  }) => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      buildSession({ tabGroupId: `session-${i}`, title: `Session ${i}` })
    );
    await seedSessions(context, {
      ...buildContainer(sessions),
      selectedTabGroupId: 'session-0',
    });
    await seedSettings(context, {
      theme,
      isNeverAskAgainForTabGroups: true,
      isNeverAskAgainToRate: true,
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // The barrier: goto resolves before the popup has mounted.
    await expect(
      page.getByRole('button', { name: 'Session 29', exact: true })
    ).toBeAttached();
    const row = page.getByRole('button', { name: 'Session 1', exact: true });
    await expect(row).toBeVisible();
    await page.mouse.move(0, 0);

    const handle = await row.elementHandle();
    if (!handle) throw new Error('the seeded row did not render');

    // An UNSELECTED row, so the fill above its divider is the pane itself.
    const g = await handle.evaluate((el) => {
      let list: HTMLElement | null = el as HTMLElement;
      while (list && !/auto|scroll/.test(getComputedStyle(list).overflowY)) {
        list = list.parentElement;
      }
      if (!list) throw new Error('the session row is not inside a scroller');

      const rowRect = el.getBoundingClientRect();
      const divider = [...list.querySelectorAll<HTMLElement>('div')]
        .filter((d) => {
          const cs = getComputedStyle(d);
          return (
            d.childElementCount === 0 &&
            parseFloat(cs.borderBottomWidth) === 1 &&
            d.getBoundingClientRect().height === 1
          );
        })
        .map((d) => d.getBoundingClientRect())
        .filter((r) => r.top >= rowRect.bottom - 1)
        .sort((a, b) => a.top - b.top)[0];
      if (!divider) throw new Error('no divider below the row');

      let fill = 'rgba(0, 0, 0, 0)';
      for (
        let n: HTMLElement | null = el as HTMLElement;
        n;
        n = n.parentElement
      ) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          fill = bg;
          break;
        }
      }

      const cs = getComputedStyle(list);
      const rect = list.getBoundingClientRect();
      const borderL = parseFloat(cs.borderLeftWidth);
      const borderR = parseFloat(cs.borderRightWidth);
      const barWidth = list.offsetWidth - list.clientWidth - borderL - borderR;
      return {
        lineX: divider.left + divider.width / 2,
        lineY: divider.top,
        rowFill: fill,
        barWidth,
        barX: rect.right - borderR - barWidth / 2,
        thumbY: rect.top + parseFloat(cs.borderTopWidth) + 4,
      };
    });

    // CONTROL: there is a thumb to compare against. Headless hides scrollbars
    // by default, and a 0px bar would sample the row instead.
    expect(g.barWidth, 'the scrollbar must actually render').toBe(10);

    const [line, above, thumb] = await pixelsAt(page, [
      [g.lineX, g.lineY],
      [g.lineX, g.lineY - 3],
      [g.barX, g.thumbY],
    ]);
    const pane = rgbToHex(g.rowFill);

    // CONTROL: decoding is faithful, and the sample above the line is the
    // unselected row, which paints the pane.
    expect(above, 'pixel decoding must match the row fill').toBe(pane);

    // CONTROL: the line sample actually landed on the line.
    expect(line, 'the sample must land on the divider, not the row').not.toBe(
      pane
    );

    const lineRatio = contrast(line, pane);
    const thumbRatio = contrast(thumb, pane);

    expect(
      lineRatio,
      `the divider ${line} is only ${lineRatio.toFixed(2)}:1 against the ` +
        `pane ${pane}`
    ).toBeGreaterThanOrEqual(VISIBLE_FLOOR);

    expect(
      lineRatio * QUIETER_THAN_THUMB,
      `the divider ${line} is ${lineRatio.toFixed(2)}:1 against the pane and ` +
        `the thumb ${thumb} only ${thumbRatio.toFixed(2)}:1 -- the line is ` +
        `the louder one`
    ).toBeLessThanOrEqual(thumbRatio);
  });
}
