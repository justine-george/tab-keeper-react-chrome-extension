import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { contrast, pixelsAt } from './fixtures/pixels';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-188. The scrollbar thumb was close to invisible in every theme -- 1.08:1
// against its track on Light, where it was also LIGHTER than the track, and at
// most 1.28:1 elsewhere. Holding it looked exactly like hovering it, because
// App.css had no `:active` rule. In four themes the thumb was SELECTION_COLOR,
// so it merged into the selected session beside it.
//
// scrollbarLadder.test.ts holds the palette to the same rules. It cannot see
// whether App.css paints what the tokens say: a missing or misordered `:active`
// rule, or a custom property the stylesheet reads under a different name. So
// every assertion here is on PIXELS, never on a token or a computed style --
// KAN-22 verified that `--scrollbar-track` arrived and never looked at the
// paint, which is how this shipped.
//
// Two traps, both measured:
//   - Playwright's headless Chromium hides scrollbars, so this spec opts in
//     with `showScrollbars`. The bar-width check below is the control; without
//     it, a 0px bar would sample the rows and pass on any palette.
//   - Pixels are decoded in the page from a screenshot. The row-colour check
//     is the control that decoding is faithful: a colour-managed canvas that
//     shifted values could otherwise move a ratio across a threshold.

test.use({ showScrollbars: true });

// Values in settingsData.theme, as stored.
const THEMES = ['Light', 'WarmLight', 'BBPink', 'Darkenheimer', 'Blue'];

// The same rules, and the same reasons, as scrollbarLadder.test.ts.
const REST_FLOOR = 1.9;
const STEP = 1.2;
const FROM_SELECTION = 1.3;

interface ListGeometry {
  /** Horizontal centre of the vertical scrollbar. */
  barX: number;
  barWidth: number;
  trackTop: number;
  trackBottom: number;
  /** The row the list opens on, which is selected. */
  selected: { beside: number; y: number; fill: string };
  /** An unselected row, whose fill is the pane the thumb floats on. */
  plain: { centreX: number; y: number; fill: string };
}

