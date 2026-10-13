import type { Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { openPage, POPUP } from './fixtures/onboarding';
import { pressOpen } from './fixtures/sessionActions';
import { standIn } from './fixtures/standInPages';

// KAN-561. A restored tab loads whatever its scheme, as Chromium 156 allows: data: at once, the rest on activation.
const PLACEHOLDER = 'data:text/html;base64,';
const DATA_PAGE = 'data:text/html,<title>Data</title>';
// Measured 2026-10-13: Chrome refuses it from an extension, so it stays a placeholder.
const REFUSED = 'chrome://kill/';

type TabFact = { id: number; url: string; status: string };

const restoredTabs = (
  worker: Worker,
  firstUrl: string
): Promise<TabFact[] | undefined> =>
  worker.evaluate(async (firstUrl) => {
    const windows = await chrome.windows.getAll({ populate: true });
    const restored = windows.find((w) =>
      w.tabs?.some((t) => t.url === firstUrl)
    );
    return restored?.tabs
      ?.slice()
      .sort((a, b) => a.index - b.index)
      .map((t) => ({
        id: t.id ?? -1,
        url: t.url || t.pendingUrl || '',
        status: t.status ?? '',
      }));
  }, firstUrl);

const activate = (worker: Worker, tabId: number) =>
  worker.evaluate(
    (tabId) => chrome.tabs.update(tabId, { active: true }).then(() => {}),
    tabId
  );

const urlOf = (worker: Worker, tabId: number) =>
  worker.evaluate(async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || tab.pendingUrl || '';
  }, tabId);

test('Open restores data: loaded, and chrome:, file: and Tab Keeper pages load when clicked (KAN-561)', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const target = standIn('Target');
  const ownPage = `chrome-extension://${extensionId}/export.html`;
  const saved = [
    target,
    DATA_PAGE,
    'chrome://version/',
    ownPage,
    'file:///etc/hosts',
    REFUSED,
  ];
  await seedSettings(context, {});
  await seedSessions(
    context,
    buildContainer([
      buildSession({
        tabGroupId: 's1',
        title: 'Schemes',
        windowCount: 1,
        tabCount: saved.length,
        windows: [
          {
            windowId: 'w1',
            windowHeight: 600,
            windowWidth: 800,
            windowOffsetTop: 0,
            windowOffsetLeft: 0,
            tabCount: saved.length,
            title: '',
            tabs: saved.map((url, i) => ({
              tabId: `t${i}`,
              favicon: '',
              title: `Tab ${i}`,
              url,
            })),
          },
        ],
      }),
    ])
  );
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  await pressOpen(popup);

  // Every tab settled: a placeholder activated mid-load commits over the swap (KAN-36).
  await expect
    .poll(async () =>
      (await restoredTabs(serviceWorker, target))?.map(
        (t) => t.status === 'complete'
      )
    )
    .toEqual(saved.map(() => true));
  const tabs = (await restoredTabs(serviceWorker, target)) ?? [];
  // data: opens as itself, since a swap to it is ignored; the rest wait as placeholders.
  expect(
    tabs.map((t) => (t.url.startsWith(PLACEHOLDER) ? 'placeholder' : t.url))
  ).toEqual([
    target,
    DATA_PAGE,
    'placeholder',
    'placeholder',
    'placeholder',
    'placeholder',
  ]);

  for (const i of [2, 3, 4]) {
    await activate(serviceWorker, tabs[i].id);
    await expect.poll(() => urlOf(serviceWorker, tabs[i].id)).toBe(saved[i]);
  }

  // Worst path, after the swaps above prove the worker live: Chrome refuses it, and the tab stays, a placeholder.
  await activate(serviceWorker, tabs[5].id);
  await new Promise((done) => setTimeout(done, 1500));
  expect(await urlOf(serviceWorker, tabs[5].id)).toMatch(
    /^data:text\/html;base64,/
  );
  expect((await restoredTabs(serviceWorker, target))?.length).toBe(
    saved.length
  );
});
