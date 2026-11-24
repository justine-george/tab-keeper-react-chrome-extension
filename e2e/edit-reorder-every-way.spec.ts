import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openSaved, savedWindow, session } from './fixtures/savedWindows';
import { documentLanded } from './fixtures/landed';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';

// KAN-994. Every kind of press that edits a session moves its row up the
// list with the same glide (his ask: no way left that jumps). One test per
// way of pressing, since what can cut a glide differs by way: a button, a
// menu, a rename, a colour, a fold, a drag in the pane, a drop on another
// session's row, a toast's Undo, and another page's write.

const DAY = 86_400_000;
const at = (i: number) => Date.UTC(2026, 10, 1) - i * DAY;
const tab = (id: string, url: string, chromeGroupId?: string) => ({
  tabId: id,
  favicon: '',
  title: id,
  url,
  ...(chromeGroupId === undefined ? {} : { chromeGroupId }),
});
// S3: a window with loose tabs out of site order (one repeated) and a group;
// a second plain window.
const s3 = {
  ...session('S3', 'Trip', [
    {
      ...savedWindow('w1', 'Flights', 0),
      tabs: [
        tab('t-b', 'https://b.test/'),
        tab('t-a', 'https://a.test/'),
        tab('t-a2', 'https://a.test/'),
        tab('g-1', 'https://g1.test/', 'g1'),
        tab('g-2', 'https://g2.test/', 'g1'),
      ],
      tabCount: 5,
      chromeTabGroups: [{ groupId: 'g1', title: 'Booked', color: 'green' }],
    },
    savedWindow('w2', 'Food', 2),
  ]),
  createdAt: at(2),
};
const SESSIONS = [
  {
    ...session('S1', 'One', [savedWindow('o1', 'Window', 2)]),
    createdAt: at(0),
  },
  {
    ...session('S2', 'Two', [savedWindow('o2', 'Window', 2)]),
    createdAt: at(1),
  },
  s3,
  ...[4, 5, 6].map((n) => ({
    ...session(`S${n}`, `Session ${n}`, [savedWindow(`o${n}`, 'Window', 2)]),
    createdAt: at(n - 1),
  })),
];

const row = (id: string) => `[data-pane="sessions"] [data-drag-row-id="${id}"]`;
const DETAIL = '[data-pane="detail"]';
const travelled = (tops: number[], from: number, to: number) =>
  between(tops, from, to).length >= 3;

async function popup(
  context: Parameters<typeof openSaved>[0],
  extensionId: string
): Promise<Page> {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
    selected: 'S3',
    overOrdinaryTab: true,
  });
  await documentLanded(page);
  return page;
}

// Runs `press`, sampling S3's row from just before its last step, and checks
// the row glided from its place to the list's top. `last` is the press that
// commits the edit; `ready` is anything that comes before it.
async function expectGlidesUp(
  page: Page,
  ready: () => Promise<void>,
  last: () => Promise<void>
): Promise<void> {
  const from = await topOf(page.locator(row('S3')));
  const top = await topOf(page.locator(row('S1')));
  await ready();
  await startSampling(page, { edited: row('S3') });
  await last();
  const s = await samples(page);
  await expect(
    page.locator('[data-pane="sessions"] [data-drag-row-id]').first()
  ).toHaveAttribute('data-drag-row-id', 'S3');
  const to = await topOf(page.locator(row('S3')));
  expect(to).toBeCloseTo(top, 0);
  expect(travelled(s.edited, from, to)).toBe(true);
}

const windowMenu = (page: Page, windowId: string) =>
  page
    .locator(
      `${DETAIL} [data-drop-window-id="${windowId}"] [data-window-drag-handle]`
    )
    .getByRole('button', { name: 'More actions', exact: true });
const groupBand = (page: Page) =>
  page.locator(`${DETAIL} [data-band-id="g1"]`).first();
const menuItem = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitem', { name });

