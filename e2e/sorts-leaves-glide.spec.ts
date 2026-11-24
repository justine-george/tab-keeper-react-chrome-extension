import type { Locator, Page, Worker } from '@playwright/test';

// Saved groups draw as bands only with tabGroups, so every spec here needs the grant.
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { bandHandle, openSaved, session } from './fixtures/savedWindows';
import { documentLanded, elementLanded } from './fixtures/landed';
import { standIn } from './fixtures/standInPages';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';
import { openNowWindowMenu } from './fixtures/menus';
import type {
  chromeTabGroupData,
  tabData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-996 (his picks, rounds 3 and 4: 1-B, 2-B, 3-B, 4-G, 5-B, 6-B). The sorts
// glide every row (a group as one) to its place; Remove duplicates fades the
// copies as a delete does and lights up the tabs they copied; Ungroup fades
// the header and glides the tabs out, up and left; End split view fades the
// split marks. Undo plays each backwards and Redo again. From the keyboard
// and under Reduce motion it all happens at once.

const DETAIL = '[data-pane="detail"]';
const OPEN_NOW = '[data-pane="open-now"]';

const tab = (
  id: string,
  url: string,
  more: Partial<tabData> = {}
): tabData => ({
  tabId: id,
  favicon: '',
  title: `Page ${id}`,
  url,
  ...more,
});
const win = (
  id: string,
  tabs: tabData[],
  chromeTabGroups: chromeTabGroupData[] = []
): windowGroupData => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: 'Trip',
  tabs,
  chromeTabGroups,
});
const OTHERS = ['S2', 'S3', 'S4'].map((id) =>
  session(id, `Session ${id}`, [
    win(`${id}-w`, [tab(`${id}-t0`, `https://${id}.test/`)]),
  ])
);

async function popup(
  context: Parameters<typeof openSaved>[0],
  extensionId: string,
  windows: windowGroupData[],
  settings: Record<string, unknown> = {}
): Promise<Page> {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [session('S1', 'Zen trip', windows), ...OTHERS],
    settings,
  });
  await documentLanded(page);
  return page;
}

const savedRow = (id: string) => `${DETAIL} [data-saved-tab-row="${id}"]`;
const windowMenu = (page: Page, windowId: string) =>
  page
    .locator(
      `${DETAIL} [data-drop-window-id="${windowId}"] [data-window-drag-handle]`
    )
    .getByRole('button', { name: 'More actions', exact: true });
const groupMenu = (page: Page, groupId: string) =>
  bandHandle(page, groupId).getByRole('button', { name: /^More actions/ });
const item = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitem', { name, exact: typeof name === 'string' });
const undo = (page: Page) => page.locator('[role="button"][aria-label="Undo"]');
const redo = (page: Page) => page.locator('[role="button"][aria-label="Redo"]');

// Presses `act`, samples `targets` for `ms`, and returns the samples once it is over.
async function sampled(
  page: Page,
  targets: Record<string, string>,
  act: () => Promise<void>,
  ms = 1000
) {
  await startSampling(page, targets, ms);
  await act();
  await page.mouse.move(0, 0);
  // Named without the sampler's suffix: "x1:lit" reads as x1.
  return Object.fromEntries(
    Object.entries(await samples(page)).map(([k, v]) => [
      k.replace(/:(lit|x|op)$/, ''),
      v,
    ])
  );
}
const glided = (tops: number[], from: number, to: number) =>
  Math.abs(to - from) > 10 && between(tops, from, to).length >= 3;
// A fade seen part way: some frame strictly between gone and there.
const partWay = (ops: number[]) => ops.some((o) => o > 0.05 && o < 0.95);

// Sites a, b, c, a: Sort tabs by site brings a2 up beside a1 (sites keep the order they first appear in).
const SITES = win('w1', [
  tab('a1', 'https://a.test/1'),
  tab('b1', 'https://b.test/1'),
  tab('c1', 'https://c.test/1'),
  tab('a2', 'https://a.test/2'),
]);

