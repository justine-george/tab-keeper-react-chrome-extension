// KAN-720 on the real artifact: every window and group row ends in a tag that
// counts the tabs it draws. What jsdom cannot show: the tag's real height on a
// real row, its gap after the title's text, the corner shape Chromium draws,
// a long title ellipsizing before it in the 380px drawer, and ru plurals
// fetched over the locale backend.

import type { BrowserContext, Locator, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import { elementLanded } from './fixtures/landed';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';
import { seedSettings } from './fixtures/seed';
import {
  VIEWS,
  bandHandle,
  boxOf,
  groupedWindow,
  header,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

const TAG = '[data-row-tag]';
const OPEN_NOW = '[data-pane="open-now"]';

// Chrome computes `round` as superellipse(1); a squircle is superellipse(2).
const ROW_TAG_LOOK = {
  padding: '2px 8px',
  radius: '4px',
  cornerShape: 'superellipse(1)',
};

// The tag's look, as computed on the built page.
const lookOf = (tag: Locator) =>
  tag.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      padding: s.padding,
      radius: s.borderTopLeftRadius,
      cornerShape: s.getPropertyValue('corner-shape'),
    };
  });

// A title's text box: the span that ellipsizes.
const textOf = (row: Locator, label: string) =>
  row.getByText(label, { exact: true });

// Right edge of the title's text to left edge of the row's first tag.
async function gapAfterTitle(row: Locator, label: string) {
  const text = await boxOf(textOf(row, label));
  const tag = await boxOf(row.locator(TAG).first());
  return tag.x - (text.x + text.width);
}

// A window of a two-tab Research group and one loose tab.
const RESEARCH = { groupId: 'gr', title: 'Research', color: 'blue' as const };
const mixedWindow = (): windowGroupData => {
  const w = groupedWindow('gw', 'Reading list', [RESEARCH], 2, {
    width: 800,
    height: 600,
  });
  const loose = savedWindow('gw', '', 1).tabs.map((t) => ({
    ...t,
    tabId: 'loose',
  }));
  return { ...w, tabs: [...w.tabs, ...loose], tabCount: 3 };
};

for (const view of VIEWS) {
  grantedTest(
    `${view}: a saved window and group tag reads its count, 20px tall, on a 32px row`,
    async ({ context, extensionId }) => {
      const page = await openSaved(context, extensionId, view, {
        sessions: [session('S1', 'Trip', [mixedWindow()])],
      });
      const rows: [Locator, string, string][] = [
        [header(page, 'gw'), 'Reading list', '3 Tabs'],
        [bandHandle(page, 'gr'), 'Research', '2 Tabs'],
      ];
      for (const [row, label, count] of rows) {
        const tag = row.locator(TAG);
        await expect(tag).toHaveText([count]);
        const [tagBox, rowBox] = [await boxOf(tag), await boxOf(row)];
        const gap = await gapAfterTitle(row, label);
        const look = await lookOf(tag);
        console.log(
          `[KAN-720 ${view} ${label}] tag ${tagBox.height}px, row ${rowBox.height}px, gap ${gap}px, ${JSON.stringify(look)}`
        );
        expect(tagBox.height).toBe(20);
        expect(rowBox.height).toBe(32);
        expect(look).toEqual(ROW_TAG_LOOK);
        expect(Math.abs(gap - 8)).toBeLessThanOrEqual(0.5);
      }
    }
  );
}

// The tab view's own window, with two real tabs beside it.
async function tabViewWithTabs(
  context: BrowserContext,
  worker: Worker,
  extensionId: string
) {
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  const windowId = await page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    return tab?.windowId ?? -1;
  });
  await worker.evaluate(
    async ({ windowId, urls }) => {
      for (const url of urls)
        await chrome.tabs.create({ windowId, url, active: false });
    },
    { windowId, urls: [standIn('Inbox'), standIn('Notes')] }
  );
  return { page, windowId };
}

const liveRow = (scope: Locator, title: string) =>
  scope.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

test('Open now: window tag before "This window", same look', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const { page, windowId } = await tabViewWithTabs(
    context,
    serviceWorker,
    extensionId
  );
  const block = page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);
  await expect(liveRow(block, 'Notes')).toBeVisible();
  // The rows the window draws: the launch tab and the two, never the tab view.
  const drawn = await block.locator('[data-open-tab-id]').count();
  expect(drawn).toBeGreaterThanOrEqual(2);

  const tags = block.locator(`[data-window-row] ${TAG}`);
  await expect(tags).toHaveText([`${drawn} Tabs`, 'This window']);
  const [count, mine] = [await boxOf(tags.nth(0)), await boxOf(tags.nth(1))];
  expect(mine.x).toBeGreaterThan(count.x + count.width);
  expect([count.height, mine.height]).toEqual([20, 20]);
  expect((await boxOf(block.locator('[data-window-row]'))).height).toBe(32);
  for (const tag of [tags.nth(0), tags.nth(1)]) {
    expect(await lookOf(tag)).toEqual(ROW_TAG_LOOK);
  }
});

test('saved pane search: the tags count the matches', async ({
  context,
  extensionId,
}) => {
  const trip = savedWindow('w1', 'Trip', 4);
  const titles = ['Kyoto maps', 'Osaka flights', 'Rail pass', 'Nara deer'];
  const w1 = {
    ...trip,
    tabs: trip.tabs.map((t, i) => ({ ...t, title: titles[i] })),
  };
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [session('S1', 'Japan', [w1])],
  });
  const tag = header(page, 'w1').locator(TAG);
  // PREMISE: unsearched, the tag counts all four.
  await expect(tag).toHaveText(['4 Tabs']);

  await page.locator('[data-saved-search] input').fill('kyoto');

  await expect(
    page.locator('[data-pane="detail"]').getByText('Osaka flights')
  ).toHaveCount(0);
  await expect(tag).toHaveText(['1 Tab']);
});

