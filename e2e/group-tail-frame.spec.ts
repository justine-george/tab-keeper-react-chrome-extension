import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-181. A group's frame while a tab lands immediately AFTER it.
//
// The band publishes its extent as `--frame-top` / `--frame-bottom` (KAN-171)
// and the colour strip is drawn from those, so the strip is what a user reads
// as "the drop will be inside this group". A tab dropped just past the last
// member is NOT going inside it, and the strip has to say so.
//
// The failure it pins: holding a tab from ABOVE, every member of the group
// rises by one row (the held row's space is gone) while the frame's bottom
// stays where it was, leaving the strip hanging a full row below the group's
// last member -- directly over the slot the tab is about to occupy.
//
// Measured rather than derived: the assertions compare the strip's bottom with
// the group's last member's DRAWN bottom, both read mid-drag.

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

// Sub-pixel slack only. Every number here is one measured box against another,
// not a prediction, so anything larger would hide the defect: it is a whole
// 32px row out.
const SLACK_PX = 2;

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Group tail frame',
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

// Group B's strip and its last member, as DRAWN at this instant.
const frameOf = (page: Page) =>
  page.evaluate(() => {
    const strip = document
      .querySelector('[data-band-id="B"] [data-group-color-strip]')!
      .getBoundingClientRect();
    const lastMember = document
      .querySelector('[data-drag-row-id="b3"]')!
      .getBoundingClientRect();
    return {
      stripBottom: strip.bottom,
      lastMemberBottom: lastMember.bottom,
      marked:
        document
          .querySelector('[data-band-id][data-drop-target]')
          ?.getAttribute('data-band-id') ?? 'none',
    };
  });

// Press `rowId` and hold the pointer at `y`, without releasing.
async function hold(page: Page, rowId: string, y: number) {
  const held = await boxOf(page, `[data-drag-row-id="${rowId}"]`);
  const x = held.x + 60;
  await page.mouse.move(x, held.y + held.height / 2);
  await page.mouse.down();
  // Past the activation distance first, so this is a drag and not a click.
  await page.mouse.move(x, held.y + held.height / 2 + (y > held.y ? 8 : -8));
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(280); // the 0.18s shift transition
}

test.describe("a group's frame while a tab lands after it", () => {
  test('stops at the last member when the tab is landing outside the group', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const b3 = await boxOf(page, '[data-drag-row-id="b3"]');

    // Just past the band, in the upper half of the trailing loose tab: an
    // ungrouped landing between the group and that tab.
    await hold(page, 'newtab', b3.y + b3.height + 6);

    const frame = await frameOf(page);
    // PREMISE: no group is claiming this drop.
    expect(frame.marked).toBe('none');
    expect(Math.abs(frame.stripBottom - frame.lastMemberBottom)).toBeLessThan(
      SLACK_PX
    );

    // And the release really does leave it outside the group.
    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toBe('top a1*A a2*A b1*B b2*B b3*B newtab last');
  });

  // CONTROL, and the one that makes the fix a rule rather than a subtraction:
  // a tab JOINING at the tail lands in the same slot, and there the frame is
  // supposed to reach past the drawn last member to cover the row the drop
  // will add (KAN-175). A fix that simply shrank the frame would fail here.
  test('CONTROL: joining at the tail still reaches past the last member', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const b3 = await boxOf(page, '[data-drag-row-id="b3"]');

    await hold(page, 'newtab', b3.y + b3.height - 8);

    const frame = await frameOf(page);
    expect(frame.marked).toBe('B');
    // A row's worth lower, not level with it.
    expect(frame.stripBottom - frame.lastMemberBottom).toBeGreaterThan(16);

    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toBe('top a1*A a2*A b1*B b2*B b3*B newtab*B last');
  });

  // CONTROL: coming from BELOW nothing above the landing moves, so the frame
  // is unchanged and level with the last member for a different reason. This
  // is the case that was already right, and it must stay right.
  test('CONTROL: from below, the frame stays where it rests', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const b3 = await boxOf(page, '[data-drag-row-id="b3"]');
    const restingStrip = (await frameOf(page)).stripBottom;

    await hold(page, 'last', b3.y + b3.height + 6);

    const frame = await frameOf(page);
    expect(frame.marked).toBe('none');
    expect(Math.abs(frame.stripBottom - restingStrip)).toBeLessThan(SLACK_PX);
    expect(Math.abs(frame.stripBottom - frame.lastMemberBottom)).toBeLessThan(
      SLACK_PX
    );

    await page.mouse.up();
  });

  // CONTROL: the group LOSING its last member. The frame has to follow the
  // members up here too, and it already did -- so this pins the machinery the
  // fix reuses rather than the fix itself.
  test('CONTROL: a member leaving the group takes the frame up with it', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const b3 = await boxOf(page, '[data-drag-row-id="b3"]');
    const restingStrip = (await frameOf(page)).stripBottom;

    await hold(page, 'b3', b3.y + b3.height + 46);

    const frame = await frameOf(page);
    expect(frame.marked).toBe('none');
    expect(restingStrip - frame.stripBottom).toBeGreaterThan(16);

    await page.mouse.up();
    await expect
      .poll(() => order(page))
      .toBe('top newtab a1*A a2*A b1*B b2*B last b3');
  });
});
