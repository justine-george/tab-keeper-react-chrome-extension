import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { ON_TITLE } from './fixtures/savedRow';

// KAN-887. A tab or group drag in a list that already scrolls adds one row of
// room below the last window (KAN-366 Q4), and auto-scroll can carry the list
// into it. Dropped anywhere else, the room went at once and Chrome pulled the
// scroll back in one frame: on main a tab drop jumped the whole list 34px
// (scrollTop 42 -> 8), the dropped row landing a row below its slot; a group
// drop 2px. His pick C: the room stays after the drop until it is scrolled out
// of view, so nothing moves at the drop.
//
// 790x550, the real popup: the list overflows 8px at rest, so the drag gets
// its room.

const tab = (id: string, title: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const TABS = [
  tab('ext', 'Extensions'),
  tab('w1', 'JustWatch', 'watch'),
  tab('w2', 'Criterion', 'watch'),
  tab('r1', 'Letterboxd', 'ratings'),
  tab('r2', 'IMDb', 'ratings'),
  tab('s1', 'Spotify', 'sound'),
  tab('n1', 'Popcorn', 'snacks'),
];
const GROUPS = [
  { groupId: 'watch', title: 'Watchlist', color: 'blue' },
  { groupId: 'ratings', title: 'Ratings', color: 'yellow' },
  { groupId: 'sound', title: 'Soundtrack', color: 'green' },
  { groupId: 'snacks', title: 'Snacks', color: 'red' },
];

const win = (
  windowId: string,
  title: string,
  tabs: typeof TABS,
  groups = GROUPS
) => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title,
  tabs,
  chromeTabGroups: groups,
});

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const short = [tab('o1', 'Recipes'), tab('o2', 'Groceries')];
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 's',
        title: 'Movie night',
        isSelected: true,
        windowCount: 2,
        tabCount: TABS.length + 1,
        windows: [
          win('win', 'Pick tonight', TABS),
          win('win3', 'Later', [tab('l1', 'Trailers')], []),
        ],
      }),
      buildSession({
        tabGroupId: 'o',
        title: 'Dinner',
        windowCount: 1,
        tabCount: short.length,
        windows: [win('win2', 'Cook', short, [])],
      }),
    ]),
    selectedTabGroupId: 's',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105).
  await expect(page.locator('[data-band-id="snacks"]')).toBeAttached();
  await settled(page);
  return page;
}

// Until every row the preview moved has arrived.
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

const titleRow = (groupId: string) =>
  `[data-band-id="${groupId}"] [data-fixed-row-id="${groupId}"]`;
const tabRow = (id: string) => `[data-drag-row-id="${id}"]`;

// The saved list's scroll, and the trailing block's height: 0 at rest, one
// row and its borders while it gives room.
const list = (page: Page) =>
  page.evaluate(() => {
    const block = document.querySelector<HTMLElement>(
      '[data-new-window-target="last"]'
    );
    let s: HTMLElement | null = block?.parentElement ?? null;
    while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowY))
      s = s.parentElement;
    if (!block || !s) throw new Error('no saved list');
    return {
      scrollTop: s.scrollTop,
      scrollHeight: s.scrollHeight,
      // Where the list ends without the room: past it, the room shows.
      end: s.scrollHeight - block.offsetHeight - s.clientHeight,
      room: block.offsetHeight,
      bottom: s.getBoundingClientRect().bottom,
    };
  });

