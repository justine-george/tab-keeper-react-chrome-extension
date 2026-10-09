import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { stored } from './fixtures/savedWindows';

// KAN-468. Replace with open windows on the real artifact: what is open goes in, the name stays, ⌘Z takes it back.

const page = (title: string) => `data:text/html,<title>${title}</title>`;

const savedWindow = (id: string, urls: string[]) => ({
  windowId: id,
  windowHeight: 800,
  windowWidth: 1200,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: urls.length,
  title: '',
  tabs: urls.map((url, i) => ({
    tabId: `${id}-${i}`,
    favicon: '',
    title: url,
    url,
  })),
});

const TRIP = buildSession({
  tabGroupId: 's-trip',
  title: 'Trip',
  windows: [
    savedWindow('old-1', ['https://kyoto.test/']),
    savedWindow('old-2', ['https://osaka.test/', 'https://nara.test/']),
  ],
});
const OTHER = buildSession({ tabGroupId: 's-other', title: 'Other' });

async function openOnTrip(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([OTHER, TRIP]),
    selectedTabGroupId: 's-trip',
  });
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 790, height: 550 });
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(
    popup.getByRole('button', { name: 'Rename session: Trip' })
  ).toBeVisible();
  return popup;
}

const openTwoWindows = (worker: Worker) =>
  worker.evaluate(
    async (urls) => {
      for (const url of urls)
        await chrome.windows.create({ url, focused: false });
    },
    [page('Open A'), page('Open B')]
  );

const trip = async (popup: Page) => {
  const s = (await stored(popup)).tabGroups.find(
    (g) => g.tabGroupId === 's-trip'
  );
  if (s === undefined) throw new Error('Trip is gone');
  return s;
};
const urlsOf = (s: Awaited<ReturnType<typeof trip>>) =>
  s.windows.flatMap((w) => w.tabs.map((t) => t.url));

async function replace(popup: Page): Promise<void> {
  await sessionHeaderMenu(popup).click();
  await popup
    .getByRole('menuitem', { name: 'Replace with open windows' })
    .click();
}

test('Replace takes every open window, keeps the name and created date, goes first, and says so', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const popup = await openOnTrip(context, extensionId);
  await openTwoWindows(serviceWorker);
  const before = await trip(popup);

  await replace(popup);

  await expect
    .poll(async () => urlsOf(await trip(popup)))
    .toEqual(expect.arrayContaining([page('Open A'), page('Open B')]));
  const after = await trip(popup);
  expect(urlsOf(after)).not.toContain('https://kyoto.test/');
  expect(
    urlsOf(after).filter((u) => u.startsWith('chrome-extension://'))
  ).toEqual([]);
  expect([after.title, after.createdAt]).toEqual([
    before.title,
    before.createdAt,
  ]);
  expect(after.contentModified ?? 0).toBeGreaterThan(
    before.contentModified ?? 0
  );
  expect(after.tabCount).toBe(urlsOf(after).length);
  expect((await stored(popup)).tabGroups[0]?.tabGroupId).toBe('s-trip');
  await expect(
    popup.getByText('Session replaced with all open windows.')
  ).toBeVisible();
});

test('one ⌘Z puts the old windows back', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const popup = await openOnTrip(context, extensionId);
  await openTwoWindows(serviceWorker);
  await replace(popup);
  await expect
    .poll(async () => urlsOf(await trip(popup)))
    .toContain(page('Open A'));

  await popup.keyboard.press('ControlOrMeta+z');

  await expect
    .poll(async () => urlsOf(await trip(popup)))
    .toEqual([
      'https://kyoto.test/',
      'https://osaka.test/',
      'https://nara.test/',
    ]);
});

// Worst path: nothing but Tab Keeper's own page is open, so there is nothing to capture.
test('only Tab Keeper open: nothing changes, and nothing is said', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const popup = await openOnTrip(context, extensionId);
  await serviceWorker.evaluate(async () => {
    const own = chrome.runtime.getURL('');
    for (const t of await chrome.tabs.query({})) {
      if (!(t.url ?? t.pendingUrl ?? '').startsWith(own) && t.id !== undefined)
        await chrome.tabs.remove(t.id);
    }
  });
  // PREMISE: every tab left is Tab Keeper's.
  const left = await serviceWorker.evaluate(async () =>
    (await chrome.tabs.query({})).map((t) => t.url ?? t.pendingUrl ?? '')
  );
  expect(
    left.every((u) => u.startsWith(`chrome-extension://${extensionId}/`))
  ).toBe(true);
  const before = await stored(popup);

  await replace(popup);
  // NEGATIVE, so a fixed wait: the capture and the write are one quick task.
  await popup.waitForTimeout(500);

  expect(await stored(popup)).toEqual(before);
  await expect(
    popup.getByText('Session replaced with all open windows.')
  ).toHaveCount(0);
});
