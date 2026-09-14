import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-186. The seam between a group's colour strip and its title row, while
// that group is the row being dragged.
//
// The strip keeps 9px of horizontal footprint however wide it is drawn: 3px of
// colour plus 6px of margin it grows into when the band is a drop target
// (KAN-164). That margin belongs to the BAND, and the band was transparent --
// so those 6px showed whatever was behind them. At rest that is the page and
// nobody can tell. Held, the row floats over the other rows, and the reported
// symptom was seeing a tab's favicon through the gap.
//
// Measured, resting and dragging alike: strip 435.5..438.5, the row's own fill
// starting at 444.5.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const WINDOWS = [
  {
    windowId: 'w1',
    windowHeight: 1080,
    windowWidth: 1920,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: 6,
    title: 'w1',
    tabs: [
      tab('a0'),
      tab('a1'),
      tab('be0', 'beta'),
      tab('be1', 'beta'),
      tab('ga0', 'gamma'),
      tab('a2'),
    ],
    chromeTabGroups: [
      { groupId: 'beta', title: 'Beta', color: 'red' },
      { groupId: 'gamma', title: 'Gamma', color: 'blue' },
    ],
  },
];

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Held group seam',
    isSelected: true,
    windowCount: 1,
    tabCount: WINDOWS[0].tabs.length,
    windows: WINDOWS,
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('[data-band-id="beta"]')).toBeAttached();
  return page;
}

const bandFill = (page: Page, groupId: string) =>
  page.evaluate(
    (groupId) =>
      getComputedStyle(document.querySelector(`[data-band-id="${groupId}"]`)!)
        .backgroundColor,
    groupId
  );

// The gap the fill has to cover: between the strip's right edge and the left
// edge of the title row's own background.
const seamWidth = (page: Page, groupId: string) =>
  page.evaluate((groupId) => {
    const band = document.querySelector(`[data-band-id="${groupId}"]`)!;
    const strip = band
      .querySelector('[data-group-color-strip]')!
      .getBoundingClientRect();
    const row = band
      .querySelector('[data-group-drag-handle]')!
      .getBoundingClientRect();
    return +(row.left - strip.right).toFixed(1);
  }, groupId);

async function grabGroup(page: Page, groupId: string) {
  const b = (await page
    .locator(`[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`)
    .boundingBox())!;
  const x = b.x + 40;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 8, { steps: 2 });
  await page.mouse.move(x, y - 60, { steps: 8 });
  await page.waitForTimeout(280);
  return x;
}

test.describe('the band behind a held group', () => {
  test('is filled, so nothing shows through beside the strip', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    // PREMISE: there is a seam to cover, and it is the strip's reserved margin.
    expect(await seamWidth(page, 'beta')).toBeGreaterThan(0);
    // At rest the band is transparent, which is what made this invisible until
    // the row was lifted over something.
    expect(await bandFill(page, 'beta')).toBe(TRANSPARENT);

    await grabGroup(page, 'beta');

    expect(await bandFill(page, 'beta')).not.toBe(TRANSPARENT);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // CONTROL: only the band being dragged. A rule that filled every band would
  // paint the whole pane on every drag, and would pass the test above.
  test('CONTROL: another group in the same window stays transparent', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    await grabGroup(page, 'beta');

    expect(await bandFill(page, 'gamma')).toBe(TRANSPARENT);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // CONTROL: and it lets go. The fill is tied to the held attribute, not to
  // anything the drag leaves behind.
  test('CONTROL: the fill goes when the drag ends', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    await grabGroup(page, 'beta');
    expect(await bandFill(page, 'beta')).not.toBe(TRANSPARENT);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(280);

    expect(await bandFill(page, 'beta')).toBe(TRANSPARENT);
  });
});