const topOf = async (page: Page, selector: string): Promise<number> => {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not drawn`);
  return box.y;
};

const slotTop = (page: Page) => topOf(page, '[data-drag-landing-slot]');

// Press on `selector` and move just past the threshold: the drag has begun.
async function pickUp(page: Page, selector: string): Promise<number> {
  const handle = selector.startsWith('[data-band-id')
    ? `${selector.replace(/ \[data-fixed-row-id.*$/, '')} [data-group-drag-handle]`
    : selector;
  const box = await page.locator(handle).boundingBox();
  if (box === null) throw new Error(`no handle for ${selector}`);
  const x = box.x + 40;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  await expect(page.locator('[data-drag-landing-slot]')).toBeAttached();
  await settled(page);
  return x;
}

// Hold at the list's bottom edge until auto-scroll has carried it to its end.
async function scrollToEnd(page: Page, x: number): Promise<void> {
  const { bottom } = await list(page);
  await page.mouse.move(x, bottom - 6, { steps: 6 });
  await expect
    .poll(async () => {
      const a = (await list(page)).scrollTop;
      await page.waitForTimeout(150);
      return (await list(page)).scrollTop === a ? a : -1;
    })
    .toBeGreaterThan(0);
}

// Over Ratings' title row: a landing well above the room.
async function overRatings(page: Page, x: number): Promise<void> {
  const box = await page.locator(titleRow('ratings')).boundingBox();
  if (box === null) throw new Error('Ratings is not drawn');
  await page.mouse.move(x, box.y + box.height / 2 + 4, { steps: 6 });
  await settled(page);
}

async function wheelBy(page: Page, dy: number): Promise<void> {
  const before = (await list(page)).scrollTop;
  await page.mouse.wheel(0, dy);
  await expect.poll(async () => (await list(page)).scrollTop).not.toBe(before);
  await settled(page);
  await page.waitForTimeout(100);
}

// A tab dragged to the list's end and dropped over Ratings: the list is left
// scrolled into the room.
async function dropTabFromTheEnd(page: Page) {
  const rest = await list(page);
  const x = await pickUp(page, tabRow('ext'));
  await scrollToEnd(page, x);
  await overRatings(page, x);
  const held = { ...(await list(page)), slot: await slotTop(page) };
  await page.mouse.up();
  await settled(page);
  return { rest, held, x };
}

test.describe('a drop after auto-scroll went into the room at the list end', () => {
  test('a tab lands on its slot and the list stays put', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { rest, held } = await dropTabFromTheEnd(page);
    // Premise: the hold scrolled past where the list ends at rest.
    expect(held.scrollTop).toBeGreaterThan(rest.end);

    const after = await list(page);
    expect(after.scrollTop).toBe(held.scrollTop);
    expect(
      Math.abs((await topOf(page, tabRow('ext'))) - held.slot)
    ).toBeLessThanOrEqual(1);
    expect(after.room).toBe(held.room);
  });

  test('a group lands on its slot and the list stays put', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const x = await pickUp(page, titleRow('snacks'));
    await scrollToEnd(page, x);
    await overRatings(page, x);
    const held = { ...(await list(page)), slot: await slotTop(page) };
    expect(held.scrollTop).toBeGreaterThan(held.end);
    await page.mouse.up();
    await settled(page);

    expect((await list(page)).scrollTop).toBe(held.scrollTop);
    expect(
      Math.abs((await topOf(page, titleRow('snacks'))) - held.slot)
    ).toBeLessThanOrEqual(1);
  });

  test('Esc after scrolling into the room keeps the scroll', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    // In the list's own coordinates: the cancel puts Extensions back above
    // JustWatch, which moves it a row on screen, and that is not the jump.
    const inList = async () =>
      (await topOf(page, tabRow('w1'))) + (await list(page)).scrollTop;
    const atRest = await inList();
    const x = await pickUp(page, tabRow('ext'));
    await scrollToEnd(page, x);
    await overRatings(page, x);
    const held = await list(page);
    expect(held.scrollTop).toBeGreaterThan(held.end);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settled(page);

    expect((await list(page)).scrollTop).toBe(held.scrollTop);
    expect(await inList()).toBe(atRest);
  });

  test('the room stays while in view and goes once scrolled out of it', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { rest, held } = await dropTabFromTheEnd(page);
    const end = rest.end;

    // Up a little: the room's top is still on screen, so it stays.
    await wheelBy(page, -(held.scrollTop - end - 6));
    let now = await list(page);
    expect(now.scrollTop).toBeGreaterThan(end);
    expect(now.room).toBe(held.room);

    // Up past it: it goes, and the scroll is where the wheel left it.
    await page.mouse.wheel(0, -20);
    await expect.poll(async () => (await list(page)).room).toBe(0);
    now = await list(page);
    expect(now.scrollTop).toBeLessThanOrEqual(end);
    expect(now.scrollHeight).toBe(rest.scrollHeight);
  });

  test('the next pick-up keeps the room and the scroll', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { held } = await dropTabFromTheEnd(page);
    const imdb = await topOf(page, tabRow('r2'));
    await page.mouse.move(0, 0);
    await pickUp(page, tabRow('r1'));
    const now = await list(page);
    expect(now.scrollTop).toBe(held.scrollTop);
    expect(now.room).toBe(held.room);
    expect(
      Math.abs((await topOf(page, tabRow('r2'))) - imdb)
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a window drag starts without the kept room', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { held } = await dropTabFromTheEnd(page);
    expect((await list(page)).room).toBe(held.room);
    await page.mouse.move(0, 0);
    const handle = await page
      .locator('[data-drag-row-id="win3"] [data-window-drag-handle]')
      .boundingBox();
    if (handle === null) throw new Error('no window handle');
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 12, { steps: 3 });
    await expect(page.locator('html[data-dragging="window"]')).toBeAttached();
    expect((await list(page)).room).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('another session shown has no room', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { held } = await dropTabFromTheEnd(page);
    expect((await list(page)).room).toBe(held.room);
    await page.mouse.move(0, 0);
    await page
      .locator(
        '[data-pane="sessions"] [data-drag-row-id="o"] [data-drag-handle-row]'
      )
      .click(ON_TITLE);
    await expect(page.locator('[data-drag-row-id="o1"]')).toBeVisible();
    await settled(page);
    expect((await list(page)).room).toBe(0);
  });

  test('a drop into the room itself makes a window and keeps no room', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const x = await pickUp(page, tabRow('ext'));
    // Held at the list's end, the pointer is over the room: it lights.
    await scrollToEnd(page, x);
    await expect(
      page.locator('[data-new-window-target="last"][data-landing]')
    ).toBeAttached();
    await page.mouse.up();
    await settled(page);
    await expect(page.locator('[data-window-drag-handle]')).toHaveCount(3);
    expect((await list(page)).room).toBe(0);
  });

  test('CONTROL: a drop that never scrolled into the room leaves none', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const x = await pickUp(page, tabRow('ext'));
    await overRatings(page, x);
    const held = await list(page);
    expect(held.scrollTop).toBe(0);
    await page.mouse.up();
    await settled(page);
    const after = await list(page);
    expect(after.scrollTop).toBe(0);
    expect(after.room).toBe(0);
  });
});
