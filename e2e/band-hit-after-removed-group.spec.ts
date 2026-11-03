import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-916. A group's only tab dragged out empties it, and the preview closes
// the rows below up by the group's chrome (KAN-169). The hit test kept
// answering over where those rows RESTED, so pointing at the drawn loose row
// under a group joined that group. Two tabs in the group are the control:
// nothing vanishes there.
//
// 790x550 with a list short enough that no aim reaches the auto-scroll band.

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

function tabsWith(watchlist: string[]) {
  return [
    ...watchlist.map((t) => tab(t, t, 'watch')),
    tab('im', 'IMDb', 'ratings'),
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

// What the pointer is over as drawn, and what the drag says it targets.
const readHit = (page: Page, y: number) =>
  page.evaluate((y) => {
    const row = (id: string) => {
      const r = document
        .querySelector(`[data-drag-row-id="${id}"]`)!
        .getBoundingClientRect();
      // Clear of the edge pixels a neighbour's box also covers.
      return y >= r.top + 2 && y <= r.bottom - 2;
    };
    let pane = document.querySelector('[data-band-id]')?.parentElement;
    while (
      pane &&
      !['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)
    )
      pane = pane.parentElement;
    return {
      onPopcorn: row('pc'),
      onExtensions: row('ex'),
      target:
        document
          .querySelector('[data-drop-target]')
          ?.getAttribute('data-band-id') ?? 'none',
      scrollTop: pane?.scrollTop ?? -1,
    };
  }, y);

async function open(page: Page, watchlist: string[]) {
  const tabs = tabsWith(watchlist);
  await seedSessions(page.context(), {
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
}

const box = async (page: Page, id: string) => {
  const b = await page.locator(`[data-drag-row-id="${id}"]`).boundingBox();
  if (b === null) throw new Error(`${id} is not drawn`);
  return { x: b.x, top: b.y, bottom: b.y + b.height };
};

// Picks up Letterboxd and carries it onto Spotify, so a release below there
// empties Watchlist when it is Letterboxd's only group. Popcorn and
// Extensions are not yet passed: they sit where the next aim finds them.
async function pickUp(page: Page) {
  const lb = await box(page, 'lb');
  const x = lb.x + 40;
  await page.mouse.move(x, lb.top + 16);
  await page.mouse.down();
  await page.mouse.move(x, lb.top + 24, { steps: 2 });
  const sp = await box(page, 'sp');
  await page.mouse.move(x, sp.top + 16, { steps: 6 });
  await settled(page);
  return x;
}

const tabOrder = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-drag-row-id]')]
      .map((e) => (e as HTMLElement).dataset.dragRowId ?? '')
      .filter((id) => /^[a-z]{2}$/.test(id))
  );

for (const watchlist of [['lb'], ['lb', 'mu']]) {
  const name = watchlist.length === 1 ? 'its only tab' : 'one of two tabs';

  test.describe(`with ${name} dragged out of the group above`, () => {
    const popup = async (
      context: BrowserContext,
      extensionId: string
    ): Promise<Page> => {
      const page = await context.newPage();
      await open(page, watchlist);
      await page.setViewportSize({ width: 790, height: 550 });
      await page.goto(`chrome-extension://${extensionId}/index.html`);
      await expect(page.locator('[data-drag-row-id="lb"]')).toBeVisible();
      await settled(page);
      return page;
    };

    test('a drawn loose row marks no group and a drawn member marks its own, going down and up', async ({
      context,
      extensionId,
    }) => {
      const page = await popup(context, extensionId);
      const x = await pickUp(page);
      const pc = await box(page, 'pc');
      const ex = await box(page, 'ex');
      const ys: number[] = [];
      for (let y = Math.floor(pc.top); y <= Math.ceil(ex.bottom); y++)
        ys.push(y);
      const misses: string[] = [];
      for (const y of [...ys, ...ys.slice().reverse()]) {
        await page.mouse.move(x, y);
        await settled(page);
        const hit = await readHit(page, y);
        expect(hit.scrollTop).toBe(0);
        if (hit.onExtensions && hit.target !== 'none')
          misses.push(`y=${y} on Extensions marks ${hit.target}`);
        if (hit.onPopcorn && hit.target !== 'snacks')
          misses.push(`y=${y} on Popcorn marks ${hit.target}`);
      }
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect(misses).toEqual([]);
    });

    // The gone band's own edge is where the drop starts or stops removing
    // it. Its box does not move, so either way across, a y means one thing.
    test('across the edge of the group it leaves, the answer depends on the pointer alone', async ({
      context,
      extensionId,
    }) => {
      const page = await popup(context, extensionId);
      const x = await pickUp(page);
      const watch = await page.locator('[data-band-id="watch"]').boundingBox();
      if (watch === null) throw new Error('no Watchlist band');
      const edge = watch.y + watch.height;
      const ys: number[] = [];
      for (let y = edge - 12; y <= edge + 12; y += 0.5) ys.push(y);
      const read = () =>
        page.evaluate(() =>
          [
            document
              .querySelector('[data-drop-target]')
              ?.getAttribute('data-band-id') ?? 'none',
            document.querySelector('[data-band-id="watch"][data-drag-removed]')
              ? 'gone'
              : 'kept',
            Math.round(
              document
                .querySelector('[data-drag-landing-slot]')
                ?.getBoundingClientRect().top ?? -1
            ),
          ].join(' ')
        );
      const down = new Map<number, string>();
      const up = new Map<number, string>();
      for (const y of ys) {
        await page.mouse.move(x, y);
        await settled(page);
        down.set(y, await read());
      }
      for (const y of ys.slice().reverse()) {
        await page.mouse.move(x, y);
        await settled(page);
        up.set(y, await read());
      }
      await page.keyboard.press('Escape');
      await page.mouse.up();
      const split = ys
        .filter((y) => down.get(y) !== up.get(y))
        .map((y) => `y=${y}: down ${down.get(y)}, up ${up.get(y)}`);
      expect(split).toEqual([]);
      // PREMISE: the sweep crossed the edge -- the group goes on one side.
      expect(new Set([...down.values()].map((v) => v.split(' ')[1]))).toEqual(
        new Set(watchlist.length === 1 ? ['kept', 'gone'] : ['kept'])
      );
    });

    for (const [quarter, fraction, order] of [
      ['upper', 0.25, ['im', 'sp', 'pc', 'lb', 'ex']],
      ['lower', 0.75, ['im', 'sp', 'pc', 'ex', 'lb']],
    ] as const) {
      test(`released on the ${quarter} quarter of the drawn Extensions row, it lands loose ${quarter === 'upper' ? 'before' : 'after'} it`, async ({
        context,
        extensionId,
      }) => {
        const page = await popup(context, extensionId);
        const x = await pickUp(page);
        const ex = await box(page, 'ex');
        await page.mouse.move(x, ex.top + (ex.bottom - ex.top) * fraction, {
          steps: 4,
        });
        await settled(page);
        await page.mouse.up();
        await expect
          .poll(() => tabOrder(page))
          .toEqual([...watchlist.slice(1), ...order]);
        await expect(
          page.locator('[data-band-id] [data-drag-row-id="lb"]')
        ).toHaveCount(0);
      });
    }
  });
}
