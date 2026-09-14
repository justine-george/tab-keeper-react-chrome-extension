import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-178. Two groups side by side, and a loose tab dropped BETWEEN them.
//
// The drop was always right; the PREVIEW was a whole row low. "Before the lower
// group's title row" resolves to the slot in front of it, and between adjacent
// groups that slot is the upper group's zero-height tail marker (KAN-176) --
// whose top is the bottom of the last member above it. So the ghost was drawn
// on the lower group's title row, reading as "this is going inside it", while
// the tab landed on the last member's top.
//
// What this pins is the KAN-158 rule: what the preview promises and what the
// release does must be the same place. Asserting the stored order alone would
// have passed against the bug, because the order was never wrong.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const TABS = [
  tab('top'),
  tab('newtab'),
  tab('a1', 'A'),
  tab('a2', 'A'),
  tab('b1', 'B'),
  tab('b2', 'B'),
  tab('b3', 'B'),
  tab('last'),
];
const START = 'top newtab a1*A a2*A b1*B b2*B b3*B last';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Group boundary',
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
        chromeTabGroups: [
          { groupId: 'A', title: 'A', color: 'grey' },
          { groupId: 'B', title: 'B', color: 'blue' },
        ],
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
  // goto resolves before React mounts (KAN-105), and the bands need the grant.
  await expect(page.locator('[data-band-id="B"]')).toBeAttached();
  return page;
}

const order = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windows: { tabs: { tabId: string; chromeGroupId?: string }[] }[];
      }[];
    };
    return data.tabGroups
      .find((g) => g.tabGroupId === 's1')!
      .windows[0].tabs.map(
        (t) => t.tabId + (t.chromeGroupId ? `*${t.chromeGroupId}` : '')
      )
      .join(' ');
  });

const boxOf = async (page: Page, selector: string) =>
  (await page.locator(selector).boundingBox())!;

// The slot the preview is drawing, read while the drag is live. Its own box
// carries no transition, so this is the commanded position, not an easing one.
const slotTop = (page: Page) =>
  page.evaluate(() => {
    const slot = document.querySelector('[data-drag-landing-slot]');
    return slot ? slot.getBoundingClientRect().top : null;
  });

// The preview quantises every shift to the held row's own footprint, which is
// 2px larger than a tab beside a band (KAN-167, deferred). So "the same place"
// is the same to within that, and 2px is the number the deferral names.
const QUANTISATION_PX = 2;

test.describe('a tab dropped between two adjacent groups', () => {
  test('lands where the preview said it would', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const bandA = await boxOf(page, '[data-band-id="A"]');
    const bandB = await boxOf(page, '[data-band-id="B"]');
    const held = await boxOf(page, '[data-drag-row-id="newtab"]');

    // PREMISE: the ungrouped strip between two adjacent bands really is the gap
    // between them, and the release below is inside it (KAN-179 is the separate
    // complaint that this target is only 2px).
    const gapTop = bandA.y + bandA.height;
    const gapBottom = bandB.y;
    expect(gapBottom - gapTop).toBeGreaterThan(0);
    const releaseY = gapTop + (gapBottom - gapTop) / 2;

    const x = held.x + 60;
    await page.mouse.move(x, held.y + held.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, held.y + held.height / 2 + 8);
    await page.mouse.move(x, releaseY, { steps: 10 });
    await page.waitForTimeout(280); // the 0.18s shift transition

    const promised = await slotTop(page);
    expect(promised).not.toBeNull();

    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toBe('top a1*A a2*A newtab b1*B b2*B b3*B last');

    // Where it actually came to rest, once the rows have settled.
    await page.waitForTimeout(280);
    const resting = await boxOf(page, '[data-drag-row-id="newtab"]');

    expect(Math.abs(resting.y - promised!)).toBeLessThanOrEqual(
      QUANTISATION_PX
    );
  });

  // CONTROL: the same assertion in the case that was never broken. Without it,
  // a probe that read the wrong element would fail both tests and say nothing
  // about the boundary.
  test('CONTROL: joining the lower group at its head also lands where promised', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const bandB = await boxOf(page, '[data-band-id="B"]');
    const held = await boxOf(page, '[data-drag-row-id="newtab"]');

    const releaseY = bandB.y + 10; // inside B's title row: join at the head
    const x = held.x + 60;
    await page.mouse.move(x, held.y + held.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, held.y + held.height / 2 + 8);
    await page.mouse.move(x, releaseY, { steps: 10 });
    await page.waitForTimeout(280);

    const promised = await slotTop(page);
    expect(promised).not.toBeNull();

    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toBe('top a1*A a2*A newtab*B b1*B b2*B b3*B last');

    await page.waitForTimeout(280);
    const resting = await boxOf(page, '[data-drag-row-id="newtab"]');

    expect(Math.abs(resting.y - promised!)).toBeLessThanOrEqual(
      QUANTISATION_PX
    );
  });

  test('CONTROL: the drop itself was never wrong', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await order(page)).toBe(START);
  });
});
