import type { Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { openPage, POPUP } from './fixtures/onboarding';
import { stored } from './fixtures/savedWindows';

// KAN-460 Part 1 on the real artifact: a collapsed group is saved and comes
// back collapsed; the group holding the tab a window opens on stays open; and
// Window 1 -- the window saved from, even when it is not Chrome's first -- is
// the one focused after a restore. Every check reads Chrome back.

const page = (name: string) => `data:text/html,<title>${name}</title>`;

const sessionsRow = (p: Page) => p.locator('[data-pane="sessions"]');

async function pressSwitch(popup: Page) {
  await sessionsRow(popup)
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
  await popup
    .locator('dialog[open][aria-labelledby="focus-confirm-title"]')
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
}

async function pressOpen(popup: Page) {
  await sessionsRow(popup)
    .getByRole('button', { name: 'Open', exact: true })
    .click();
}

async function saveAll(popup: Page) {
  await popup
    .locator('[data-tour-anchor="save"]')
    .getByRole('button', {
      name: 'Save all open windows as a session',
      exact: true,
    })
    .click();
}

// Every group Chrome has, by title: collapsed or not, and the window it is in.
const groupsNow = (worker: Worker) =>
  worker.evaluate(async () =>
    Object.fromEntries(
      (await chrome.tabGroups.query({})).map((g) => [
        g.title ?? '',
        { collapsed: g.collapsed, windowId: g.windowId },
      ])
    )
  );

grantedTest.describe('collapsed groups (KAN-460)', () => {
  grantedTest(
    '1. a collapsed group is saved collapsed and Switch brings it back collapsed; an open one open',
    async ({ context, extensionId, serviceWorker }) => {
      await seedSettings(context, {});
      const popup = await openPage(context, extensionId, 'index.html', POPUP);
      await serviceWorker.evaluate(async (urls) => {
        const win = await chrome.windows.create({ url: urls, focused: false });
        const ids = (win?.tabs ?? [])
          .slice()
          .sort((a, b) => a.index - b.index)
          .flatMap((t) => (t.id === undefined ? [] : [t.id]));
        const folded = await chrome.tabs.group({
          tabIds: [ids[0], ids[1]],
          createProperties: { windowId: win!.id },
        });
        await chrome.tabGroups.update(folded, {
          title: 'Folded',
          color: 'blue',
        });
        const open = await chrome.tabs.group({
          tabIds: [ids[2]],
          createProperties: { windowId: win!.id },
        });
        await chrome.tabGroups.update(open, { title: 'Open', color: 'red' });
        await chrome.tabs.update(ids[3], { active: true });
        await chrome.tabGroups.update(folded, { collapsed: true });
      }, ['F1', 'F2', 'O1', 'Loose'].map(page));
      // PREMISE: Chrome shows them that way.
      await expect
        .poll(async () => {
          const g = await groupsNow(serviceWorker);
          return [g.Folded?.collapsed, g.Open?.collapsed];
        })
        .toEqual([true, false]);

      await saveAll(popup);
      await expect
        .poll(async () => (await stored(popup)).tabGroups.length)
        .toBe(1);
      const saved = (await stored(popup)).tabGroups[0].windows.find((w) =>
        w.tabs.some((t) => t.title === 'Loose')
      );
      expect(
        (saved?.chromeTabGroups ?? []).map((g) => [
          g.title,
          g.collapsed ?? null,
        ])
      ).toEqual([
        ['Folded', true],
        ['Open', null],
      ]);

      const before = Object.values(await groupsNow(serviceWorker)).map(
        (g) => g.windowId
      );
      await pressSwitch(popup);
      await expect
        .poll(
          async () => {
            const g = await groupsNow(serviceWorker);
            return g.Folded && !before.includes(g.Folded.windowId)
              ? [g.Folded.collapsed, g.Open?.collapsed]
              : null;
          },
          { timeout: 15_000 }
        )
        .toEqual([true, false]);
    }
  );

  grantedTest(
    '2. a group saved collapsed that holds the saved active tab opens expanded, on that tab',
    async ({ context, extensionId, serviceWorker }) => {
      const tab = (id: string, group?: string) => ({
        tabId: id,
        favicon: '',
        title: id,
        url: page(id),
        ...(group === undefined ? {} : { chromeGroupId: group }),
      });
      await seedSettings(context, {});
      await seedSessions(
        context,
        buildContainer([
          buildSession({
            tabGroupId: 's1',
            title: 'Edited',
            windowCount: 1,
            tabCount: 3,
            windows: [
              {
                windowId: 'w1',
                windowHeight: 600,
                windowWidth: 800,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 3,
                title: '',
                tabs: [tab('Lead'), tab('InA', 'gA'), tab('InB', 'gB')],
                chromeTabGroups: [
                  {
                    groupId: 'gA',
                    title: 'HoldsActive',
                    color: 'blue',
                    collapsed: true,
                  },
                  {
                    groupId: 'gB',
                    title: 'Other',
                    color: 'red',
                    collapsed: true,
                  },
                ],
                activeTabId: 'InA',
              },
            ],
          }),
        ])
      );
      const popup = await openPage(context, extensionId, 'index.html', POPUP);
      await pressOpen(popup);

      await expect
        .poll(
          async () => {
            const g = await groupsNow(serviceWorker);
            return [g.HoldsActive?.collapsed, g.Other?.collapsed];
          },
          { timeout: 15_000 }
        )
        .toEqual([false, true]);
      const activeTitle = await serviceWorker.evaluate(async () => {
        const [g] = await chrome.tabGroups.query({ title: 'HoldsActive' });
        const [t] = await chrome.tabs.query({
          windowId: g.windowId,
          active: true,
        });
        return t?.title ?? null;
      });
      expect(activeTitle).toBe('InA');
    }
  );
});

test("3. Window 1 is the window saved from, even when it is not Chrome's first, and Open all focuses it", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSettings(context, {});
  // The launch window is Chrome's first; the page saves from a second one.
  const second = await serviceWorker.evaluate(
    async (urls) => {
      const win = await chrome.windows.create({ url: urls, focused: true });
      return win?.id ?? -1;
    },
    [page('SecondA'), page('SecondB')]
  );
  const popupUrl = `chrome-extension://${extensionId}/index.html`;
  const pagePromise = context.waitForEvent('page', (p) =>
    p.url().startsWith(popupUrl)
  );
  await serviceWorker.evaluate(
    async ({ windowId, url }) => {
      await chrome.tabs.create({ windowId, url, active: true });
    },
    { windowId: second, url: popupUrl }
  );
  const popup = await pagePromise;
  await popup.setViewportSize(POPUP);
  await popup.getByRole('button', { name: 'Sort sessions' }).waitFor();
  // PREMISE: the page is in Chrome's second window, not its first.
  const order = await serviceWorker.evaluate(async () =>
    (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((w) => w.id)
  );
  expect(order.indexOf(second)).toBe(1);

  await saveAll(popup);
  await expect.poll(async () => (await stored(popup)).tabGroups.length).toBe(1);
  const first = (await stored(popup)).tabGroups[0].windows[0];
  expect(first.tabs.map((t) => t.title)).toEqual(['SecondA', 'SecondB']);

  const before = order;
  await pressOpen(popup);
  // The restored copy of the second window is the one Chrome focuses.
  await expect
    .poll(
      async () =>
        serviceWorker.evaluate(async (before) => {
          const focused = await chrome.windows.getLastFocused({
            populate: true,
          });
          return before.includes(focused.id ?? -1)
            ? null
            : (focused.tabs ?? []).map((t) => t.title);
        }, before),
      { timeout: 15_000 }
    )
    .toContain('SecondA');
});
