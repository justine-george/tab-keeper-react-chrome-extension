// KAN-923 on the real artifact: a saved tab's and group's Open in new window. Every check reads Chrome back.

import type { Page, Worker } from '@playwright/test';

import { expect } from './fixtures/extension';
import { grantedTest as test } from './fixtures/grantedExtension';
import { bandHandle, openSaved, session } from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';
import type {
  chromeTabGroupData,
  tabData,
} from '../src/redux/slices/tabContainerDataStateSlice';

const SETTLE = { timeout: 15_000 };

const tab = (title: string, extra: Partial<tabData> = {}): tabData => ({
  tabId: title,
  favicon: '',
  title,
  url: standIn(title),
  ...extra,
});

const WORK: chromeTabGroupData = {
  groupId: 'g1',
  title: 'Work',
  color: 'blue',
};
const inWork = { chromeGroupId: 'g1' };

interface SeenWindow {
  id: number;
  incognito: boolean;
  titles: string[];
}

const everyWindow = (worker: Worker): Promise<SeenWindow[]> =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({ populate: true })).map((w) => ({
      id: w.id ?? -1,
      incognito: w.incognito,
      titles: (w.tabs ?? []).map((t) => t.title ?? ''),
    }))
  );

// Chrome's windows as they stand, then the one new window after `press`.
async function newWindowAfter(
  worker: Worker,
  press: () => Promise<void>
): Promise<SeenWindow> {
  const before = (await everyWindow(worker)).map((w) => w.id);
  await press();
  const made = async () =>
    (await everyWindow(worker)).filter((w) => !before.includes(w.id));
  await expect.poll(async () => (await made()).length, SETTLE).toBe(1);
  return (await made())[0];
}

const titlesOf = async (worker: Worker, windowId: number) =>
  (await everyWindow(worker)).find((w) => w.id === windowId)?.titles ?? [];

const groupsIn = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (id) =>
      (await chrome.tabGroups.query({ windowId: id })).map((g) => ({
        title: g.title,
        color: g.color,
      })),
    windowId
  );

const pressRow = async (page: Page, rightClick: () => Promise<void>) => {
  await rightClick();
  await page
    .locator('[data-row-menu] [data-menu-item="openNewWindow"]')
    .click();
};

test('Open in new window on a tab and a group: normal windows, the group kept', async ({
  context,
  extensionId,
}) => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [
      session('S1', 'Trip', [
        {
          windowId: 'w1',
          windowHeight: 600,
          windowWidth: 800,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 3,
          title: 'Reading',
          tabs: [tab('Loose'), tab('G1', inWork), tab('G2', inWork)],
          chromeTabGroups: [WORK],
        },
      ]),
    ],
  });

  const forTab = await newWindowAfter(worker, () =>
    pressRow(page, () =>
      page
        .getByRole('button', { name: 'Open in new tab: Loose', exact: true })
        .click({ button: 'right' })
    )
  );
  expect(forTab.incognito).toBe(false);
  await expect
    .poll(() => titlesOf(worker, forTab.id), SETTLE)
    .toEqual(['Loose']);

  await page.bringToFront();
  const forGroup = await newWindowAfter(worker, () =>
    pressRow(page, () => bandHandle(page, 'g1').click({ button: 'right' }))
  );
  expect(forGroup.incognito).toBe(false);
  await expect
    .poll(() => titlesOf(worker, forGroup.id), SETTLE)
    .toEqual(['G1', 'G2']);
  await expect
    .poll(() => groupsIn(worker, forGroup.id), SETTLE)
    .toEqual([{ title: 'Work', color: 'blue' }]);
});