// A window the browser opens, unfocused, one tab per title.
const openWindow = (worker: Worker, titles: string[]) =>
  worker.evaluate(
    (urls) => chrome.windows.create({ focused: false, url: urls }),
    titles.map(standIn)
  );

test("Open now search: the window tags add up to the header's matched count", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await openWindow(serviceWorker, [
    'Kyoto maps',
    'Osaka flights',
    'Kyoto rail',
  ]);
  await openWindow(serviceWorker, ['Kyoto temples', 'Nara deer']);
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, {
    width: 1600,
    height: 800,
  });
  const pane = page.locator(OPEN_NOW);
  await expect(liveRow(pane, 'Nara deer')).toBeVisible();

  await pane
    .getByRole('textbox', { name: 'Search open tabs', exact: true })
    .fill('kyoto');

  const matched = pane.getByText(/· \d+ of \d+ Tabs$/);
  await expect(matched).toHaveText(/· 3 of \d+ Tabs$/);
  const counts = pane.locator(
    `[data-window-row] ${TAG}:not(:text-is("This window"))`
  );
  await expect(counts).toHaveText(['2 Tabs', '1 Tab']);
  const sum = (await counts.allTextContents())
    .map((text) => Number.parseInt(text, 10))
    .reduce((a, b) => a + b, 0);
  const header = (await matched.textContent()) ?? '';
  expect(sum).toBe(Number(/· (\d+) of/.exec(header)?.[1]));
});

test("ru: the tags use the locale's plural forms", async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [
      session('S1', 'Trip', [
        savedWindow('w2', '', 2),
        savedWindow('w5', '', 5),
        savedWindow('w21', '', 21),
      ]),
    ],
    settings: { language: 'ru' },
  });
  for (const [id, text] of [
    ['w2', '2 вкладки'],
    ['w5', '5 вкладок'],
    ['w21', '21 вкладка'],
  ]) {
    await expect(header(page, id).locator(TAG)).toHaveText([text]);
  }
});

const LONG_GROUP =
  'Shared research for quarterly planning and the reading list for the autumn team meeting';
const LONG_WINDOW =
  'Everything still to read before the quarterly planning offsite in the autumn, and the notes from the last one';

// The title's text ellipsizes; the tag is whole and 9px inside the row's right edge.
async function expectEllipsizedBeforeTag(row: Locator, label: string) {
  const text = textOf(row, label);
  const tag = row.locator(TAG).first();
  const clips = (el: Element) => el.scrollWidth > el.clientWidth;
  expect(await text.evaluate(clips)).toBe(true);
  expect(await tag.evaluate(clips)).toBe(false);
  const [r, t, x] = [await boxOf(row), await boxOf(tag), await boxOf(text)];
  const clearance = r.x + r.width - (t.x + t.width);
  const gap = t.x - (x.x + x.width);
  console.log(
    `[KAN-720 long ${label.slice(0, 12)}] row ${r.width}px, clearance ${clearance}px, gap ${gap}px`
  );
  expect(Math.abs(clearance - 9)).toBeLessThanOrEqual(1);
  expect(Math.abs(gap - 8)).toBeLessThanOrEqual(0.5);
}

grantedTest(
  'drawer (480px): a long group title ellipsizes before a whole tag',
  async ({ context, extensionId, serviceWorker }) => {
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await openPage(context, extensionId, FULL_VIEW_PATH, {
      width: 1024,
      height: 768,
    });
    // A window of a two-tab group and one loose tab.
    const windowId = await serviceWorker.evaluate(
      async ({ urls, title }) => {
        const win = await chrome.windows.create({ focused: false, url: urls });
        const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
        const groupId = await chrome.tabs.group({
          tabIds: [first, second],
          createProperties: { windowId: win?.id },
        });
        await chrome.tabGroups.update(groupId, { title, color: 'blue' });
        return win?.id ?? -1;
      },
      { urls: ['Temples', 'Gardens', 'Loose'].map(standIn), title: LONG_GROUP }
    );
    await page.getByRole('button', { name: /^Currently open/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Currently open' });
    await expect(drawer).toBeVisible();
    // KAN-810. The drawer slides in: measure and press it where it comes to rest.
    await elementLanded(drawer, 'subtree');
    // PREMISE: the drawer is the narrow one.
    expect((await boxOf(drawer)).width).toBe(480);

    const block = drawer.locator(`[data-open-window-id="${windowId}"]`);
    const band = block.locator('[data-group-drag-handle]');
    await expect(band.locator(TAG)).toHaveText(['2 Tabs']);
    await expect(block.locator(`[data-window-row] ${TAG}`)).toHaveText([
      '3 Tabs',
    ]);
    await page.mouse.move(0, 0);
    await expectEllipsizedBeforeTag(band, LONG_GROUP);
  }
);

test('saved pane: a long window title ellipsizes before a whole tag', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [session('S1', 'Trip', [savedWindow('w1', LONG_WINDOW, 3)])],
  });
  const row = header(page, 'w1');
  await expect(row.locator(TAG)).toHaveText(['3 Tabs']);
  await expectEllipsizedBeforeTag(row, LONG_WINDOW);
});
