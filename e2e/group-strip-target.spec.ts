import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-231. The tab group's colour strip is the control that opens the colour
// picker -- role="button", tabIndex 0 -- and it painted 3px wide. Vertically it
// spans the whole group, so only the horizontal target was short of WCAG 2.2
// SC 2.5.8's 24x24, and the spacing exception did not apply: the title row and
// the member rows are targets a few pixels away.
//
// The strip keeps a FIXED footprint so its two widen cues -- hover and drop
// target -- spend from its own margin and never move the rows beside it.
// That footprint goes 9px -> 16px here (7 paint + 9 margin), and the click
// target reaches 24px by extending 8px LEFT into the window's container
// padding, which no row owns, rather than right into the favicons.
//
// Three options were rendered and measured before this one was picked; the
// numbers are on KAN-231. The short version: a 24px target that starts at the
// strip's left edge and reaches right lands 11px into every favicon under a
// 9px footprint, and 4px under a 16px one. Reaching LEFT lands on nothing.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const WINDOW = {
  windowId: 'w0',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 5,
  title: 'w0',
  tabs: [
    tab('l0'),
    tab('alpha0', 'alpha'),
    tab('alpha1', 'alpha'),
    tab('alpha2', 'alpha'),
    tab('l1'),
  ],
  chromeTabGroups: [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }],
};

const STRIP = '[data-band-id="alpha"] [data-group-color-strip]';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Strip target',
    isSelected: true,
    windowCount: 1,
    tabCount: WINDOW.tabs.length,
    windows: [WINDOW],
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator(STRIP)).toBeAttached();
  // PREMISE: the band only renders when the permission is granted.
  expect(
    await page.evaluate(() =>
      chrome.permissions.contains({ permissions: ['tabGroups'] })
    )
  ).toBe(true);
  // The strip TRANSITIONS its width (KAN-165). Let it land.
  await page.waitForTimeout(300);
  return page;
}

/** The strip's painted box and the group's content edge, in one read. */
const geometry = (page: Page) =>
  page.evaluate((sel) => {
    const strip = document.querySelector<HTMLElement>(sel)!;
    const band = strip.closest<HTMLElement>('[data-band-id]')!;
    const content = band.querySelector<HTMLElement>('[data-drag-row-id]')!;
    const s = strip.getBoundingClientRect();
    return {
      paint: Math.round(s.width),
      left: s.left,
      top: s.top,
      height: s.height,
      contentLeft: content.getBoundingClientRect().left,
    };
  }, STRIP);

/**
 * How many consecutive pixels, walking right from `fromX` along the strip's
 * vertical centre, resolve to the strip. `elementFromPoint` reports a
 * pseudo-element as its owner, so a ::after hit area counts as the strip.
 */
const hittableRun = (page: Page, fromX: number, y: number) =>
  page.evaluate(
    ([sel, fromX, y]) => {
      const strip = document.querySelector(sel)!;
      let run = 0;
      for (let x = fromX; x < fromX + 60; x += 1) {
        const hit = document.elementFromPoint(x + 0.5, y);
        if (hit !== strip && !strip.contains(hit)) break;
        run += 1;
      }
      return run;
    },
    [STRIP, fromX, y] as const
  );