async function measureList(page: Page): Promise<ListGeometry> {
  // Rows are found by role and accessible name (a session row is a button
  // named after its title, KAN-64) and handed into the page as elements.
  const first = await page
    .getByRole('button', { name: 'Session 0', exact: true })
    .elementHandle();
  const second = await page
    .getByRole('button', { name: 'Session 1', exact: true })
    .elementHandle();
  if (!first || !second) throw new Error('the seeded rows did not render');

  return page.evaluate(
    ([first, second]) => {
      const toHex = (rgb: string) =>
        '#' +
        (rgb.match(/\d+/g) ?? [])
          .slice(0, 3)
          .map((v) => Number(v).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();

      // The painted fill of a row: its own background, or the first ancestor's
      // that is not transparent.
      const fillOf = (el: Element | null): string => {
        for (let n = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent')
            return toHex(bg);
        }
        throw new Error('no painted ancestor');
      };

      let list: HTMLElement | null = first as HTMLElement;
      while (list && !/auto|scroll/.test(getComputedStyle(list).overflowY)) {
        list = list.parentElement;
      }
      if (!list) throw new Error('the session row is not inside a scroller');

      const cs = getComputedStyle(list);
      const rect = list.getBoundingClientRect();
      const borderL = parseFloat(cs.borderLeftWidth);
      const borderR = parseFloat(cs.borderRightWidth);
      const borderT = parseFloat(cs.borderTopWidth);
      const borderB = parseFloat(cs.borderBottomWidth);
      const barWidth = list.offsetWidth - list.clientWidth - borderL - borderR;
      const barLeft = rect.right - borderR - barWidth;

      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();

      return {
        barX: barLeft + barWidth / 2,
        barWidth,
        trackTop: rect.top + borderT,
        trackBottom: rect.bottom - borderB,
        selected: {
          beside: barLeft - 3,
          y: firstRect.top + firstRect.height / 2,
          fill: fillOf(first),
        },
        plain: {
          centreX: (secondRect.left + barLeft) / 2,
          y: secondRect.top + secondRect.height / 2,
          fill: fillOf(second),
        },
      };
    },
    [first, second] as const
  );
}

for (const theme of THEMES) {
  test.describe(`${theme}: the session list scrollbar`, () => {
    test('the thumb is visible, floats on the pane, and each state steps further from it', async ({
      context,
      extensionId,
    }) => {
      // Enough sessions that the list overflows several times over, so the
      // thumb is a fraction of the track and the bottom of the track is bare.
      //
      // `isSelected` on the session is what paints the selected row;
      // `selectedTabGroupId` alone does not. The first version of this spec
      // seeded only the id, so "the selected row" was an unselected one and
      // the merge assertion below compared the thumb against the pane twice.
      const sessions = Array.from({ length: 30 }, (_, i) =>
        buildSession({
          tabGroupId: `session-${i}`,
          title: `Session ${i}`,
          isSelected: i === 0,
        })
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
      await expect(
        page.getByRole('button', { name: 'Session 0', exact: true })
      ).toBeVisible();
      await page.mouse.move(0, 0);

      const g = await measureList(page);

      // CONTROL: there is a bar to measure. A 0px bar is the headless default
      // and would sample the rows instead.
      expect(g.barWidth, 'the scrollbar must actually render').toBe(10);

      const thumbY = g.trackTop + 4;
      const trackY = g.trackBottom - 4;

      const [plainPixel, thumb, beside, track] = await pixelsAt(page, [
        [g.plain.centreX, g.plain.y],
        [g.barX, thumbY],
        [g.selected.beside, thumbY],
        [g.barX, trackY],
      ]);

      // CONTROL: the decoded screenshot reports the colour the row paints.
      expect(
        plainPixel,
        'pixel decoding must be faithful before any ratio is trusted'
      ).toBe(g.plain.fill);

      // CONTROL: the thumb sample sits beside the selected row, which is what
      // the merge assertion below is about.
      expect(
        beside,
        'the sample beside the thumb must be the selected row'
      ).toBe(g.selected.fill);

      const pane = g.plain.fill;

      // CONTROL: the row beside the thumb really is selected. Without this, a
      // seed that selects nothing makes the merge assertion below measure the
      // thumb against the pane a second time and pass for the wrong reason.
      expect(
        g.selected.fill,
        'the first row must paint the selection fill, not the pane'
      ).not.toBe(pane);

      expect(
        contrast(track, pane),
        `the track ${track} shows against the pane ${pane}`
      ).toBeLessThanOrEqual(1.01);

      const rest = contrast(thumb, pane);
      expect(
        rest,
        `the thumb ${thumb} is ${rest.toFixed(2)}:1 against the pane ${pane}`
      ).toBeGreaterThanOrEqual(REST_FLOOR);

      expect(
        contrast(thumb, g.selected.fill),
        `the thumb ${thumb} merges into the selected row ${g.selected.fill}`
      ).toBeGreaterThanOrEqual(FROM_SELECTION);

      await page.mouse.move(g.barX, thumbY);
      const [hovered] = await pixelsAt(page, [[g.barX, thumbY]]);
      const hover = contrast(hovered, pane);
      expect(
        hover,
        `hovered thumb ${hovered} is ${hover.toFixed(2)}:1 from the pane, ` +
          `rest was ${rest.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(rest * STEP);

      await page.mouse.down();
      const [heldPixel] = await pixelsAt(page, [[g.barX, thumbY]]);
      await page.mouse.up();
      const held = contrast(heldPixel, pane);
      expect(
        held,
        `held thumb ${heldPixel} is ${held.toFixed(2)}:1 from the pane, ` +
          `hover was ${hover.toFixed(2)}:1 -- holding looks like hovering`
      ).toBeGreaterThanOrEqual(hover * STEP);
    });
  });
}
