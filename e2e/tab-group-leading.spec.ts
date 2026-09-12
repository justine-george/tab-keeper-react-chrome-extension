// A window whose FIRST item is a group, which is the shape that exposed two
// faults at once (KAN-172, KAN-173).
//
// Everything above the group's first member belongs to the group's own chrome:
// its title row means "join at the head" (KAN-166), and above that the release
// used to be refused outright, because the list's extent was measured from the
// first ROW and the title row sits a row above it. So "before the group" was
// not addressable at all -- and a refused release in that same region still
// drew a landing ghost, promising a move that never came.

import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

// Group first, then two loose tabs.
const TABS = [tab('g0', 'test'), tab('g1', 'test'), tab('b0'), tab('b1')];
const START = 'g0* g1* b0 b1';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Leading group',
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
        chromeTabGroups: [{ groupId: 'test', title: 'Test', color: 'yellow' }],
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
  // goto resolves before React mounts (KAN-105), and the band needs the grant.
  await expect(page.locator('[data-band-id="test"]')).toBeAttached();
  return page;
}

// The stored order, with a star on every grouped tab.
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
      .windows[0].tabs.map((t) => t.tabId + (t.chromeGroupId ? '*' : ''))
      .join(' ');
  });

// Drag `rowId` to `toY` and report what the preview promised, without releasing.
async function dragTo(page: Page, rowId: string, toY: number) {
  const b = (await page
    .locator(`[data-drag-row-id="${rowId}"]`)
    .boundingBox())!;
  const x = b.x + 60;
  const startY = b.y + b.height / 2;
  const dir = toY > startY ? 1 : -1;
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + dir * 8);
  await page.mouse.move(x, toY, { steps: 8 });
  // The frame's parts carry a 0.18s transition (KAN-165), so anything compared
  // against a title row's RECT has to wait it out. Read immediately, the title
  // is still at its resting top and a ghost correctly drawn above it reads as
  // being inside the group.
  await page.waitForTimeout(280);

  return page.evaluate((held: string) => {
    const slot = document.querySelector<HTMLElement>(
      '[data-drag-landing-slot]'
    );
    const row = document.querySelector<HTMLElement>(
      `[data-drag-row-id="${held}"]`
    )!;
    const shift = Number(
      /translateY\((-?[\d.]+)px\)/.exec(row.style.transform)?.[1] ?? 0
    );
    const title = document.querySelector<HTMLElement>(
      '[data-band-id="test"] [data-group-drag-handle]'
    )!;
    const first = document.querySelector<HTMLElement>(
      '[data-drag-row-id="g0"]'
    )!;
    return {
      // Where the ghost points, named against the group's own chrome (KAN-174).
      ghostIs: !slot
        ? 'none'
        : slot.getBoundingClientRect().top <
            title.getBoundingClientRect().top - 2
          ? 'above the title row'
          : slot.getBoundingClientRect().top <
              first.getBoundingClientRect().top - 2
            ? 'inside the group, at its head'
            : 'at or below the first member',
      // A ghost drawn on the held row's OWN slot is the engine saying "nothing
      // will happen"; one drawn anywhere else is a promise.
      promisesAMove:
        !!slot &&
        Math.abs(
          slot.getBoundingClientRect().top -
            (row.getBoundingClientRect().top - shift)
        ) > 2,
      bandIsTarget: document
        .querySelector('[data-band-id="test"]')!
        .hasAttribute('data-drop-target'),
    };
  }, rowId);
}

const bandBox = (page: Page) =>
  page.locator('[data-band-id="test"]').boundingBox();

test.describe('a group at the top of a window', () => {
  // KAN-173. The position before a leading group has to exist.
  test('a loose tab can be dropped before it', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await order(page)).toBe(START);
    const band = (await bandBox(page))!;

    const preview = await dragTo(page, 'b1', band.y - 6);
    // Outside every band, so the tab lands ungrouped rather than joining.
    expect(preview.bandIsTarget).toBe(false);
    expect(preview.promisesAMove).toBe(true);

    await page.mouse.up();
    expect(await order(page)).toBe('b1 g0* g1* b0');
  });

  // CONTROL: the title row itself still means "join at the head", so the strip
  // above it is the only thing that can mean "before". Without this the test
  // above could pass on a band that had stopped claiming its own title row.
  test('CONTROL: its title row still means join, not before', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const title = (await page
      .locator('[data-band-id="test"] [data-group-drag-handle]')
      .boundingBox())!;

    const preview = await dragTo(page, 'b1', title.y + title.height / 2);
    expect(preview.bandIsTarget).toBe(true);

    await page.mouse.up();
    expect(await order(page)).toBe('b1* g0* g1* b0');
  });

  // KAN-174. The two drops that meet at a group's head must not look alike.
  // They did: both drew the ghost between the title row and the first member,
  // so the band's tint was the only thing telling them apart -- and for the
  // one that lands OUTSIDE the group the ghost pointed inside a band it was
  // never going to join.
  test('landing before it and joining it point at different slots', async ({
    context,
    extensionId,
  }) => {
    // Each case is read back BEFORE the next one runs: the two pages share one
    // localStorage, so the second release overwrites the first one's order.
    const before = await open(context, extensionId);
    const bandA = (await bandBox(before))!;
    const outside = await dragTo(before, 'b1', bandA.y - 6);
    await before.mouse.up();
    const landedOutside = await order(before);
    await before.close();

    const joining = await open(context, extensionId);
    const title = (await joining
      .locator('[data-band-id="test"] [data-group-drag-handle]')
      .boundingBox())!;
    const inside = await dragTo(joining, 'b1', title.y + title.height / 2);
    await joining.mouse.up();
    const landedInside = await order(joining);

    // PREMISES: the same gesture, landing two different ways.
    expect(outside.bandIsTarget).toBe(false);
    expect(inside.bandIsTarget).toBe(true);
    expect(landedOutside).toBe('b1 g0* g1* b0');
    expect(landedInside).toBe('b1* g0* g1* b0');

    // THE CLAIM: each ghost points at the slot its own release will use.
    expect(outside.ghostIs).toBe('above the title row');
    expect(inside.ghostIs).toBe('inside the group, at its head');
  });

  // KAN-172. Far enough out that the list refuses the release -- and a refusal
  // must look like one. The fallback for a refused landing is "the row goes
  // back where it came from", and for a tab that is already its group's first
  // member that fallback still satisfied the leaving rule, so the ghost
  // promised it would land above the group while the release did nothing.
  test('a release it refuses promises nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const band = (await bandBox(page))!;

    const preview = await dragTo(page, 'g0', band.y - 100);
    expect(preview.promisesAMove).toBe(false);

    await page.mouse.up();
    expect(await order(page)).toBe(START);
  });
});
