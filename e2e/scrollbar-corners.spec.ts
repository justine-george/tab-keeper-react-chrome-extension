import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { liveWindowOf, seedLongList } from './fixtures/corners';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-888. A scrollbar running into a rounded panel corner painted its track
// over the curve, so the corner looked cut off. Each corner a scrollbar meets
// must look the same with the bar as without it, with the thumb parked at
// that end.
test.use({ showScrollbars: true });

interface Hit {
  // Index into the page's scrollers, as `scrollersMeetingCorners` found them.
  scroller: number;
  end: 'top' | 'bottom';
  // The rounded box whose corner it is, as a viewport rect, and its radius.
  box: { x: number; y: number; width: number; height: number };
  radius: number;
}

// Every overflowing scroller whose scrollbar's top or bottom lies inside a
// rounded corner of itself or of the bordered box it fills.
const scrollersMeetingCorners = (page: Page): Promise<Hit[]> =>
  page.evaluate(() => {
    const px = (s: string) => parseFloat(s) || 0;
    const hits: Hit[] = [];
    // A previous pass's marks would collide with this pass's indexes.
    document
      .querySelectorAll('[data-zz-scroller]')
      .forEach((el) => el.removeAttribute('data-zz-scroller'));
    const scrollers = Array.from(
      document.querySelectorAll<HTMLElement>('*')
    ).filter((el) => {
      const cs = getComputedStyle(el);
      return (
        /(auto|scroll)/.test(cs.overflowY) &&
        el.scrollHeight > el.clientHeight + 1 &&
        el.offsetWidth -
          el.clientWidth -
          px(cs.borderLeftWidth) -
          px(cs.borderRightWidth) >
          0
      );
    });
    scrollers.forEach((el, index) => {
      el.setAttribute('data-zz-scroller', String(index));
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const barRight = r.right - px(cs.borderRightWidth);
      const barTop = r.top + px(cs.borderTopWidth);
      const barBottom = r.bottom - px(cs.borderBottomWidth);
      let p: HTMLElement | null = el;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        const c = getComputedStyle(p);
        const pr = p.getBoundingClientRect();
        if (Math.abs(pr.right - px(c.borderRightWidth) - barRight) > 2)
          continue;
        const box = {
          x: pr.left,
          y: pr.top,
          width: pr.width,
          height: pr.height,
        };
        const top = px(c.borderTopRightRadius);
        const bottom = px(c.borderBottomRightRadius);
        if (top > 0 && barTop - (pr.top + px(c.borderTopWidth)) < top)
          hits.push({ scroller: index, end: 'top', box, radius: top });
        if (
          bottom > 0 &&
          pr.bottom - px(c.borderBottomWidth) - barBottom < bottom
        )
          hits.push({ scroller: index, end: 'bottom', box, radius: bottom });
      }
    });
    return hits;
  });

// The scrollbar side's corner, scrolled to `hit.end`, with and without that
// scroller's bar (clipped away for the second shot, so the backdrop and the
// border are the same). Pixels that differ in the corner's outer triangle:
// the border's curve and what lies outside it, which content never reaches.
async function cornerWithAndWithoutBar(page: Page, hit: Hit, tolerance = 24) {
  const scroller = page.locator(`[data-zz-scroller="${hit.scroller}"]`);
  const toEnd = () =>
    scroller.evaluate((el, end) => {
      el.scrollTop = end === 'top' ? 0 : el.scrollHeight;
    }, hit.end);
  await toEnd();
  await page.waitForTimeout(150);
  const withBar = await page.screenshot();
  // Without the bar: clipped instead of scrolled, so the box, its border and its place stay put.
  await scroller.evaluate((el) => {
    el.style.overflow = 'hidden';
  });
  await toEnd();
  await page.waitForTimeout(150);
  const withoutBar = await page.screenshot();
  await scroller.evaluate((el) => {
    el.style.overflow = '';
  });
  return page.evaluate(
    async ({ a, b, hit, tolerance }) => {
      const read = async (png: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        const scale = img.width / window.innerWidth;
        const n = Math.round(hit.radius * scale);
        const x0 = Math.round((hit.box.x + hit.box.width) * scale) - n;
        const y0 =
          Math.round(
            (hit.end === 'top' ? hit.box.y : hit.box.y + hit.box.height) * scale
          ) - (hit.end === 'top' ? 0 : n);
        return { data: ctx.getImageData(x0, y0, n, n).data, n };
      };
      const first = await read(a);
      const second = await read(b);
      const n = first.n;
      let differing = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const dx = n - 1 - x;
          const dy = hit.end === 'top' ? y : n - 1 - y;
          if (dx + dy >= n) continue;
          const i = (y * n + x) * 4;
          if (
            [0, 1, 2].some(
              (c) =>
                Math.abs(first.data[i + c] - second.data[i + c]) > tolerance
            )
          )
            differing++;
        }
      return differing;
    },
    {
      a: withBar.toString('base64'),
      b: withoutBar.toString('base64'),
      hit,
      tolerance,
    }
  );
}

