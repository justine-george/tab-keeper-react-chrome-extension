// KAN-884 on the real artifact: a saved tab's plain click switches to an open
// copy in another window and focuses it, else opens one; middle-click and
// ⌘/Ctrl-click open a copy in the background; the menu's Open in new tab
// opens a copy in front.

import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { dataUrl, openLiveWindow } from './fixtures/liveWindows';
import { openSaved, savedWindow, session } from './fixtures/savedWindows';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

// Alpha is open in a second window; Beta is open nowhere.
const SAVED: windowGroupData = {
  ...savedWindow('w1', '', 2, { width: 800, height: 600 }),
  tabs: ['Alpha', 'Beta'].map((title, i) => ({
    tabId: `w1-t${i}`,
    favicon: '',
    title,
    url: dataUrl(title),
  })),
};

interface Staged {
  page: Page;
  ownWindow: number;
  other: { windowId: number; idOf: (title: string) => number };
}

async function stage(
  context: BrowserContext,
  extensionId: string,
  worker: Worker
): Promise<Staged> {
  const page = await openSaved(context, extensionId, 'tab view', {
    sessions: [session('S1', 'Source', [SAVED])],
  });
  const other = await openLiveWindow(worker, ['Front', 'Alpha']);
  const ownWindow = await page.evaluate(
    async () => (await chrome.windows.getCurrent()).id ?? -1
  );
  // PREMISE: Tab Keeper's window is in front, and the copy is not.
  await expect.poll(() => lastFocused(worker)).toBe(ownWindow);
  expect(await activeIn(worker, other.windowId)).toBe(other.idOf('Front'));
  return { page, ownWindow, other };
}

const row = (page: Page, title: string) =>
  page.getByRole('button', { name: `Open in new tab: ${title}`, exact: true });

const lastFocused = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);

const activeIn = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (id) =>
      (await chrome.tabs.query({ active: true, windowId: id }))[0]?.id,
    windowId
  );

// Every tab at `url`, with its window and whether it is in front there.
const copiesOf = (worker: Worker, url: string) =>
  worker.evaluate(
    async (u) =>
      (await chrome.tabs.query({}))
        .filter((t) => (t.pendingUrl || t.url) === u)
        .map((t) => ({ windowId: t.windowId, active: t.active })),
    url
  );

test.describe('a saved tab click (KAN-884)', () => {
  test('a plain click switches to the open copy in another window and focuses it', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, other } = await stage(context, extensionId, serviceWorker);

    await row(page, 'Alpha').click();

    await expect
      .poll(() => activeIn(serviceWorker, other.windowId))
      .toBe(other.idOf('Alpha'));
    await expect.poll(() => lastFocused(serviceWorker)).toBe(other.windowId);
    expect(await copiesOf(serviceWorker, dataUrl('Alpha'))).toHaveLength(1);
  });

  test('a plain click opens a copy in front when none is open', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, ownWindow } = await stage(
      context,
      extensionId,
      serviceWorker
    );

    await row(page, 'Beta').click();

    await expect
      .poll(() => copiesOf(serviceWorker, dataUrl('Beta')))
      .toEqual([{ windowId: ownWindow, active: true }]);
  });

  for (const [gesture, press] of [
    ['middle-click', (p: Page) => row(p, 'Alpha').click({ button: 'middle' })],
    [
      '⌘/Ctrl-click',
      (p: Page) => row(p, 'Alpha').click({ modifiers: ['ControlOrMeta'] }),
    ],
  ] as const) {
    test(`${gesture} opens a copy in the background, even with one open`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const { page, ownWindow, other } = await stage(
        context,
        extensionId,
        serviceWorker
      );
      const tabView = await page.evaluate(
        async () => (await chrome.tabs.getCurrent())?.id
      );

      await press(page);

      await expect
        .poll(() => copiesOf(serviceWorker, dataUrl('Alpha')))
        .toContainEqual({ windowId: ownWindow, active: false });
      expect(await copiesOf(serviceWorker, dataUrl('Alpha'))).toHaveLength(2);
      // Nothing switched: the tab view stays in front, and so does its window.
      expect(await activeIn(serviceWorker, ownWindow)).toBe(tabView);
      expect(await activeIn(serviceWorker, other.windowId)).toBe(
        other.idOf('Front')
      );
      expect(await lastFocused(serviceWorker)).toBe(ownWindow);
    });
  }

  test("the menu's Open in new tab opens a copy in front, even with one open", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { page, ownWindow, other } = await stage(
      context,
      extensionId,
      serviceWorker
    );

    await row(page, 'Alpha').click({ button: 'right' });
    await page
      .locator('[role="menu"][data-row-menu]')
      .getByRole('menuitem', { name: 'Open in new tab', exact: true })
      .click();

    await expect
      .poll(() => copiesOf(serviceWorker, dataUrl('Alpha')))
      .toContainEqual({ windowId: ownWindow, active: true });
    expect(await activeIn(serviceWorker, other.windowId)).toBe(
      other.idOf('Front')
    );
  });
});
