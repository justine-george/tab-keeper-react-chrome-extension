import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-360 at a 20px root, which is what Chrome's "Large" font size sets: every
// rem scales, so a tab row is 38px tall -- but a group's title row stays 32.
// The one place the tab list's slots are not one height.
//
// A tab joining a group at its head from ABOVE lands after that title row, so
// the slot it is drawn in is measured against a slot shorter than itself.
// Before KAN-360 the slot was drawn on the title row's top, 6px below where the
// tab came to rest (measured: slot 252, landed 246) -- the difference between
// the two heights. Measured bottom to bottom it is exact.
//
// Saved session, 790x550. One window: x0 x1, the group Gee (g0 g1), y0 y1.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});
const TABS = [
  tab('x0'),
  tab('x1'),
  tab('g0', 'g'),
  tab('g1', 'g'),
  tab('y0'),
  tab('y1'),
];

async function open(
  context: import('@playwright/test').BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 's',
        title: 'Large',
        isSelected: true,
        windowCount: 1,
        tabCount: TABS.length,
        windows: [
          {
            windowId: 'win',
            windowHeight: 1080,
            windowWidth: 1920,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: TABS.length,
            title: 'W',
            tabs: TABS,
            chromeTabGroups: [{ groupId: 'g', title: 'Gee', color: 'blue' }],
          },
        ],
      }),
    ]),
    selectedTabGroupId: 's',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105).
  await expect(page.locator('[data-drag-row-id="y1"]')).toBeAttached();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px';
  });
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize
    )
  ).toBe('20px');
  await settled(page);
  // PREMISE: the slots really are two heights here.
  const row = await boxOf(page, '[data-drag-row-id="x1"]');
  const title = await boxOf(page, '[data-fixed-row-id="g"]');
  expect(row.height).toBeGreaterThan(title.height + 1);
  return page;
}

async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    for (;;) {
      const running = document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition && a.playState === 'running');
      if (running.length === 0) return;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
      await frame();
    }
  });
}

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not drawn`);
  return box;
}

// The drawn order, a member of Gee marked with *: x1 joined, or x1 loose.
const drawn = (page: Page) =>
  page.evaluate(() =>
    ['x0', 'x1', 'g0', 'g1', 'y0', 'y1']
      .flatMap((id) => {
        const el = document.querySelector(`[data-drag-row-id="${id}"]`);
        if (el === null) return [];
        const joined = el.closest('[data-band-id="g"]') !== null;
        return [
          { id: id + (joined ? '*' : ''), top: el.getBoundingClientRect().top },
        ];
      })
      .sort((a, b) => a.top - b.top)
      .map((r) => r.id)
      .join(' ')
  );

// Hold x1 down onto `aim` (a fraction of a row's box, measured at rest),
// read the slot, release, and return the slot's top and where x1 came to rest.
async function dragX1(page: Page, aimRow: string, frac: number) {
  const from = await boxOf(page, '[data-drag-row-id="x1"]');
  const x = from.x + 60;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 6, { steps: 2 });
  await expect(page.locator('[data-drag-landing-slot]')).toBeAttached();
  const aim = await boxOf(page, `[data-drag-row-id="${aimRow}"]`);
  await page.mouse.move(x, aim.y + aim.height * frac, { steps: 12 });
  await settled(page);
  const slot = await boxOf(page, '[data-drag-landing-slot]');
  await page.mouse.up();
  await settled(page);
  const landed = await boxOf(page, '[data-drag-row-id="x1"]');
  return { slot: slot.y, landed: landed.y };
}

test.describe('at a 20px root, a tab is shown landing where it lands', () => {
  test('joining a group at its head from above', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    // Over the band, between its title row and g0's midpoint.
    const { slot, landed } = await dragX1(page, 'g0', 0.25);
    await expect.poll(() => drawn(page)).toBe('x0 x1* g0* g1* y0 y1');
    console.log(`join at head @20px: slot ${slot}, landed ${landed}`);
    expect(Math.abs(slot - landed)).toBeLessThanOrEqual(1);
  });

  // CONTROL: past the whole group, the slot passed is a 38px tab row like the
  // held one, so this was never wrong.
  test('CONTROL: dragged down past the group', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    // On y0's upper quarter: outside the band, past g1's midpoint.
    const { slot, landed } = await dragX1(page, 'y0', 0.25);
    await expect.poll(() => drawn(page)).toBe('x0 g0* g1* x1 y0 y1');
    console.log(`past the group @20px: slot ${slot}, landed ${landed}`);
    expect(Math.abs(slot - landed)).toBeLessThanOrEqual(1);
  });
});