test.describe('Sort tabs by site, saved', () => {
  test('the rows glide to their places; Undo glides them back, Redo again', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, [SITES]);
    const a2 = page.locator(savedRow('a2'));
    const from = await topOf(a2);

    const s = await sampled(page, { a2: savedRow('a2') }, async () => {
      await windowMenu(page, 'w1').click();
      await item(page, 'Sort tabs by site').click();
    });
    const to = await topOf(a2);
    expect(from - to).toBeGreaterThan(30);
    expect(glided(s.a2, from, to)).toBe(true);

    const back = await sampled(page, { a2: savedRow('a2') }, () =>
      undo(page).click()
    );
    expect(await topOf(a2)).toBeCloseTo(from, 0);
    expect(glided(back.a2, to, from)).toBe(true);

    const again = await sampled(page, { a2: savedRow('a2') }, () =>
      redo(page).click()
    );
    expect(await topOf(a2)).toBeCloseTo(to, 0);
    expect(glided(again.a2, from, to)).toBe(true);
  });

  test('from the keyboard it is instant', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId, [SITES]);
    const a2 = page.locator(savedRow('a2'));
    const from = await topOf(a2);
    await windowMenu(page, 'w1').click();
    await item(page, 'Sort tabs by site').focus();

    const s = await sampled(page, { a2: savedRow('a2') }, () =>
      page.keyboard.press('Enter')
    );
    const to = await topOf(a2);
    expect(from - to).toBeGreaterThan(30);
    expect(between(s.a2, from, to)).toEqual([]);
  });
});

test('Sort groups by name, saved: each group glides as one; Undo glides back', async ({
  context,
  extensionId,
}) => {
  const groups = [
    { groupId: 'gz', title: 'Zen', color: 'red' },
    { groupId: 'ga', title: 'Art', color: 'blue' },
  ] as chromeTabGroupData[];
  const page = await popup(context, extensionId, [
    win(
      'w1',
      [
        tab('z1', 'https://z.test/1', { chromeGroupId: 'gz' }),
        tab('z2', 'https://z.test/2', { chromeGroupId: 'gz' }),
        tab('r1', 'https://r.test/1', { chromeGroupId: 'ga' }),
        tab('r2', 'https://r.test/2', { chromeGroupId: 'ga' }),
      ],
      groups
    ),
  ]);
  const art = `${DETAIL} [data-band-id="ga"][role="group"]`;
  const from = await topOf(page.locator(art));

  const s = await sampled(page, { art, r2: savedRow('r2') }, async () => {
    await windowMenu(page, 'w1').click();
    await item(page, 'Sort groups by name').click();
  });
  const to = await topOf(page.locator(art));
  expect(from - to).toBeGreaterThan(50);
  expect(glided(s.art, from, to)).toBe(true);
  // Its rows ride with it: none moves on its own against the band.
  const offsets = s.art.map((top, i) => s.r2[i] - top);
  expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(1);

  const back = await sampled(page, { art }, () => undo(page).click());
  expect(glided(back.art, to, from)).toBe(true);
});

// x, y, x, z, y: the second x and the second y go; the first of each lights up.
const DUPS = win('w1', [
  tab('x1', 'https://x.test/'),
  tab('y1', 'https://y.test/'),
  tab('x2', 'https://x.test/'),
  tab('z1', 'https://z.test/'),
  tab('y2', 'https://y.test/'),
]);

