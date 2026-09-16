import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import {
  startGeometryEvidence,
  withGeometryEvidence,
} from './fixtures/dragEvidence';

// KAN-184. A window being dropped INTO has to make room for the row.
//
// A preview holds the layout still and moves everything by transform, so a
// window cannot change height. Until this, the destination could not make room
// at all, and it showed in two ways that were reported as separate bugs:
//
//   among its rows  the rows below the landing slid down and spilled out of
//                   their own block, drawn over the next window's header --
//                   measured 26px
//   at its end      no gap opened whatsoever, so the landing placeholder had
//                   nowhere to be drawn. KAN-182 drew it as a 4px line there;
//                   this supersedes that, and the ghost is a box everywhere.
//
// The room is made by moving every window AFTER the destination down by one
// footprint. Not the windows between source and destination: the held row
// still occupies its place in the source's flow until the release, so that
// block keeps its box -- deriving it from the post-drop layout slid the source
// block into the window below it, the same defect one window further down.
//
// Every test scrolls. A long session is where this is seen, and scrollTop 0 is
// the one position where the engine's coordinate bugs cannot appear.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const win = (
  id: string,
  tabs: ReturnType<typeof tab>[],
  groups: { groupId: string; title: string; color: string }[] = []
) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: id,
  tabs,
  chromeTabGroups: groups,
});

// Three windows so a destination has something both above and below it, and
// the held group sits BELOW a loose tab inside its own window, as reported.
const WINDOWS = [
  win(
    'w1',
    Array.from({ length: 7 }, (_, i) => tab(`a${i}`))
  ),
  win(
    'w2',
    [
      tab('d0'),
      tab('be0', 'beta'),
      tab('be1', 'beta'),
      tab('be2', 'beta'),
      tab('b1'),
      tab('b2'),
    ],
    [{ groupId: 'beta', title: 'Beta', color: 'red' }]
  ),
  win(
    'w3',
    Array.from({ length: 5 }, (_, i) => tab(`c${i}`))
  ),
];

// Sub-pixel slack only: every number below is one measured box against
// another, and the defects this pins are a whole 32px row.
const SLACK_PX = 2;

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Cross window room',
    isSelected: true,
    windowCount: WINDOWS.length,
    tabCount: WINDOWS.reduce((n, w) => n + w.tabs.length, 0),
    windows: WINDOWS,
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('[data-drag-row-id="group:beta"]')).toBeAttached();
  await centreOn(page, '[data-drop-window-id="w2"]');
  return page;
}

// Put the given element's top in the middle of the pane: scrolled, and clear
// of both 48px auto-scroll zones.
async function centreOn(page: Page, selector: string) {
  return page.evaluate((selector) => {
    let pane = document.querySelector<HTMLElement>(
      '[data-drag-row-id="w1"]'
    )!.parentElement;
    while (
      pane &&
      !['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)
    )
      pane = pane.parentElement;
    const target = document.querySelector(selector)!.getBoundingClientRect();
    const box = pane!.getBoundingClientRect();
    pane!.scrollTop += target.top - (box.top + box.height / 2);
    return pane!.scrollTop;
  }, selector);
}

const boxOf = async (page: Page, selector: string) =>
  (await page.locator(selector).boundingBox())!;

const slotBox = (page: Page) =>
  page.evaluate(() => {
    const b = document
      .querySelector('[data-drag-landing-slot]')!
      .getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, height: b.height };
  });

const order = (page: Page, windowId: string) =>
  page.evaluate((windowId) => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windows: {
          windowId: string;
          tabs: { tabId: string; chromeGroupId?: string }[];
        }[];
      }[];
    };
    return data.tabGroups
      .find((g) => g.tabGroupId === 's1')!
      .windows.find((w) => w.windowId === windowId)!
      .tabs.map((t) => t.tabId + (t.chromeGroupId ? '*' : ''))
      .join(' ');
  }, windowId);