test.describe('the group colour strip is a legal target (KAN-231)', () => {
  test('paints 7px at rest, 11 hovered, 16 as a drop target, and the rows never move', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const rest = await geometry(page);
    expect(rest.paint).toBe(7);
    // 16px footprint: the content edge sits exactly paint + margin from the
    // strip's left. Relative, so a change to the pane's own padding cannot
    // fail this for the wrong reason.
    expect(rest.contentLeft - rest.left).toBeCloseTo(16, 0);

    await page.locator(STRIP).hover();
    await page.waitForTimeout(300);
    const hover = await geometry(page);
    expect(hover.paint).toBe(11);
    expect(hover.contentLeft).toBe(rest.contentLeft);

    await page.mouse.move(700, 500);
    await page.evaluate(() =>
      document
        .querySelector('[data-band-id="alpha"]')!
        .setAttribute('data-drop-target', '')
    );
    await page.waitForTimeout(300);
    const drop = await geometry(page);
    expect(drop.paint).toBe(16);
    expect(drop.contentLeft).toBe(rest.contentLeft);
  });

  test('is at least 24px wide to a pointer, and reaches left into padding rather than right into the favicons', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const g = await geometry(page);
    const y = g.top + g.height / 2;

    // Walk from 12px left of the paint: the first pixels miss, then the run.
    const startX = g.left - 12;
    const misses = await page.evaluate(
      ([sel, startX, y]) => {
        const strip = document.querySelector(sel)!;
        let x = startX;
        while (x < startX + 12) {
          const hit = document.elementFromPoint(x + 0.5, y);
          if (hit === strip || strip.contains(hit)) break;
          x += 1;
        }
        return x - startX;
      },
      [STRIP, startX, y] as const
    );
    const firstHit = startX + misses;
    const run = await hittableRun(page, firstHit, y);

    expect(run).toBeGreaterThanOrEqual(24);
    // Starts LEFT of the paint, by the 8px the design claims. A pixel of
    // slack: the strip sits on a half pixel (435.5), and Chrome resolves a
    // hit on the boundary pixel to the box, so a 1px walk reads 9.
    expect(g.left - firstHit).toBeGreaterThanOrEqual(7.5);
    expect(g.left - firstHit).toBeLessThanOrEqual(9.5);
    // And ends AT the content edge, not past it: the next pixel belongs to
    // the row. That is what keeps favicon clicks opening tabs.
    expect(firstHit + run).toBeLessThanOrEqual(g.contentLeft + 0.5);

    // CONTROL: the row's own left edge is a member row, not the strip. Which
    // member depends on where the strip's vertical centre falls, so the
    // assertion is on the family and not on one id.
    const owner = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-drag-row-id]')
          ?.getAttribute('data-drag-row-id') ?? null,
      [g.contentLeft + 1, y] as const
    );
    expect(owner).toMatch(/^alpha\d$/);
  });

  // KAN-233. The widen was on :hover alone, so opening the picker and moving
  // to a swatch -- the one thing a click on the strip is for -- shrank the
  // strip back while its own menu was still open. The KAN-217 rule: the
  // control that owns an open menu holds its active state until it closes.
  test('stays widened while its picker is open, and rests once it closes', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const rest = await geometry(page);
    expect(rest.paint).toBe(7);

    await page.locator(STRIP).click();
    const swatch = page.getByRole('menuitemradio').nth(3);
    await expect(swatch).toBeVisible();
    // The pointer is now on a swatch, well off the strip.
    await swatch.hover();
    await page.waitForTimeout(300);

    const open_ = await geometry(page);
    expect(open_.paint).toBe(11);
    expect(open_.contentLeft).toBe(rest.contentLeft);

    // Escape closes the menu and hands focus back to the strip, so it stays
    // widened -- through :focus-visible now, not aria-expanded. That is the
    // right answer for a keyboard user, who needs to see where focus went.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator(STRIP)).toBeFocused();
    await page.waitForTimeout(300);
    expect((await geometry(page)).paint).toBe(11);

    // CONTROL: with the menu closed AND focus gone AND the pointer off it,
    // the strip rests. Without this, a strip stuck at 11 forever would pass
    // everything above.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.waitForTimeout(300);
    expect((await geometry(page)).paint).toBe(7);
  });

  // CONTROL for tab-group-join-preview.spec, which reads the strip's ::before
  // as its paint layer and falls back when there is none. The hit area is a
  // ::after precisely so that probe keeps falling back.
  test('the hit area is a ::after, and the strip still has no ::before', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const pseudo = await page.evaluate((sel) => {
      const strip = document.querySelector<HTMLElement>(sel)!;
      return {
        before: getComputedStyle(strip, '::before').content,
        after: getComputedStyle(strip, '::after').content,
        afterWidth: parseFloat(getComputedStyle(strip, '::after').width),
      };
    }, STRIP);

    expect(pseudo.before).toBe('none');
    expect(pseudo.after).not.toBe('none');
    expect(pseudo.afterWidth).toBe(24);
  });

  // The gate. The strip is a button, and its hit area now reaches into space
  // the window's tab list owns. Three things must be true: a click anywhere
  // in the hit area opens the picker; a DRAG gesture that starts there moves
  // no row; and a drag started on a member row still picks up that tab.
  //
  // The drag gesture in the band opens nothing either -- measured, that is
  // already true on the painted strip: the engine's click suppression
  // (KAN-177) swallows the click that follows any movement past the
  // activation distance. A drag is not a click, on a button or a row.
  test('a click in the hit area opens the picker, a drag there moves nothing, and a drag on a row still moves the tab', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const g = await geometry(page);
    // The tab rows only, in document order. The list also carries the session
    // row, the window row, the group row and an `items`-scope wrapper per
    // loose tab (`tab:l0`), so it is filtered to the ids that were seeded.
    const TAB_IDS = WINDOW.tabs.map((t) => t.tabId);
    const order = () =>
      page.evaluate(
        (ids) =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[data-drag-row-id]')
          )
            .map((el) => el.dataset.dragRowId!)
            .filter((id) => ids.includes(id)),
        TAB_IDS
      );
    const before = await order();
    expect(before).toEqual(['l0', 'alpha0', 'alpha1', 'alpha2', 'l1']);

    const a1 = (await page
      .locator('[data-drag-row-id="alpha1"]')
      .boundingBox())!;

    // A plain click 4px LEFT of the paint -- inside the hit area, over pixels
    // that were dead before -- opens the picker. This is the target claim.
    await page.mouse.click(g.left - 4, a1.y + a1.height / 2);
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // A press at the same point, dragged downward past the activation
    // distance: the pointer is on the strip, so no row is picked up, and
    // nothing moves.
    await page.mouse.move(g.left - 4, a1.y + a1.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.left - 4, a1.y + a1.height / 2 + 8);
    await page.mouse.move(g.left - 4, a1.y + a1.height * 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await order()).toEqual(before);

    // CONTROL: the same gesture on the row is a drag, and alpha1 moves below
    // alpha2. x is row + 60, the recipe every drag spec uses: row + 20 lands
    // on the favicon <img>, which is natively draggable and starts a browser
    // image drag that swallows the pointer stream before the engine sees it
    // (KAN-232, pre-existing and separate from this change).
    const l1 = (await page.locator('[data-drag-row-id="l1"]').boundingBox())!;
    const x = a1.x + 60;
    await page.mouse.move(x, a1.y + a1.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, a1.y + a1.height / 2 + 8);
    await page.mouse.move(x, l1.y + l1.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(order)
      .toEqual(['l0', 'alpha0', 'alpha2', 'alpha1', 'l1']);
  });
});