test.describe('Remove duplicate tabs, saved', () => {
  test('the copies fade as the rows close up, and the tabs they copied light up; Undo lights the copies that come back', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, [DUPS]);
    const z1 = page.locator(savedRow('z1'));
    const from = await topOf(z1);
    const watch = {
      'x1:lit': `${savedRow('x1')}`,
      'y1:lit': `${savedRow('y1')}`,
      z1: savedRow('z1'),
      'z1lit:lit': `${savedRow('z1')}`,
    };

    const s = await sampled(page, watch, async () => {
      await windowMenu(page, 'w1').click();
      await item(page, 'Remove 2 duplicate tabs').click();
    });
    const to = await topOf(z1);
    await expect(page.locator(`${DETAIL} [data-saved-tab-row]`)).toHaveCount(3);
    expect(glided(s.z1, from, to)).toBe(true);
    expect(Math.max(...s.copies)).toBeGreaterThan(0);
    expect(Math.max(...s.x1)).toBe(1);
    expect(Math.max(...s.y1)).toBe(1);
    // Only the kept copies light, and the light goes again.
    expect(Math.max(...s.z1lit)).toBe(0);
    expect(s.x1[s.x1.length - 1]).toBe(0);
    await expect(page.locator('[data-leaving-row]')).toHaveCount(0);

    const back = await sampled(
      page,
      {
        'x2:lit': `${savedRow('x2')}`,
        'y2:lit': `${savedRow('y2')}`,
        'x1:lit': `${savedRow('x1')}`,
      },
      () => undo(page).click()
    );
    await expect(page.locator(`${DETAIL} [data-saved-tab-row]`)).toHaveCount(5);
    expect(Math.max(...back.x2.filter((v) => !Number.isNaN(v)))).toBe(1);
    expect(Math.max(...back.y2.filter((v) => !Number.isNaN(v)))).toBe(1);
    expect(Math.max(...back.x1)).toBe(0);

    const again = await sampled(page, { 'x1:lit': `${savedRow('x1')}` }, () =>
      redo(page).click()
    );
    expect(Math.max(...again.x1)).toBe(1);
  });

  test('with Reduce motion nothing fades, glides or lights', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, [DUPS]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const from = await topOf(page.locator(savedRow('z1')));

    const s = await sampled(
      page,
      { 'x1:lit': `${savedRow('x1')}`, z1: savedRow('z1') },
      async () => {
        await windowMenu(page, 'w1').click();
        await item(page, 'Remove 2 duplicate tabs').click();
      }
    );
    const to = await topOf(page.locator(savedRow('z1')));
    expect(from - to).toBeGreaterThan(30);
    expect(between(s.z1, from, to)).toEqual([]);
    expect(Math.max(...s.copies)).toBe(0);
    expect(Math.max(...s.x1)).toBe(0);
  });
});

test('Ungroup, saved: the header fades and the tabs glide up and left; Undo glides them back', async ({
  context,
  extensionId,
}) => {
  const page = await popup(context, extensionId, [
    win(
      'w1',
      [
        tab('f1', 'https://f.test/1', { chromeGroupId: 'gf' }),
        tab('f2', 'https://f.test/2', { chromeGroupId: 'gf' }),
        tab('p1', 'https://p.test/1'),
      ],
      [{ groupId: 'gf', title: 'Food', color: 'yellow' } as chromeTabGroupData]
    ),
  ]);
  const f2 = page.locator(savedRow('f2'));
  const [fromY, fromX] = [await topOf(f2), (await f2.boundingBox())!.x];

  const s = await sampled(
    page,
    { y: savedRow('f2'), 'x:x': `${savedRow('f2')}` },
    async () => {
      await bandHandle(page, 'gf').hover();
      await groupMenu(page, 'gf').click();
      await item(page, 'Ungroup').click();
    }
  );
  await expect(page.locator(`${DETAIL} [data-band-id]`)).toHaveCount(0);
  const [toY, toX] = [await topOf(f2), (await f2.boundingBox())!.x];
  expect(fromY - toY).toBeGreaterThan(20);
  expect(fromX - toX).toBeGreaterThan(8);
  expect(glided(s.y, fromY, toY)).toBe(true);
  expect(between(s.x, fromX, toX).length).toBeGreaterThanOrEqual(3);
  // The header and strip leave as a copy; the tabs leave none.
  expect(Math.max(...s.copies)).toBeGreaterThan(0);

  const back = await sampled(page, { 'x:x': `${savedRow('f2')}` }, () =>
    undo(page).click()
  );
  await expect(page.locator(`${DETAIL} [data-band-id]`)).toHaveCount(1);
  expect(between(back.x, toX, fromX).length).toBeGreaterThanOrEqual(3);
});