async function expectCornersIntact(page: Page, where: string, atLeast: number) {
  const hits = await scrollersMeetingCorners(page);
  // CONTROL: the view really has scrollbars meeting corners.
  expect(hits.length, `${where}: corners met`).toBeGreaterThanOrEqual(atLeast);
  for (const hit of hits)
    expect(
      await cornerWithAndWithoutBar(page, hit),
      `${where}: scroller ${hit.scroller} ${hit.end}-right corner, with vs without its bar (box ${JSON.stringify(hit.box)} r${hit.radius})`
      // Anti-aliasing along the curve moves a few pixels; the defect measured 44 to 77.
    ).toBeLessThanOrEqual(4);
}

async function seed(
  context: Parameters<typeof seedLongList>[0],
  worker: Parameters<typeof liveWindowOf>[0]
) {
  await seedLongList(context);
  const tabs = Array.from({ length: 50 }, (_, i) => ({
    tabId: `t${i}`,
    favicon: '',
    title: `Tab ${i}`,
    url: `https://a.test/${i}`,
  }));
  await seedSessions(
    context,
    buildContainer([
      buildSession({
        tabGroupId: 'big',
        title: 'Big',
        isSelected: true,
        windowCount: 1,
        tabCount: tabs.length,
        windows: [
          {
            windowId: 'w',
            windowHeight: 800,
            windowWidth: 1200,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: tabs.length,
            title: 'w',
            tabs,
          },
        ],
      }),
      ...Array.from({ length: 14 }, (_, i) =>
        buildSession({ tabGroupId: `s${i}`, title: `Session ${i + 1}` })
      ),
    ])
  );
  await liveWindowOf(worker, 40);
}

test('popup: the session list and the session card keep their corners', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seed(context, serviceWorker);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  // Saved list bottom; session card top and bottom.
  await expectCornersIntact(page, 'popup home', 3);
});

test('full view: Currently open, the saved list and the session card keep their corners', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seed(context, serviceWorker);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  // Saved list bottom; Currently open bottom.
  await expectCornersIntact(page, 'full view, Currently open', 2);
  await page.getByRole('button', { name: 'Show the saved session' }).click();
  // The panes slide (DURATION.FOLD 280ms); measure once they rest.
  await page.waitForTimeout(600);
  // Saved list bottom; session card top and bottom; Currently open bottom.
  await expectCornersIntact(page, 'full view, session', 4);
});

test('popup Settings: every category that scrolls keeps its corners', async ({
  context,
  extensionId,
}) => {
  await seedLongList(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  let met = 0;
  for (const name of [
    'Display',
    'Sync & backup',
    'Sessions',
    'Quick access',
    'Recently deleted',
    'Language',
    'About',
    'Help',
  ]) {
    await page.getByRole('button', { name, exact: true }).first().click();
    await page.waitForTimeout(150);
    met += (await scrollersMeetingCorners(page)).length;
    await expectCornersIntact(page, `popup Settings, ${name}`, 0);
  }
  // CONTROL: some category's details scroll into both corners.
  expect(met).toBeGreaterThanOrEqual(2);
});
