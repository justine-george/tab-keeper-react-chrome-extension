import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { previewFile } from './fixtures/previewFile';

// KAN-603. Each tab row in the file and in Edit shows the icon Chrome's cache holds for its page, else the globe.

const BLUE = [20, 90, 220];

// A real 32px PNG, as no-embedded-favicons.spec.ts builds it: Chrome records no icon for an invalid one.
function png(rgb: number[]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(32, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array.from({ length: 32 }, () => rgb).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(32).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A real page with a real icon; context.route records no icon in Chrome's cache.
const server = createServer((request, response) => {
  if (request.url === '/icon.png') {
    response.setHeader('Content-Type', 'image/png');
    response.end(png(BLUE));
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<title>Kiyomizu</title><link rel="icon" href="/icon.png">`);
});
test.beforeAll(
  () =>
    new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
);
// A browser kept open across tests (KAN-766) holds its sockets; close() waits on them.
test.afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((closed) => server.close(() => closed()));
});
const visitedPage = () => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the icon server is not listening on a port');
  }
  return `http://127.0.0.1:${address.port}/kiyomizu`;
};

const NEVER_VISITED = 'https://never-visited.invalid/kyoto';
const SETTINGS = 'chrome://settings/';

// Titles, in row order.
const VISITED = 'Kiyomizu';
const UNVISITED = 'Never visited';
const SETTINGS_TITLE = 'Chrome settings';
const BLANK = 'No address';
const TITLES = [VISITED, UNVISITED, SETTINGS_TITLE, BLANK];

// Visits the page so Chrome caches its icon, and checks Chrome saw it (the premise).
async function visit(context: BrowserContext, worker: Worker): Promise<void> {
  const page = await context.newPage();
  await page.goto(visitedPage());
  await expect
    .poll(() =>
      worker.evaluate(
        async (url) =>
          (await chrome.tabs.query({})).find((t) => t.url === url)
            ?.favIconUrl ?? '',
        visitedPage()
      )
    )
    .toContain('/icon.png');
}

async function openExport(
  context: BrowserContext,
  extensionId: string,
  worker: Worker
): Promise<Page> {
  await visit(context, worker);
  const tab = (tabId: string, title: string, url: string) => ({
    tabId,
    favicon: '',
    title,
    url,
  });
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 'session-icons',
        title: 'Icons',
        isSelected: true,
        windowCount: 1,
        tabCount: 4,
        windows: [
          {
            windowId: 'w-1',
            windowHeight: 800,
            windowWidth: 1200,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 4,
            title: '',
            tabs: [
              tab('t-visited', VISITED, visitedPage()),
              tab('t-unvisited', UNVISITED, NEVER_VISITED),
              tab('t-settings', SETTINGS_TITLE, SETTINGS),
              tab('t-blank', BLANK, ''),
            ],
          },
        ],
      }),
    ]),
    selectedTabGroupId: 'session-icons',
  });
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-icons`
  );
  await expect(
    page.frameLocator('iframe').locator('body[data-icons="ready"]')
  ).toHaveCount(1);
  return page;
}

// Each file row's title and the data URI its slot draws ('' for none).
const fileIcons = (page: Page): Promise<[string, string][]> =>
  page
    .frameLocator('iframe')
    .locator('li.tab')
    .evaluateAll((items) =>
      items.map((li): [string, string] => {
        const title = li.querySelector('a, .plain')?.textContent?.trim() ?? '';
        const slot = li.querySelector('.fav');
        const image = slot ? getComputedStyle(slot).backgroundImage : 'none';
        return [title, /^url\("(.*)"\)$/.exec(image)?.[1] ?? ''];
      })
    );

// The centre pixel of an icon, drawn on an extension page.
const centreOf = (page: Page, icon: string) =>
  page.evaluate(async (icon) => {
    const img = new Image();
    img.src = icon;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.drawImage(img, 0, 0);
    const mid = Math.floor(canvas.width / 2);
    return Array.from(g.getImageData(mid, mid, 1, 1).data).slice(0, 3);
  }, icon);

test('a visited page shows its own icon; an unvisited page and a blank tab the globe; Settings its own', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openExport(context, extensionId, serviceWorker);
  const icons = Object.fromEntries(await fileIcons(page));
  expect(Object.keys(icons)).toEqual(TITLES);
  for (const title of TITLES) {
    expect(icons[title], title).toMatch(/^data:image\/png;base64,/);
  }

  expect(await centreOf(page, icons[VISITED])).toEqual(BLUE);
  const globe = icons[UNVISITED];
  expect(icons[BLANK]).toBe(globe);
  expect(globe).not.toBe(icons[VISITED]);
  expect(icons[SETTINGS_TITLE]).not.toBe(globe);
});

test('dark puts every icon on the plate; light has none', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openExport(context, extensionId, serviceWorker);
  const plates = () =>
    page
      .frameLocator('iframe')
      .locator('.fav')
      .evaluateAll((slots) =>
        slots.map((slot) => getComputedStyle(slot).backgroundColor)
      );

  // PREMISE: the page opens Light. Pressing a pressed option flips the pair, so it is not pressed again.
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect.poll(plates).toEqual(TITLES.map(() => 'rgba(0, 0, 0, 0)'));
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect.poll(plates).toEqual(TITLES.map(() => 'rgb(232, 234, 237)'));
});

test('Comfortable hangs the icon, so the title and the address share one left edge', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openExport(context, extensionId, serviceWorker);
  await page.getByRole('button', { name: 'Comfortable' }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('body')).toHaveClass(/comfortable/);

  const row = frame.locator('li.tab').first();
  const title = await row.locator('a').boundingBox();
  const address = await row.locator('.url').boundingBox();
  const slot = await row.locator('.fav').boundingBox();
  if (!title || !address || !slot) throw new Error('the row is not laid out');
  expect(title.x).toBe(address.x);
  // CONTROL: the icon is beside the block, not above it.
  expect(slot.x + slot.width).toBeLessThan(title.x);
});

test('Edit shows the file’s icon on every tab row, and dims a hidden row’s', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openExport(context, extensionId, serviceWorker);
  const inFile = await fileIcons(page);
  await page.getByRole('button', { name: 'Edit' }).click();

  const images = page.locator('[data-icon-slot] img');
  await expect(images).toHaveCount(TITLES.length);
  expect(
    await images.evaluateAll((all) => all.map((img) => img.getAttribute('src')))
  ).toEqual(inFile.map(([, image]) => image));

  const slot = page.locator('[data-icon-slot]').first();
  await page.getByRole('button', { name: `Hide: ${VISITED}` }).click();
  await expect
    .poll(() => slot.evaluate((el) => Number(getComputedStyle(el).opacity)))
    .toBeLessThan(1);
});

test('hiding the only tab of a site leaves its icon out of the file', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openExport(context, extensionId, serviceWorker);
  const visitedIcon = Object.fromEntries(await fileIcons(page))[VISITED];
  // PREMISE: the file carries it before the hide.
  expect((await previewFile(page, 'tabkeeper-icons-')).html).toContain(
    visitedIcon
  );

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: `Hide: ${VISITED}` }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  const { html } = await previewFile(page, 'tabkeeper-icons-');
  expect(html).not.toContain(VISITED);
  expect(html).not.toContain(visitedIcon);
});