test('End split view, saved: the marks fade out; Undo fades them in', async ({
  context,
  extensionId,
}) => {
  const page = await popup(context, extensionId, [
    win('w1', [
      tab('a', 'https://a.test/'),
      tab('h1', 'https://h.test/1', { splitId: 'sp' }),
      tab('h2', 'https://h.test/2', { splitId: 'sp' }),
    ]),
  ]);
  await expect(page.locator(`${DETAIL} [data-split]`)).toHaveCount(2);
  const h1 = page.locator(savedRow('h1'));
  const from = await topOf(h1);

  const s = await sampled(
    page,
    { 'mark:op': '[data-leaving-mark]', h1: savedRow('h1') },
    async () => {
      await h1.click({ button: 'right' });
      await item(page, 'End split view').click();
    }
  );
  await expect(page.locator(`${DETAIL} [data-split]`)).toHaveCount(0);
  expect(partWay(s.mark)).toBe(true);
  // Nothing moves.
  expect(s.h1.every((top) => Math.abs(top - from) < 1)).toBe(true);
  await expect(page.locator('[data-leaving-mark]')).toHaveCount(0);

  const back = await sampled(
    page,
    { 'mark:op': `${savedRow('h1')} [data-split]` },
    () => undo(page).click()
  );
  await expect(page.locator(`${DETAIL} [data-split]`)).toHaveCount(2);
  expect(partWay(back.mark)).toBe(true);
});

test('the sessions sort menu: every row glides to its place; Undo glides back', async ({
  context,
  extensionId,
}) => {
  const page = await popup(context, extensionId, [SITES]);
  // Zen trip is first; by name it goes below Session S4.
  const row = '[data-pane="sessions"] [data-drag-row-id="S1"]';
  const from = await topOf(page.locator(row));

  const s = await sampled(page, { row }, async () => {
    await page.getByRole('button', { name: /^Sort/ }).first().click();
    await page.getByRole('menuitemradio', { name: 'Name' }).click();
  });
  const to = await topOf(page.locator(row));
  expect(to - from).toBeGreaterThan(50);
  expect(glided(s.row, from, to)).toBe(true);

  const back = await sampled(page, { row }, () => undo(page).click());
  expect(await topOf(page.locator(row))).toBeCloseTo(from, 0);
  expect(glided(back.row, to, from)).toBe(true);
});

// Currently open: Chrome makes the change, and the glide draws Open now's next read.

const onSite = (name: string, site: string) => {
  const url = new URL(standIn(name));
  url.hostname = `${site}.localhost`;
  return url.href;
};

async function liveWindow(
  worker: Worker,
  urls: string[],
  { group, split }: { group?: number[]; split?: [number, number] } = {}
): Promise<{ windowId: number; tabIds: number[] }> {
  return worker.evaluate(
    async ({ urls, group, split }) => {
      const w = await chrome.windows.create({ url: urls, focused: false });
      const tabIds = (w?.tabs ?? []).map((t) => t.id ?? -1);
      const [first, ...rest] = (group ?? []).map((i) => tabIds[i]);
      if (first !== undefined) {
        const g = await chrome.tabs.group({
          tabIds: [first, ...rest],
          createProperties: { windowId: w?.id },
        });
        await chrome.tabGroups.update(g, { title: 'Food', color: 'yellow' });
      }
      if (split) {
        const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
        if (typeof createSplit !== 'function')
          throw new Error('no createSplit');
        await Reflect.apply(createSplit, chrome.tabs, [
          split.map((i) => tabIds[i]),
        ]);
      }
      return { windowId: w?.id ?? -1, tabIds };
    },
    { urls, group, split }
  );
}

async function tabView(
  context: Parameters<typeof openSaved>[0],
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const liveBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);
const liveRow = (windowId: number, tabId: number) =>
  `${OPEN_NOW} [data-open-window-id="${windowId}"] [data-open-tab-id="${tabId}"]`;
async function liveWindowItem(page: Page, block: Locator, name: string) {
  await block.locator('[data-window-row]').hover();
  await openNowWindowMenu(block).click();
  await item(page, name).click();
}

