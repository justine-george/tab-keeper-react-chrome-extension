// KAN-885 on the real artifact: a saved group's Open goes to the group when it
// is open as saved (same name, tab count and addresses) and says Go to group;
// once the open group drifts it says Open group and opens a copy. Middle-click
// opens a copy behind, even with the group open.

import type { BrowserContext, Page, Worker } from '@playwright/test';

import { grantedTest as test } from './fixtures/grantedExtension';
import { expect } from './fixtures/extension';
import { dataUrl, openLiveWindow } from './fixtures/liveWindows';
import { VIEWS, bandHandle, openSaved, session } from './fixtures/savedWindows';
import type { View } from './fixtures/savedWindows';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

// Research holds Alpha and Beta.
const SAVED: windowGroupData = {
  windowId: 'w1',
  windowHeight: 600,
  windowWidth: 800,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 2,
  title: '',
  tabs: ['Alpha', 'Beta'].map((title, i) => ({
    tabId: `w1-t${i}`,
    favicon: '',
    title,
    url: dataUrl(title),
    chromeGroupId: 'gr',
  })),
  chromeTabGroups: [{ groupId: 'gr', title: 'Research', color: 'blue' }],
};

interface Staged {
  page: Page;
  ownWindow: number;
  other: { windowId: number; idOf: (title: string) => number };
}

// A second window holds Research reordered and recoloured, behind Front; Beta was used last.
async function stage(
  context: BrowserContext,
  extensionId: string,
  worker: Worker,
  view: View
): Promise<Staged> {
  const page = await openSaved(context, extensionId, view, {
    sessions: [session('S1', 'Source', [SAVED])],
  });
  const other = await openLiveWindow(worker, ['Front', 'Beta', 'Alpha']);
  await worker.evaluate(
    async ({ windowId, alpha, beta, front }) => {
      const groupId = await chrome.tabs.group({
        tabIds: [alpha, beta],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, {
        title: 'Research',
        color: 'red',
      });
      // Apart, so each activation gets its own lastAccessed.
      for (const id of [alpha, beta, front]) {
        await chrome.tabs.update(id, { active: true });
        await new Promise((done) => setTimeout(done, 20));
      }
    },
    {
      windowId: other.windowId,
      alpha: other.idOf('Alpha'),
      beta: other.idOf('Beta'),
      front: other.idOf('Front'),
    }
  );
  const ownWindow = await page.evaluate(
    async () => (await chrome.windows.getCurrent()).id ?? -1
  );
  await page.evaluate(async (id) => {
    await chrome.windows.update(id, { focused: true });
  }, ownWindow);
  // PREMISE: Tab Keeper's window is in front, and the group is not.
  await expect.poll(() => lastFocused(worker)).toBe(ownWindow);
  expect(await activeIn(worker, other.windowId)).toBe(other.idOf('Front'));
  return { page, ownWindow, other };
}

const groupButton = (page: Page, name: string) =>
  bandHandle(page, 'gr')
    .locator('[data-row-actions]')
    .getByRole('button', { name, exact: true });

const lastFocused = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);

const activeIn = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (id) =>
      (await chrome.tabs.query({ active: true, windowId: id }))[0]?.id,
    windowId
  );

// Each Research group's window and tab count.
const researchGroups = (worker: Worker) =>
  worker.evaluate(async () => {
    const groups = await chrome.tabGroups.query({ title: 'Research' });
    return Promise.all(
      groups.map(async (g) => ({
        windowId: g.windowId,
        tabs: (await chrome.tabs.query({ groupId: g.id })).length,
      }))
    );
  });

for (const view of VIEWS) {
  test.describe(`${view}: a saved group's Open (KAN-885)`, () => {
    test("says Go to group and goes to the open group's last used tab; opens nothing", async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const { page, other } = await stage(
        context,
        extensionId,
        serviceWorker,
        view
      );

      await bandHandle(page, 'gr').hover();
      await groupButton(page, 'Go to group: Research').click();

      await expect
        .poll(() => activeIn(serviceWorker, other.windowId))
        .toBe(other.idOf('Beta'));
      await expect.poll(() => lastFocused(serviceWorker)).toBe(other.windowId);
      expect(await researchGroups(serviceWorker)).toEqual([
        { windowId: other.windowId, tabs: 2 },
      ]);
    });

    test('once a tab in the open group goes elsewhere, says Open group and opens a copy', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const { page, ownWindow, other } = await stage(
        context,
        extensionId,
        serviceWorker,
        view
      );
      await expect(groupButton(page, 'Go to group: Research')).toBeAttached();

      await serviceWorker.evaluate(
        async ({ id, url }) => chrome.tabs.update(id, { url }),
        // Chrome refuses an extension's navigation to a data: page.
        { id: other.idOf('Alpha'), url: 'about:blank' }
      );
      await bandHandle(page, 'gr').hover();
      await groupButton(page, 'Open group: Research').click();

      await expect
        .poll(async () =>
          (await researchGroups(serviceWorker)).sort(
            (a, b) => a.windowId - b.windowId
          )
        )
        .toEqual(
          [
            { windowId: ownWindow, tabs: 2 },
            { windowId: other.windowId, tabs: 2 },
          ].sort((a, b) => a.windowId - b.windowId)
        );
      expect(await activeIn(serviceWorker, other.windowId)).toBe(
        other.idOf('Front')
      );
    });

    test('middle-click opens a copy behind, even with the group open', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const { page, ownWindow, other } = await stage(
        context,
        extensionId,
        serviceWorker,
        view
      );
      const tabKeeperTab = await page.evaluate(
        async () => (await chrome.tabs.getCurrent())?.id
      );

      await bandHandle(page, 'gr').hover();
      await groupButton(page, 'Go to group: Research').click({
        button: 'middle',
      });

      await expect
        .poll(async () => (await researchGroups(serviceWorker)).length)
        .toBe(2);
      expect(
        (await researchGroups(serviceWorker)).find(
          (g) => g.windowId === ownWindow
        )
      ).toEqual({ windowId: ownWindow, tabs: 2 });
      // Nothing switched: Tab Keeper stays in front, and so does its window.
      expect(await activeIn(serviceWorker, ownWindow)).toBe(tabKeeperTab);
      expect(await activeIn(serviceWorker, other.windowId)).toBe(
        other.idOf('Front')
      );
      expect(await lastFocused(serviceWorker)).toBe(ownWindow);
    });
  });
}
