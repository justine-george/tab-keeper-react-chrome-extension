import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-179. Two groups sitting next to each other, and the place BETWEEN them.
//
// Every pixel inside a band means "release here and join that group" (KAN-164),
// so the only place a tab can land ungrouped between two adjacent groups is the
// gap between the two bands. Measured in the popup, that gap was 2px: each band
// carries `margin: 2px 0`, and two adjacent margins COLLAPSE to the larger of
// the two rather than adding up. A 2px target, reported from the real popup as
// "only a brief space that I have to finagle".
//
// What this pins is the TARGET, in both of the ways it can regress: the gap
// itself, and what a release inside it does. The controls pin the two things
// that must NOT move -- a release inside a band still joins that group, and a
// band beside a loose tab keeps its original spacing.

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
const BETWEEN_THE_GROUPS = 'top a1*A a2*A newtab b1*B b2*B b3*B last';

// The gap the layout has to open between two adjacent bands. The probes below
// are placed strictly inside it, so with the old 2px gap every one of them
// falls inside a band instead and the drop joins a group.
const TARGET_PX = 8;

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Adjacent groups',
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

// Drag `newtab` and release it at `releaseY`.
async function dropAt(page: Page, releaseY: number) {
  const held = await boxOf(page, '[data-drag-row-id="newtab"]');
  const x = held.x + 60;
  await page.mouse.move(x, held.y + held.height / 2);
  await page.mouse.down();
  // Past the threshold first, so the gesture is a drag and not a click.
  await page.mouse.move(x, held.y + held.height / 2 + 8);
  await page.mouse.move(x, releaseY, { steps: 10 });
  await page.mouse.up();
}

test.describe('the drop target between two adjacent groups', () => {
  test('is wide enough to hit', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    const bandA = await boxOf(page, '[data-band-id="A"]');
    const bandB = await boxOf(page, '[data-band-id="B"]');

    expect(bandB.y - (bandA.y + bandA.height)).toBeGreaterThanOrEqual(
      TARGET_PX
    );
  });

  // The same thing said as behaviour rather than as geometry, at three points
  // across the target. Each is strictly inside an 8px gap and strictly inside
  // the LOWER BAND when the gap is 2px, so on the old layout each one joins
  // group B instead. 2px is deliberately not among them: on the old layout it
  // is exactly the lower band's top edge, which already resolved as "between",
  // so it would pass either way and prove nothing.
  for (const offset of [3, 5, 7]) {
    test(`a release ${offset}px below the group above lands between the groups`, async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId);
      const bandA = await boxOf(page, '[data-band-id="A"]');

      await dropAt(page, bandA.y + bandA.height + offset);

      await expect.poll(() => order(page)).toBe(BETWEEN_THE_GROUPS);
    });
  }

  // CONTROL: the rule itself is untouched. Inside a band still means join that
  // group, at both ends of the boundary -- without this, deleting the band hit
  // test would pass every test above.
  test('CONTROL: a release inside the lower band still joins that group', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const bandB = await boxOf(page, '[data-band-id="B"]');

    await dropAt(page, bandB.y + 10);

    await expect
      .poll(() => order(page))
      .toBe('top a1*A a2*A newtab*B b1*B b2*B b3*B last');
  });

  test('CONTROL: a release inside the upper band still joins that group', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const bandA = await boxOf(page, '[data-band-id="A"]');

    await dropAt(page, bandA.y + bandA.height - 10);

    await expect
      .poll(() => order(page))
      .toBe('top a1*A a2*A newtab*A b1*B b2*B b3*B last');
  });

  // CONTROL: only the gap BETWEEN TWO BANDS grows. A band's spacing against an
  // ordinary tab is what every footprint in the drag engine is measured from
  // (KAN-163/167), so widening that instead would move every preview in the
  // pane -- this is the assertion that says which one changed.
  test('CONTROL: a band beside a loose tab keeps its original spacing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const bandA = await boxOf(page, '[data-band-id="A"]');
    const above = await boxOf(page, '[data-drag-row-id="newtab"]');
    const bandB = await boxOf(page, '[data-band-id="B"]');
    const below = await boxOf(page, '[data-drag-row-id="last"]');

    expect(bandA.y - (above.y + above.height)).toBe(2);
    expect(below.y - (bandB.y + bandB.height)).toBe(2);
  });

  test('CONTROL: the seeded arrangement is the one described', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await order(page)).toBe(START);
  });
});