test.describe('in Currently open', () => {
  test('Sort tabs by site: the rows glide to their places; Undo glides them back', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await tabView(context, extensionId);
    const w = await liveWindow(serviceWorker, [
      onSite('a1', 'aa'),
      onSite('b1', 'bb'),
      onSite('c1', 'cc'),
      onSite('a2', 'aa'),
    ]);
    const block = liveBlock(page, w.windowId);
    await expect(block.locator('[data-open-tab-id]')).toHaveCount(4);
    const a2 = liveRow(w.windowId, w.tabIds[3]);
    await elementLanded(page.locator(a2), 'ancestors');
    const from = await topOf(page.locator(a2));

    const s = await sampled(
      page,
      { a2 },
      () => liveWindowItem(page, block, 'Sort tabs by site'),
      1500
    );
    const to = await topOf(page.locator(a2));
    expect(from - to).toBeGreaterThan(30);
    expect(glided(s.a2, from, to)).toBe(true);

    const back = await sampled(page, { a2 }, () => undo(page).click(), 1500);
    await expect.poll(() => topOf(page.locator(a2))).toBeCloseTo(from, 0);
    expect(glided(back.a2, to, from)).toBe(true);
  });

  test('Ungroup: the tabs glide out, up and left', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await tabView(context, extensionId);
    const w = await liveWindow(
      serviceWorker,
      [standIn('One'), standIn('Two'), standIn('Three')],
      { group: [1, 2] }
    );
    const block = liveBlock(page, w.windowId);
    await expect(block.locator('[data-band-id]')).toHaveCount(1);
    const three = liveRow(w.windowId, w.tabIds[2]);
    await elementLanded(page.locator(three), 'ancestors');
    const box = (await page.locator(three).boundingBox())!;

    const s = await sampled(
      page,
      { y: three, 'x:x': `${three}` },
      async () => {
        const head = block.locator('[data-group-drag-handle]');
        await head.hover();
        await head.getByRole('button', { name: /^More actions/ }).click();
        await item(page, 'Ungroup').click();
      },
      1500
    );
    await expect(block.locator('[data-band-id]')).toHaveCount(0);
    const after = (await page.locator(three).boundingBox())!;
    expect(box.y - after.y).toBeGreaterThan(20);
    expect(box.x - after.x).toBeGreaterThan(8);
    expect(glided(s.y, box.y, after.y)).toBe(true);
    expect(between(s.x, box.x, after.x).length).toBeGreaterThanOrEqual(3);
  });

  test('End split view: the marks fade out; Undo fades them in', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await tabView(context, extensionId);
    const w = await liveWindow(
      serviceWorker,
      [standIn('Notes'), standIn('Map'), standIn('Plan')],
      { split: [1, 2] }
    );
    const block = liveBlock(page, w.windowId);
    await expect(block.locator('[data-split]')).toHaveCount(2);

    const s = await sampled(
      page,
      { 'mark:op': '[data-leaving-mark]' },
      async () => {
        await page
          .locator(liveRow(w.windowId, w.tabIds[1]))
          .click({ button: 'right' });
        await item(page, 'End split view').click();
      },
      1500
    );
    await expect(block.locator('[data-split]')).toHaveCount(0);
    expect(partWay(s.mark)).toBe(true);

    const back = await sampled(
      page,
      { 'mark:op': `${liveRow(w.windowId, w.tabIds[1])} [data-split]` },
      () => undo(page).click(),
      1500
    );
    await expect(block.locator('[data-split]')).toHaveCount(2);
    expect(partWay(back.mark)).toBe(true);
  });

  test('Remove duplicate tabs: the tabs the copies copied light up', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await tabView(context, extensionId);
    const w = await liveWindow(serviceWorker, [
      standIn('Map'),
      standIn('Plan'),
      standIn('Map'),
    ]);
    const block = liveBlock(page, w.windowId);
    await expect(block.locator('[data-open-tab-id]')).toHaveCount(3);
    await elementLanded(block, 'ancestors');

    const s = await sampled(
      page,
      {
        'kept:lit': `${liveRow(w.windowId, w.tabIds[0])}`,
        'plan:lit': `${liveRow(w.windowId, w.tabIds[1])}`,
      },
      () => liveWindowItem(page, block, 'Remove 1 duplicate tab'),
      1500
    );
    await expect(block.locator('[data-open-tab-id]')).toHaveCount(2);
    expect(Math.max(...s.kept)).toBe(1);
    expect(Math.max(...s.plan)).toBe(0);
  });
});
