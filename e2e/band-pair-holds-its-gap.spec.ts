// KAN-612. While rows slide, a band's frame grows by trading its margin for
// padding (GroupFrameFollower), which must move nothing. Between two adjacent
// bands it did: their margins COLLAPSE into one 8px gap, and swapping the upper
// band's 2px bottom margin for -30px collapses to 8 - 30, so with 32px of
// padding the pair sat 10px apart. Every row under each such pair rode 2px low,
// and the slot, drawn inside the held row below them, with it.
//
// Measured on main at 790x550, 2026-10-15: the slot 4px below the room the
// rows opened, overlapping Beta's title row by 2px.

import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { boxOf } from './fixtures/sessionDrag';

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

// a0 [Beta: b0 b1] [Gamma: g0 g1] [Delta: d0 d1] z0 -- three bands back to
// back.
const TABS = [
  tab('a0'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('g0', 'gamma'),
  tab('g1', 'gamma'),
  tab('d0', 'delta'),
  tab('d1', 'delta'),
  tab('z0'),
];
const GROUPS = [
  { groupId: 'beta', title: 'Beta', color: 'blue' },
  { groupId: 'gamma', title: 'Gamma', color: 'green' },
  { groupId: 'delta', title: 'Delta', color: 'orange' },
];

async function open(context: BrowserContext, extensionId: string) {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Band pairs',
    isSelected: true,
    windowCount: 1,
    tabCount: TABS.length,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: TABS.length,
        title: 'w1',
        tabs: TABS,
        chromeTabGroups: GROUPS,
      },
    ],
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('[data-band-id="delta"]')).toBeVisible();
  // PREMISE: the pane does not scroll, so nothing moves the rows but the drag.
  expect(
    await page.evaluate(() => {
      let el = document.querySelector('[data-drag-row-id="w1"]');
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      if (el === null) throw new Error('no scroller above the window');
      return el.scrollHeight <= el.clientHeight;
    })
  ).toBe(true);
  return page;
}

// Where each tab row sits IN LAYOUT: its box less the transform the preview
// slides it by. Only a reflow changes that -- a band growing its own box, by
// design, moves no row.
const layoutTops = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('[data-window-tabs]');
    if (list === null) throw new Error('no tab list');
    const base = list.getBoundingClientRect().top;
    return Object.fromEntries(
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-window-tabs] [data-drag-row-id]'
        ),
      ]
        .flatMap((el) => {
          const id = el.dataset.dragRowId ?? ':';
          return id.includes(':') ? [] : [{ el, id }];
        })
        .map(({ el, id }) => [
          id,
          el.getBoundingClientRect().top -
            base -
            new DOMMatrix(getComputedStyle(el).transform).m42,
        ])
    );
  });

const rectOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) throw new Error(`nothing at ${s}`);
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  }, selector);

test('a band sliding past another keeps their gap, and the slot sits in the room the rows open', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  const resting = await layoutTops(page);

  // d1 up into the loose room under a0: every band slides down a row.
  const d1 = await boxOf(page.locator('[data-drag-row-id="d1"]'));
  const a0 = await boxOf(page.locator('[data-drag-row-id="a0"]'));
  await page.mouse.move(d1.x + 60, d1.y + d1.height / 2);
  await page.mouse.down();
  await page.mouse.move(d1.x + 60, d1.y + d1.height / 2 - 8);
  await page.mouse.move(d1.x + 60, a0.y + a0.height * 0.75, { steps: 10 });
  // Rows ease over 0.18s; read them at rest.
  await page.waitForTimeout(400);

  // PREMISE: a loose landing, with every band below it slid.
  expect(await page.locator('[data-band-id][data-drop-target]').count()).toBe(
    0
  );

  expect.soft(await layoutTops(page)).toEqual(resting);
  const slot = await rectOf(page, '[data-drag-landing-slot]');
  const above = await rectOf(page, '[data-drag-row-id="a0"]');
  const beta = await rectOf(
    page,
    '[data-band-id="beta"] [data-group-drag-handle]'
  );
  expect(slot.top).toBe(above.bottom);
  expect(slot.bottom).toBeLessThanOrEqual(beta.top);

  await page.keyboard.press('Escape');
  await page.mouse.up();
});

// The other side: a tab from above joining Gamma at its head slides Gamma's
// title up, which grows the band UPWARD, under Beta -- the same trade at the
// top margin, with the same collapse in it.
test('a band growing up under another keeps their gap, and the slot sits at its head', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  const resting = await layoutTops(page);

  const a0 = await boxOf(page.locator('[data-drag-row-id="a0"]'));
  const g0 = await boxOf(page.locator('[data-drag-row-id="g0"]'));
  await page.mouse.move(a0.x + 60, a0.y + a0.height / 2);
  await page.mouse.down();
  await page.mouse.move(a0.x + 60, a0.y + a0.height / 2 + 8);
  await page.mouse.move(a0.x + 60, g0.y + g0.height * 0.25, { steps: 10 });
  await page.waitForTimeout(400);

  // PREMISE: Gamma is the landing, and it grew upward.
  await expect(
    page.locator('[data-band-id][data-drop-target]')
  ).toHaveAttribute('data-band-id', 'gamma');
  expect(
    await page
      .locator('[data-band-id="gamma"]')
      .evaluate((band) => (band as HTMLElement).style.paddingTop)
  ).toBe('32px');

  expect.soft(await layoutTops(page)).toEqual(resting);
  const slot = await rectOf(page, '[data-drag-landing-slot]');
  const title = await rectOf(
    page,
    '[data-band-id="gamma"] [data-group-drag-handle]'
  );
  expect(slot.top).toBe(title.bottom);

  await page.keyboard.press('Escape');
  await page.mouse.up();
});
