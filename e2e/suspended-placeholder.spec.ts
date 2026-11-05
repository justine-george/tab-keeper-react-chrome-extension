import { chromium, expect, test, type Worker } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { standIn } from './fixtures/standInPages';

// KAN-929. A suspender that caught a tab still waiting to load stored our
// placeholder as its page, and cannot go back to it. Focus loads the real page.

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

// A stand-in suspender: another extension with a suspend page and a page that is not one.
function writeSuspender(dir: string): string {
  const suspender = join(dir, 'suspender');
  mkdirSync(suspender);
  writeFileSync(
    join(suspender, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Stand-in suspender',
      version: '1',
      background: { service_worker: 'sw.js' },
    })
  );
  writeFileSync(join(suspender, 'sw.js'), '');
  for (const page of ['suspended.html', 'welcome.html']) {
    writeFileSync(join(suspender, page), `<title>${page}</title>`);
  }
  return suspender;
}

const placeholderFor = (page: string): string =>
  'data:text/html;base64,' +
  Buffer.from(
    `<html><body><a href="${page}"><p>${page}</p></a></body></html>`
  ).toString('base64');

async function launched(run: (at: Scene) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'tabkeeper-suspended-'));
  const suspender = writeSuspender(dir);
  const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
    headless: true,
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${DIST},${suspender}`,
      `--load-extension=${DIST},${suspender}`,
    ],
  });
  try {
    await expect
      .poll(() => context.serviceWorkers().length)
      .toBeGreaterThanOrEqual(2);
    const workers = context.serviceWorkers();
    const tabKeeper = workers.find((w) => w.url().endsWith('/background.js'));
    const other = workers.find((w) => w.url().endsWith('/sw.js'));
    if (tabKeeper === undefined || other === undefined) {
      throw new Error('workers not found');
    }
    await run({ tabKeeper, otherId: new URL(other.url()).host });
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

type Scene = { tabKeeper: Worker; otherId: string };

const inBackground = (worker: Worker, url: string) =>
  worker.evaluate(
    async (address) =>
      (await chrome.tabs.create({ url: address, active: false })).id ?? -1,
    url
  );
const focus = (worker: Worker, tabId: number) =>
  worker.evaluate(
    async (id) => void (await chrome.tabs.update(id, { active: true })),
    tabId
  );
const urlOf = (worker: Worker, tabId: number) =>
  worker.evaluate(async (id) => (await chrome.tabs.get(id)).url ?? '', tabId);

const page = (otherId: string, name: string, value: string) =>
  `chrome-extension://${otherId}/${name}?title=T&url=${encodeURIComponent(
    value
  )}&time=1`;

test('focusing a suspended tab that wraps our placeholder loads the real page', async () => {
  await launched(async ({ tabKeeper, otherId }) => {
    const real = standIn('The real page');
    const url = page(otherId, 'suspended.html', placeholderFor(real));
    const tabId = await inBackground(tabKeeper, url);
    // PREMISE: it rests on the suspender's page until focused.
    await expect.poll(() => urlOf(tabKeeper, tabId)).toBe(url);

    await focus(tabKeeper, tabId);

    await expect.poll(() => urlOf(tabKeeper, tabId)).toBe(real);
  });
});

test('CONTROL: an ordinary suspended tab stays on the suspend page', async () => {
  await launched(async ({ tabKeeper, otherId }) => {
    const url = page(otherId, 'suspended.html', standIn('Left alone'));
    const tabId = await inBackground(tabKeeper, url);
    await expect.poll(() => urlOf(tabKeeper, tabId)).toBe(url);

    await focus(tabKeeper, tabId);

    // Long enough for the swap in the test above, which lands in a few ms.
    await new Promise((settled) => setTimeout(settled, 500));
    expect(await urlOf(tabKeeper, tabId)).toBe(url);
  });
});

test('CONTROL: an extension page that is no suspend page is left alone', async () => {
  await launched(async ({ tabKeeper, otherId }) => {
    const url = page(
      otherId,
      'welcome.html',
      placeholderFor(standIn('Left alone'))
    );
    const tabId = await inBackground(tabKeeper, url);
    await expect.poll(() => urlOf(tabKeeper, tabId)).toBe(url);

    await focus(tabKeeper, tabId);

    await new Promise((settled) => setTimeout(settled, 500));
    expect(await urlOf(tabKeeper, tabId)).toBe(url);
  });
});