test.describe('every way an edit moves a session up glides', () => {
  test('a window menu item: Sort tabs by site', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    await expectGlidesUp(
      page,
      () => windowMenu(page, 'w1').click(),
      () => menuItem(page, 'Sort tabs by site').click()
    );
  });

  test('a window menu item: Remove duplicate tabs', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    await expectGlidesUp(
      page,
      () => windowMenu(page, 'w1').click(),
      () => menuItem(page, /^Remove 1 duplicate tab/).click()
    );
  });

  test('a window rename, committed by a click elsewhere', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    await expectGlidesUp(
      page,
      async () => {
        await page
          .getByRole('button', { name: 'Rename window: Flights', exact: true })
          .click();
        await page.keyboard.type(' booked');
      },
      () =>
        page
          .locator(`${DETAIL} [data-panel="windows"]`)
          .click({ position: { x: 300, y: 380 } })
    );
  });

  test('a group colour', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    await expectGlidesUp(
      page,
      async () => {
        await groupBand(page).hover();
        await page
          .getByRole('button', { name: 'Change group color: Booked' })
          .click();
      },
      () => page.getByRole('menuitemradio', { name: 'Purple' }).click()
    );
  });

  test("a group's fold", async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    await expectGlidesUp(
      page,
      async () => undefined,
      () =>
        page
          .getByRole('button', { name: 'Collapse: Booked', exact: true })
          .click()
    );
  });

  test('a group menu item: Ungroup', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    await expectGlidesUp(
      page,
      async () => {
        await groupBand(page).hover();
        await groupBand(page)
          .getByRole('button', { name: 'More actions', exact: true })
          .first()
          .click();
      },
      () => menuItem(page, 'Ungroup').click()
    );
  });

  test("a tab's Delete, then the toast's Undo glides it back", async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const home = await topOf(page.locator(row('S3')));
    const doomed = page.locator(`${DETAIL} [data-drag-row-id="t-b"]`);
    await expectGlidesUp(
      page,
      () => doomed.hover(),
      () =>
        doomed.getByRole('button', { name: 'Delete tab', exact: true }).click()
    );
    await page.waitForTimeout(400);
    const up = await topOf(page.locator(row('S3')));

    await startSampling(page, { edited: row('S3') });
    await page
      .locator('[role="status"] [data-toast]')
      .getByRole('button', { name: /^Undo/ })
      .click();
    const s = await samples(page);
    expect(await topOf(page.locator(row('S3')))).toBeCloseTo(home, 0);
    expect(travelled(s.edited, up, home)).toBe(true);
  });

  test('a window dragged below the other', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    const handle = page.locator(
      `${DETAIL} [data-drop-window-id="w1"] [data-window-drag-handle]`
    );
    const box = await handle.boundingBox();
    const below = await page
      .locator(`${DETAIL} [data-drop-window-id="w2"]`)
      .boundingBox();
    if (box === null || below === null) throw new Error('no windows');
    const x = box.x + 40;
    await expectGlidesUp(
      page,
      async () => {
        await page.mouse.move(x, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(x, box.y + box.height / 2 + 8);
        await page.mouse.move(x, below.y + below.height - 4, { steps: 10 });
        await page.waitForTimeout(150);
      },
      () => page.mouse.up()
    );
  });

  test("a tab dropped on another session's row moves both up", async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const moving = await page
      .locator(`${DETAIL} [data-drag-row-id="t-a"]`)
      .boundingBox();
    const target = await page.locator(row('S5')).boundingBox();
    if (moving === null || target === null) throw new Error('no rows');
    const s5 = target.y;
    const x = moving.x + 60;
    await page.mouse.move(x, moving.y + moving.height / 2);
    await page.mouse.down();
    await page.mouse.move(x - 8, moving.y + moving.height / 2);
    await page.mouse.move(target.x + 80, target.y + target.height / 2, {
      steps: 12,
    });
    await page.waitForTimeout(150);

    await startSampling(page, { s5: row('S5'), s3: row('S3') });
    await page.mouse.up();
    const s = await samples(page);
    const s5To = await topOf(page.locator(row('S5')));
    expect(s5 - s5To).toBeGreaterThan(40);
    expect(travelled(s.s5, s5, s5To)).toBe(true);
  });

  test('a live tab from Currently open dropped into the session (full view)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: SESSIONS,
      selected: 'S3',
    });
    await documentLanded(page);
    const tabId = await serviceWorker.evaluate(async () => {
      const win = await chrome.windows.create({
        focused: false,
        url: 'data:text/html,<title>Live A</title>',
      });
      return win?.tabs?.[0]?.id ?? -1;
    });
    const live = page.locator(`[data-open-tab-id="${tabId}"]`);
    await expect(live).toBeVisible();
    const target = page.locator(`${DETAIL} [data-drag-row-id="t-a"]`).first();
    await expectGlidesUp(
      page,
      async () => {
        const b = await live.boundingBox();
        const t = await target.boundingBox();
        if (b === null || t === null) throw new Error('no rows');
        const x = b.x + Math.min(60, b.width / 2);
        const y = b.y + b.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 10, { steps: 3 });
        await page.mouse.move(t.x + 80, t.y + t.height * 0.25, { steps: 14 });
        await page.waitForTimeout(200);
      },
      () => page.mouse.up()
    );
  });

  test("another page's edit glides it up here too", async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const from = await topOf(page.locator(row('S3')));
    const top = await topOf(page.locator(row('S1')));
    // A key pressed here last does not make another page's change instant.
    await page.keyboard.press('Shift');

    await startSampling(page, { edited: row('S3') });
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('tabContainerData') ?? '{}');
      const g = d.tabGroups.find(
        (x: { tabGroupId: string }) => x.tabGroupId === 'S3'
      );
      g.title = 'Trip (edited elsewhere)';
      g.contentModified = Date.now();
      g.lastModified = Date.now();
      d.tabGroups = [
        g,
        ...d.tabGroups.filter(
          (x: { tabGroupId: string }) => x.tabGroupId !== 'S3'
        ),
      ];
      d.lastModified = Date.now();
      localStorage.setItem('tabContainerData', JSON.stringify(d));
      new BroadcastChannel('tab-keeper-stored').postMessage('tabContainerData');
    });
    const s = await samples(page);
    await expect(page.locator(row('S3'))).toContainText('edited elsewhere');
    const to = await topOf(page.locator(row('S3')));
    expect(to).toBeCloseTo(top, 0);
    expect(travelled(s.edited, from, to)).toBe(true);
  });

  // His demo: a live tab dropped on the session's header made a new first
  // window, sliding down; its undo and redo drew nothing.
  test("a live tab dropped on the session's header: Undo takes the new window back up, Redo brings it down again", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: SESSIONS,
      selected: 'S3',
    });
    await documentLanded(page);
    const tabId = await serviceWorker.evaluate(async () => {
      const win = await chrome.windows.create({
        focused: false,
        url: 'data:text/html,<title>Live A</title>',
      });
      return win?.tabs?.[0]?.id ?? -1;
    });
    const live = page.locator(`[data-open-tab-id="${tabId}"]`);
    await expect(live).toBeVisible();
    const b = await live.boundingBox();
    if (b === null) throw new Error('no live row');
    const x = b.x + Math.min(60, b.width / 2);
    await page.mouse.move(x, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, b.y + b.height / 2 + 10, { steps: 3 });
    const header = page.locator(`${DETAIL} [data-new-window-target="first"]`);
    await page.mouse.move(x - 200, b.y + 40, { steps: 6 });
    const h = await header.boundingBox();
    if (h === null) throw new Error('no header target');
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2, { steps: 10 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    const NEW_WINDOW = `${DETAIL} [data-drop-window-id]:not([data-drop-window-id^="w"]):not([data-drop-window-id^="new-window"])`;
    await expect(page.locator(NEW_WINDOW)).toHaveCount(1);
    await page.waitForTimeout(500);
    await page.mouse.move(0, 0);
    const place = await topOf(page.locator(NEW_WINDOW));
    const w1 = `${DETAIL} [data-drop-window-id="w1"]`;
    const w1Down = await topOf(page.locator(w1));

    await startSampling(page, {
      w1,
      'copy:op': '[data-leaving-row]',
      held: '[data-leaving-row] > *',
    });
    await page.locator('[role="button"][aria-label="Undo"]').click();
    const u = await samples(page);
    await expect(page.locator(NEW_WINDOW)).toHaveCount(0);
    const w1Up = await topOf(page.locator(w1));
    expect(travelled(u.w1, w1Down, w1Up)).toBe(true);
    // Went back up under the edge it came from, and never faded.
    expect(Math.max(...u.copies)).toBeGreaterThan(0);
    expect(travelled(u.held, place - (w1Down - w1Up), place)).toBe(true);
    expect(u['copy:op'].some((v) => v > 0.05 && v < 0.95)).toBe(false);

    await startSampling(page, { w1, arrived: NEW_WINDOW });
    await page.locator('[role="button"][aria-label="Redo"]').click();
    const r = await samples(page);
    await expect(page.locator(NEW_WINDOW)).toHaveCount(1);
    expect(travelled(r.w1, w1Up, w1Down)).toBe(true);
    expect(travelled(r.arrived, place - (w1Down - w1Up), place)).toBe(true);
  });

  test('a tab dragged within the session: Undo glides it back to its place', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const tabRow = (id: string) =>
      page.locator(`${DETAIL} [data-drag-row-id="${id}"]`).first();
    const home = await topOf(tabRow('t-a'));
    const moving = await tabRow('t-a').boundingBox();
    const upper = await tabRow('t-b').boundingBox();
    if (moving === null || upper === null) throw new Error('no tab rows');
    const x = moving.x + 60;
    await page.mouse.move(x, moving.y + moving.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, moving.y + moving.height / 2 - 8);
    await page.mouse.move(x, upper.y + 3, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const moved = await topOf(tabRow('t-a'));
    expect(home - moved).toBeGreaterThan(20);
    await page.mouse.move(0, 0);

    await startSampling(page, { moved: `${DETAIL} [data-drag-row-id="t-a"]` });
    await page.locator('[role="button"][aria-label="Undo"]').click();
    const u = await samples(page);
    expect(await topOf(tabRow('t-a'))).toBeCloseTo(home, 0);
    expect(travelled(u.moved, moved, home)).toBe(true);
  });

  test('a session dragged up the list: Undo glides it back', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const home = await topOf(page.locator(row('S5')));
    const s5 = await page.locator(row('S5')).boundingBox();
    const s1 = await page.locator(row('S1')).boundingBox();
    if (s5 === null || s1 === null) throw new Error('no session rows');
    const x = s5.x + 60;
    await page.mouse.move(x, s5.y + s5.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, s5.y + s5.height / 2 - 8);
    await page.mouse.move(x, s1.y + 4, { steps: 10 });
    await page.mouse.up();
    await expect(
      page.locator('[data-pane="sessions"] [data-drag-row-id]').first()
    ).toHaveAttribute('data-drag-row-id', 'S5');
    await page.waitForTimeout(500);
    const up = await topOf(page.locator(row('S5')));
    await page.mouse.move(0, 0);

    await startSampling(page, { s5: row('S5') });
    await page.locator('[role="button"][aria-label="Undo"]').click();
    const u = await samples(page);
    expect(await topOf(page.locator(row('S5')))).toBeCloseTo(home, 0);
    expect(travelled(u.s5, up, home)).toBe(true);
  });

  // His demo: an undo that left the shown session as it was kept its glide
  // waiting, and the next session picked was drawn as that glide, ghost rows
  // and all. It now stops waiting at the next frame.
  test('an undo that changes nothing on screen leaves the next pick of a session still', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const moving = await page
      .locator(`${DETAIL} [data-drag-row-id="t-a"]`)
      .boundingBox();
    const target = await page.locator(row('S5')).boundingBox();
    if (moving === null || target === null) throw new Error('no rows');
    const x = moving.x + 60;
    await page.mouse.move(x, moving.y + moving.height / 2);
    await page.mouse.down();
    await page.mouse.move(x - 8, moving.y + moving.height / 2);
    await page.mouse.move(target.x + 80, target.y + target.height / 2, {
      steps: 12,
    });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(600);
    // Show S6, then undo: the undo puts S3 back on screen, a swap drawn at
    // once; then pick S2 at once, another swap.
    await page.locator(row('S6')).click({ position: { x: 40, y: 12 } });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const seen = { copies: 0, slides: 0 };
      (window as unknown as { __still: typeof seen }).__still = seen;
      const t0 = performance.now();
      const tick = () => {
        seen.copies = Math.max(
          seen.copies,
          document.querySelectorAll('[data-pane="detail"] [data-leaving-row]')
            .length
        );
        const pane = document.querySelector('[data-pane="detail"]');
        seen.slides = Math.max(
          seen.slides,
          (pane?.getAnimations({ subtree: true }) ?? []).filter(
            (a) => a.id === 'landing-slide' || a.id === 'layout-glide'
          ).length
        );
        if (performance.now() - t0 < 900) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator('[role="button"][aria-label="Undo"]').click();
    await page.waitForTimeout(100);
    await page.locator(row('S2')).click({ position: { x: 40, y: 12 } });
    await page.waitForTimeout(800);
    const still = await page.evaluate(
      () =>
        (window as unknown as { __still: { copies: number; slides: number } })
          .__still
    );
    expect(still).toEqual({ copies: 0, slides: 0 });
  });

  test('the moving row is drawn over the rows it passes', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    await page.evaluate(() => {
      const hits: string[] = [];
      (window as unknown as { __hits: string[] }).__hits = hits;
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(
          '[data-pane="sessions"] [data-drag-row-id="S3"]'
        );
        const r = el?.getBoundingClientRect();
        if (r) {
          const top = document.elementFromPoint(
            r.left + 30,
            r.top + r.height / 2
          );
          hits.push(
            top
              ?.closest('[data-drag-row-id]')
              ?.getAttribute('data-drag-row-id') ?? ''
          );
        }
        if (performance.now() - t0 < 700) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const doomed = page.locator(`${DETAIL} [data-drag-row-id="t-b"]`);
    await doomed.hover();
    await doomed
      .getByRole('button', { name: 'Delete tab', exact: true })
      .click();
    await page.waitForTimeout(900);
    const hits = await page.evaluate(
      () => (window as unknown as { __hits: string[] }).__hits
    );
    // On every frame, the point at the middle of S3's row is S3's.
    expect(hits.length).toBeGreaterThan(20);
    expect(hits.filter((h) => h !== 'S3')).toEqual([]);
  });
});
