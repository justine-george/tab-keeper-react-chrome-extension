import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-360. The dashed slot a dragged GROUP will land in, against where the
// release actually puts it.
//
// Dragged down past another group, the slot was drawn a row or more ABOVE the
// landing, over real rows, while the real gap opened in the right place and
// stayed empty. Dragged up it was right. Measured on a0a91b1 (and identically
// on main ac76ee0) with Watchlist held over Rotten Tomatoes: the slot at
// 366..398, on top of Spotify at 364..396, and released there Watchlist's
// title row came to rest at 398.
//
// The cause is the size of what is passed: a group is held FOLDED, one title
// row tall, while the group it passes is drawn whole. Every case below passes
// a group taller than the held one, and every upward one is a CONTROL.
//
// 790x550, the real popup. One window, nothing scrolled, and every aim clear
// of the bottom auto-scroll zone so the list never moves under the hold.

const tab = (id: string, title: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

// Items: Extensions, Watchlist (2), Ratings (2), Soundtrack (1), Snacks (1).
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
const TAB_IDS = TABS.map((t) => t.tabId);

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 's',
        title: 'Movie night',
        isSelected: true,
        windowCount: 1,
        tabCount: TABS.length,
        windows: [
          {
            windowId: 'win',
            windowHeight: 1080,
            windowWidth: 1920,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: TABS.length,
            title: 'Pick tonight',
            tabs: TABS,
            chromeTabGroups: GROUPS,
          },
        ],
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

// Until every row the preview moved has arrived: two frames, then each
// running transition's own end, until none is left.
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

interface Span {
  top: number;
  bottom: number;
}

async function spanOf(page: Page, selector: string): Promise<Span> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not drawn`);
  return { top: box.y, bottom: box.y + box.height };
}

const band = (groupId: string) => `[data-band-id="${groupId}"]`;
const titleRow = (groupId: string) =>
  `${band(groupId)} [data-fixed-row-id="${groupId}"]`;

// Pick `groupId` up by its title row, and stop once the drag has started:
// the held group is folded and nothing has stepped aside yet.
async function pickUp(page: Page, groupId: string): Promise<number> {
  const handle = await page
    .locator(`[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`)
    .boundingBox();
  if (handle === null) throw new Error(`no handle for ${groupId}`);
  const x = handle.x + 40;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  await expect(page.locator('[data-drag-landing-slot]')).toBeAttached();
  await settled(page);
  return x;
}

// What the hold shows: the slot, and every row it must not sit on -- each
// tab row and group title row that is drawn and is not the held group's.
async function preview(page: Page) {
  return page.evaluate((tabIds) => {
    const span = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height };
    };
    const slot = document.querySelector('[data-drag-landing-slot]');
    const held = document.querySelector('[data-drag-held]');
    const rows = [
      ...tabIds.map((id) =>
        document.querySelector(`[data-drag-row-id="${id}"]`)
      ),
      ...document.querySelectorAll('[data-band-id] [data-fixed-row-id]'),
    ].flatMap((el) => {
      if (el === null || (held !== null && held.contains(el))) return [];
      const key =
        el instanceof HTMLElement
          ? (el.dataset.dragRowId ?? el.dataset.fixedRowId ?? '?')
          : '?';
      const s = span(el);
      return s.height > 0 ? [{ key, top: s.top, bottom: s.bottom }] : [];
    });
    return { slot: slot === null ? null : span(slot), rows };
  }, TAB_IDS);
}

// The rows the slot sits on, by more than a sub-pixel sliver.
function overlapped(p: Awaited<ReturnType<typeof preview>>): string[] {
  const slot = p.slot;
  if (slot === null) return ['no slot drawn'];
  return p.rows
    .filter(
      (r) => Math.min(r.bottom, slot.bottom) - Math.max(r.top, slot.top) > 1
    )
    .map((r) => `${r.key} ${r.top}..${r.bottom}`);
}

const bandOrder = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-band-id]')].map(
      (el) => el.dataset.bandId
    )
  );

interface Case {
  name: string;
  held: string;
  // The folded item the pointer is aimed into, and how far down it.
  aimInto: string;
  frac: number;
  landsAs: string[];
}

const CASES: Case[] = [
  {
    name: 'down past one group',
    held: 'watch',
    aimInto: 'ratings',
    frac: 0.75,
    landsAs: ['ratings', 'watch', 'sound', 'snacks'],
  },
  {
    name: 'down past two groups',
    held: 'watch',
    aimInto: 'sound',
    frac: 0.75,
    landsAs: ['ratings', 'sound', 'watch', 'snacks'],
  },
  // INSIDE the list: past its end the release lands back at its own place.
  {
    name: 'down to the end of the window',
    held: 'watch',
    aimInto: 'snacks',
    frac: 0.75,
    landsAs: ['ratings', 'sound', 'snacks', 'watch'],
  },
  {
    name: 'CONTROL: up past one group',
    held: 'snacks',
    aimInto: 'sound',
    frac: 0.25,
    landsAs: ['watch', 'ratings', 'snacks', 'sound'],
  },
  {
    name: 'CONTROL: up past two groups',
    held: 'snacks',
    aimInto: 'ratings',
    frac: 0.25,
    landsAs: ['watch', 'snacks', 'ratings', 'sound'],
  },
  {
    name: 'CONTROL: up past every group',
    held: 'snacks',
    aimInto: 'watch',
    frac: 0.25,
    landsAs: ['snacks', 'watch', 'ratings', 'sound'],
  },
];

test.describe('a dragged group is shown landing where it lands', () => {
  for (const c of CASES) {
    test(c.name, async ({ context, extensionId }) => {
      const page = await open(context, extensionId);
      const x = await pickUp(page, c.held);

      // Aimed in the FOLDED layout the drag measured, read now that the
      // held group has folded and before anything has stepped aside.
      const target = await spanOf(page, band(c.aimInto));
      await page.mouse.move(
        x,
        target.top + (target.bottom - target.top) * c.frac,
        { steps: 12 }
      );
      await settled(page);
      const held = await preview(page);
      await page.mouse.up();

      await expect.poll(() => bandOrder(page)).toEqual(c.landsAs);
      await settled(page);
      const landed = await spanOf(page, titleRow(c.held));

      const slotTop = held.slot?.top ?? Number.NaN;
      console.log(
        `${c.name}: slot ${slotTop}..${held.slot?.bottom}, landed title row ${
          landed.top
        }..${landed.bottom}, slot sits on [${overlapped(held).join(', ')}]`
      );
      expect(Math.abs(slotTop - landed.top)).toBeLessThanOrEqual(1);
      expect(overlapped(held)).toEqual([]);
    });
  }
});