// Picks a group up by its title row. Boxes must be read AFTER this: the
// pick-up compresses the held group (KAN-160) and moves every window below it.
async function grabGroup(page: Page, groupId: string) {
  const b = await boxOf(
    page,
    `[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
  );
  const x = b.x + 40;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 8, { steps: 2 });
  return x;
}

test.describe('a window makes room for a row landing in it', () => {
  test('its rows stay out of the window below', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'beta');
    const a4 = await boxOf(page, '[data-drag-row-id="tab:a4"]');
    await page.mouse.move(x, a4.y + 4, { steps: 8 });
    await page.waitForTimeout(320);

    // w1's LAST row is the one pushed down by the landing above it.
    const lastRow = await boxOf(page, '[data-drag-row-id="tab:a6"]');
    const below = await boxOf(page, '[data-drop-window-id="w2"]');

    expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(below.y);

    await page.mouse.up();
    await expect
      .poll(() => order(page, 'w1'))
      .toBe('a0 a1 a2 a3 be0* be1* be2* a4 a5 a6');
  });

  test('the window below moves down, rather than being drawn over', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    // KAN-196: the premise below has failed once on CI, 1px out, and has never
    // been reproduced locally -- w2 held y=332 across 16 runs and up to 20x CPU
    // throttling, so `before` and `afterPickup` are EQUAL in every healthy run
    // and the premise passes with no margin at all. Recording starts before the
    // first read because either of the two could be the one caught moving.
    await startGeometryEvidence(page, {
      w1: '[data-drop-window-id="w1"]',
      w2: '[data-drop-window-id="w2"]',
      w3: '[data-drop-window-id="w3"]',
      'group:beta': '[data-drag-row-id="group:beta"]',
    });
    const before = await boxOf(page, '[data-drop-window-id="w2"]');

    const x = await grabGroup(page, 'beta');
    // Picking a group up compresses it, which moves the windows below it: read
    // the resting position again before asking what the LANDING moved.
    const afterPickup = await boxOf(page, '[data-drop-window-id="w2"]');
    const a4 = await boxOf(page, '[data-drag-row-id="tab:a4"]');
    await page.mouse.move(x, a4.y + 4, { steps: 8 });
    await page.waitForTimeout(320);

    const during = await boxOf(page, '[data-drop-window-id="w2"]');
    const moved = during.y - afterPickup.y;

    // One row's footprint, and downward.
    expect(moved).toBeGreaterThan(16);
    // PREMISE: the pick-up itself is not what moved it.
    //
    // KAN-196. Measured: w2's top CANNOT move at the pick-up, because beta
    // lives inside w2 -- compressing it shortens w2 without moving where it
    // starts, and w3 below is what travels (600 -> 504). So `before` and
    // `afterPickup` are the same number in every healthy run, 332 and 332, and
    // written as a bare `>=` this premise was an equality in disguise that any
    // 1px perturbation flipped. It failed on CI at exactly 1px.
    //
    // SLACK_PX is this file's own rule for one measured box against another,
    // used by five assertions above and below. It was the only box-vs-box
    // comparison here not using it. The claim is untouched: what this rules out
    // is the pick-up pushing w2 DOWN, and that defect is a whole 32px row.
    await withGeometryEvidence(
      page,
      'kan-196-pickup-premise',
      async () => {
        expect(afterPickup.y).toBeLessThanOrEqual(before.y + SLACK_PX);
      },
      // Where w2 rests once everything has stopped. If this equals `before`,
      // `afterPickup` was read mid-flight; if it equals `afterPickup`, the
      // pick-up really did move the window down and the premise is the thing
      // that is wrong.
      async () => ({
        before: before.y,
        afterPickup: afterPickup.y,
        during: during.y,
        settled: (await boxOf(page, '[data-drop-window-id="w2"]')).y,
      })
    );

    // And nothing below it is overlapped either.
    const w3 = await boxOf(page, '[data-drop-window-id="w3"]');
    expect(during.y + during.height).toBeLessThanOrEqual(w3.y);

    await page.mouse.up();
  });

  test('the ghost is a full box at the end of a window, clear of the one below', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'beta');
    const w1 = await boxOf(page, '[data-drop-window-id="w1"]');
    await page.mouse.move(x, w1.y + w1.height - 3, { steps: 8 });
    await page.waitForTimeout(320);

    const slot = await slotBox(page);
    const held = await boxOf(page, '[data-drag-row-id="group:beta"]');
    const below = await boxOf(page, '[data-drop-window-id="w2"]');
    const lastRow = await boxOf(page, '[data-drag-row-id="tab:a6"]');

    // A BOX, the height of the row that is landing -- KAN-182 drew a 4px line
    // here because there was no room; there is room now.
    expect(slot.height).toBeGreaterThanOrEqual(held.height - SLACK_PX);
    expect(slot.bottom).toBeLessThanOrEqual(below.y);
    // And it still starts exactly where the appended row starts.
    expect(Math.abs(slot.top - lastRow.y - lastRow.height)).toBeLessThanOrEqual(
      SLACK_PX
    );

    await page.mouse.up();
    await expect
      .poll(() => order(page, 'w1'))
      .toBe('a0 a1 a2 a3 a4 a5 a6 be0* be1* be2*');
  });

  test('the held row keeps tracking the pointer while the room opens', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'beta');
    const a4 = await boxOf(page, '[data-drag-row-id="tab:a4"]');
    const at = a4.y + 4;
    await page.mouse.move(x, at, { steps: 8 });
    await page.waitForTimeout(320);

    // The held row is drawn INSIDE the window it came from, and that window is
    // one of the ones moved to make room -- so it has to give that back.
    const held = await boxOf(page, '[data-drag-row-id="group:beta"]');
    expect(Math.abs(held.y + held.height / 2 - at)).toBeLessThanOrEqual(
      SLACK_PX
    );

    await page.mouse.up();
  });

  // CONTROL: a drag that stays in its own window needs no room made anywhere,
  // and moving a block for it would shift the whole pane under the pointer.
  test('CONTROL: a landing in its own window moves no window at all', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'beta');
    const resting = await boxOf(page, '[data-drop-window-id="w3"]');
    const b2 = await boxOf(page, '[data-drag-row-id="tab:b2"]');
    await page.mouse.move(x, b2.y + b2.height - 4, { steps: 8 });
    await page.waitForTimeout(320);

    const during = await boxOf(page, '[data-drop-window-id="w3"]');
    expect(Math.abs(during.y - resting.y)).toBeLessThanOrEqual(SLACK_PX);

    await page.mouse.up();
  });

  // CONTROL: the LAST window needs no room made either -- nothing is drawn
  // below it, so the pane's own empty space is the room.
  test('CONTROL: landing in the last window moves nothing, and the ghost is still a box', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await centreOn(page, '[data-drop-window-id="w3"]');

    const x = await grabGroup(page, 'beta');
    const c2 = await boxOf(page, '[data-drag-row-id="tab:c2"]');
    await page.mouse.move(x, c2.y + 4, { steps: 8 });
    await page.waitForTimeout(320);

    const slot = await slotBox(page);
    const held = await boxOf(page, '[data-drag-row-id="group:beta"]');
    expect(slot.height).toBeGreaterThanOrEqual(held.height - SLACK_PX);

    await page.mouse.up();
    // The premise this control needs is that the drop landed in the LAST
    // window at all -- which slot inside it is the business of the tests
    // above, and pinning it here would only pin my aim.
    await expect.poll(() => order(page, 'w3')).toMatch(/be0\* be1\* be2\*/);
    expect((await order(page, 'w3')).split(' ')).toHaveLength(8);
  });

  // CONTROL, and the trap this design had to avoid: moving a block must not
  // move what the pointer can HIT. A window that slides under the pointer
  // while it is being pointed at is the LATCH that KAN-171 fixed for a band's
  // padding -- there, marking a band grew it, which kept the pointer inside.
  //
  // Held just inside w1's bottom edge, the landing must stay in w1 even though
  // w2 has moved down past that same y.
  test('CONTROL: the moved block does not steal the pointer back', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'beta');
    const w1 = await boxOf(page, '[data-drop-window-id="w1"]');
    const at = w1.y + w1.height - 3;

    for (let i = 0; i < 3; i++) {
      await page.mouse.move(x, at, { steps: 4 });
      await page.waitForTimeout(220);
      const w2 = await boxOf(page, '[data-drop-window-id="w2"]');
      // The pointer now sits ABOVE w2's drawn top only because w2 moved; what
      // matters is that the landing did not follow it.
      expect(w2.y).toBeGreaterThan(at - 40);
    }

    await page.mouse.up();
    await expect
      .poll(() => order(page, 'w1'))
      .toBe('a0 a1 a2 a3 a4 a5 a6 be0* be1* be2*');
  });
});
