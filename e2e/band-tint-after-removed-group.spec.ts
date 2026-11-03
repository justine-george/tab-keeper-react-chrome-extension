import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-915. Dragged out of its group, a group's only tab empties it, and the
// group goes (KAN-169): every band below is drawn a header and a row higher.
// The band the tab would join answered in its tint over its RESTING bottom,
// so the tint ran 40px past its last tab and over the next group's header.
// The strip was right; only the tint was not.
//
// Read off the pixels: the tint is a background, and what it paints is the
// bug. 790x550, the real popup, with a list short enough that every aim is
// clear of the auto-scroll band: the list never moves under the hold.

const tab = (id: string, title: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});
const GROUPS = [
  { groupId: 'watch', title: 'Watchlist', color: 'blue' },
  { groupId: 'ratings', title: 'Ratings', color: 'yellow' },
  { groupId: 'sound', title: 'Soundtrack', color: 'green' },
  { groupId: 'snacks', title: 'Snacks', color: 'red' },
];

// Watchlist's tabs, then the rest of the window.
function tabsWith(watchlist: string[]) {
  return [
    ...watchlist.map((t) => tab(t, t, 'watch')),
    tab('im', 'IMDb', 'ratings'),
    tab('jw', 'JustWatch', 'ratings'),
    tab('sp', 'Spotify', 'sound'),
    tab('pc', 'Popcorn', 'snacks'),
    tab('ex', 'Extensions'),
  ];
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

// The colour the page paints at (x, y), read off a screenshot.
async function pixel(page: Page, x: number, y: number): Promise<string> {
  const png = await page.screenshot({
    clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
  });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(',');
  }, png.toString('base64'));
}

const drawn = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not drawn`);
  return { top: box.y, bottom: box.y + box.height, right: box.x + box.width };
};
const titleRow = (id: string) =>
  `[data-band-id="${id}"] [data-fixed-row-id="${id}"]`;

const CASES = [
  {
    name: 'over Ratings, the Soundtrack header below it is not tinted',
    target: 'ratings',
    aim: 'im',
    lastTab: 'jw',
    below: titleRow('sound'),
  },
  {
    name: 'over Snacks, the loose Extensions below it is not tinted',
    target: 'snacks',
    aim: 'pc',
    lastTab: 'pc',
    below: '[data-drag-row-id="ex"]',
  },
];

for (const only of [true, false]) {
  test.describe(
    only
      ? "the group's only tab dragged out of it"
      : 'CONTROL: one of two tabs dragged out of its group',
    () => {
      for (const c of CASES) {
        test(c.name, async ({ context, extensionId }) => {
          const page = await context.newPage();
          const tabs = tabsWith(only ? ['lb'] : ['lb', 'mu']);
          await seedSessions(context, {
            ...buildContainer([
              buildSession({
                tabGroupId: 's',
                title: 'Movie night',
                isSelected: true,
                windowCount: 1,
                tabCount: tabs.length,
                windows: [
                  {
                    windowId: 'w1',
                    windowHeight: 1080,
                    windowWidth: 1920,
                    windowOffsetTop: 0,
                    windowOffsetLeft: 0,
                    tabCount: tabs.length,
                    title: 'Pick tonight',
                    tabs,
                    chromeTabGroups: GROUPS,
                  },
                ],
              }),
            ]),
            selectedTabGroupId: 's',
          });
          await page.setViewportSize({ width: 790, height: 550 });
          await page.goto(`chrome-extension://${extensionId}/index.html`);
          await expect(page.locator('[data-drag-row-id="lb"]')).toBeVisible();
          await settled(page);

          const lb = await page
            .locator('[data-drag-row-id="lb"]')
            .boundingBox();
          if (lb === null) throw new Error('no Letterboxd');
          const x = lb.x + 40;
          await page.mouse.move(x, lb.y + lb.height / 2);
          await page.mouse.down();
          await page.mouse.move(x, lb.y + lb.height / 2 + 8, { steps: 2 });
          await settled(page);
          const aim = await drawn(page, `[data-drag-row-id="${c.aim}"]`);
          await page.mouse.move(x, aim.top + 4, { steps: 8 });
          await settled(page);

          // PREMISE: nothing scrolled under the hold.
          expect(
            await page.evaluate(() => {
              let el = document.querySelector('[data-band-id]')?.parentElement;
              while (
                el &&
                !['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
              )
                el = el.parentElement;
              return el?.scrollTop;
            })
          ).toBe(0);
          // PREMISE: the tab would join the target, which answers in its tint;
          // with its only tab out, Watchlist is going.
          await expect(
            page.locator(`[data-band-id="${c.target}"][data-drop-target]`)
          ).toBeAttached();
          if (only)
            await expect(
              page.locator('[data-band-id="watch"][data-drag-removed]')
            ).toBeAttached();

          const band = await drawn(page, `[data-band-id="${c.target}"]`);
          const px = band.right - 12;
          const last = await drawn(page, `[data-drag-row-id="${c.lastTab}"]`);
          const below = await drawn(page, c.below);
          // Untinted ground in the same column: the window's own title row,
          // which no drop into a group tints.
          const header = await drawn(page, '[data-drop-window-id="w1"]');
          const ground = await pixel(page, px, header.top + 16);

          // The target's last tab sits in the tint; what is drawn below it
          // does not.
          expect(await pixel(page, px, last.bottom - 4)).not.toBe(ground);
          expect(await pixel(page, px, below.top + 6)).toBe(ground);

          await page.keyboard.press('Escape');
          await page.mouse.up();
        });
      }
    }
  );
}
