import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { deflateSync } from 'node:zlib';
import type { Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { openPage, POPUP } from './fixtures/onboarding';
import { pressOpen, saveRowSaveAll } from './fixtures/sessionActions';
import { stored } from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';

// KAN-594. No stored tab keeps an embedded (data:) favicon; a lazy tab takes Chrome's cached icon instead.

const RED = [220, 20, 20];

// A real 32px PNG: a hand-typed one was invalid, and Chrome then records no icon at all.
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

const EMBEDDED_ICON = `data:image/png;base64,${png(RED).toString('base64')}`;

// A page whose icon is embedded, as Chrome then reports it; not context.route, which records no icon.
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(
    `<title>Embedded</title><link rel="icon" href="${EMBEDDED_ICON}">`
  );
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
const embeddedPage = () =>
  `http://127.0.0.1:${(server.address() as AddressInfo).port}/embedded`;

// Visits the page so Chrome caches its icon, and checks Chrome reports it embedded (the premise).
async function visitEmbedded(page: Page, worker: Worker): Promise<void> {
  await page.goto(embeddedPage());
  await expect
    .poll(() =>
      worker.evaluate(
        async (url) =>
          (await chrome.tabs.query({})).find((t) => t.url === url)
            ?.favIconUrl ?? '',
        embeddedPage()
      )
    )
    .toMatch(/^data:image\/png;base64,/);
}

const storedFavicon = async (page: Page, url: string) =>
  (await stored(page)).tabGroups
    .flatMap((g) => g.windows.flatMap((w) => w.tabs))
    .find((t) => t.url === url)?.favicon;

// The centre pixel of an icon address, drawn on an extension page.
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

test('Save all stores a page with an embedded icon with no favicon', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSettings(context, {});
  await visitEmbedded(await context.newPage(), serviceWorker);
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  await saveRowSaveAll(popup).click();
  await expect.poll(() => storedFavicon(popup, embeddedPage())).toBe('');
});

test('a stored embedded icon is dropped on load, and Open gives its lazy tab Chrome’s cached icon', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSettings(context, {});
  await visitEmbedded(await context.newPage(), serviceWorker);
  const target = standIn('Target');
  // As an older build stored it: the embedded icon verbatim.
  await seedSessions(
    context,
    buildContainer([
      buildSession({
        tabGroupId: 's1',
        title: 'Embedded',
        windowCount: 1,
        tabCount: 2,
        windows: [
          {
            windowId: 'w1',
            windowHeight: 600,
            windowWidth: 800,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: 2,
            title: '',
            tabs: [
              { tabId: 't0', favicon: '', title: 'Target', url: target },
              {
                tabId: 't1',
                favicon: EMBEDDED_ICON,
                title: 'Embedded',
                url: embeddedPage(),
              },
            ],
          },
        ],
      }),
    ])
  );
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  await expect.poll(() => storedFavicon(popup, embeddedPage())).toBe('');

  await pressOpen(popup);
  const lazyIcon = () =>
    serviceWorker.evaluate(async (target) => {
      const windows = await chrome.windows.getAll({ populate: true });
      const restored = windows.find((w) =>
        w.tabs?.some((t) => t.url === target)
      );
      const lazy = restored?.tabs?.find((t) => t.index === 1);
      return lazy?.status === 'complete' ? (lazy.favIconUrl ?? '') : null;
    }, target);
  await expect.poll(lazyIcon).toMatch(/^data:image\/png;base64,/);
  // Chrome's cached copy of the page's own icon, not a stand-in.
  expect(await centreOf(popup, (await lazyIcon()) ?? '')).toEqual(RED);
});
