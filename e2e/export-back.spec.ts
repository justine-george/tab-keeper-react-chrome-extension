import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { openPopupCalls, stubOpenPopup } from './fixtures/openPopupStub';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-880. The Save as PDF preview's "← Tab Keeper", on the built artifact:
// the worker switches back, closes the preview, and from the popup opens it
// last; with edits pending a card asks first, and Chrome adds no "Leave site?".

const SESSION_ID = 'session-back';
const SESSION = buildSession({
  tabGroupId: SESSION_ID,
  title: 'Lisbon trip',
  isSelected: true,
  tabCount: 2,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Lisbon',
      tabs: [
        {
          tabId: 't-1',
          favicon: '',
          title: 'Lisbon travel guide',
          url: 'https://travel.example/lisbon',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Tram 28 route',
          url: 'https://tram.example/28',
        },
      ],
    },
  ],
});
const FULL_VIEW = 'index.html?view=tab';
const PREVIEW = `export.html?session=${SESSION_ID}`;

test.beforeEach(async ({ context }) => {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: SESSION_ID,
  });
  await seedSettings(context, { foldSavedSessionInTabView: false });
});

interface TabFacts {
  id: number;
  url: string;
  active: boolean;
  windowId: number;
  openerTabId: number | undefined;
}

const allTabs = (worker: Worker): Promise<TabFacts[]> =>
  worker.evaluate(() =>
    chrome.tabs.query({}).then((tabs) =>
      tabs.map((t) => ({
        id: t.id ?? -1,
        url: t.url || t.pendingUrl || '',
        active: t.active,
        windowId: t.windowId,
        openerTabId: t.openerTabId,
      }))
    )
  );

const tabsAt = async (worker: Worker, part: string) =>
  (await allTabs(worker)).filter((t) => t.url.includes(part));

async function onlyTabAt(worker: Worker, part: string): Promise<TabFacts> {
  const found = await tabsAt(worker, part);
  if (found.length !== 1) throw new Error(`${found.length} tabs at ${part}`);
  return found[0];
}

// The window's active tab, by id.
const activeIn = (worker: Worker, windowId: number) =>
  worker.evaluate(
    (windowId) =>
      chrome.tabs.query({ windowId, active: true }).then(([t]) => t?.id),
    windowId
  );

const backLink = (page: Page) =>
  page.getByRole('button', { name: 'Back to Tab Keeper', exact: true });
const card = (page: Page) => page.locator('[data-ask-card]');

/** The full view, then its session ⋮ → Save as PDF…: the preview, opened from it. */
async function previewFromFullView(
  context: BrowserContext,
  worker: Worker,
  extensionId: string
): Promise<{ preview: Page; fullView: TabFacts; previewTab: TabFacts }> {
  // Opened as the worker opens a full view: with no opener, unlike a newPage tab.
  const [page] = await Promise.all([
    context.waitForEvent('page'),
    worker.evaluate(
      (url) => chrome.tabs.create({ url, active: true }),
      `chrome-extension://${extensionId}/${FULL_VIEW}`
    ),
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sessionHeaderMenu(page)).toBeVisible();
  await sessionHeaderMenu(page).click();
  const [preview] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menuitem', { name: 'Save as PDF…', exact: true }).click(),
  ]);
  await preview.waitForLoadState();
  // PREMISE: the page caught is the preview, and it knows it came from the full view.
  expect(preview.url()).toContain(`${PREVIEW}&from=full`);
  await expect(backLink(preview)).toBeVisible();

  const fullView = await onlyTabAt(worker, FULL_VIEW);
  const previewTab = await onlyTabAt(worker, 'export.html');
  // PREMISE: the preview's opener is the full view, so going back has a tab to land on.
  expect(previewTab.openerTabId).toBe(fullView.id);
  // Chrome hands a closed tab's opener on to its children (test 3).
  expect(fullView.openerTabId).toBeUndefined();
  return { preview, fullView, previewTab };
}

/** A plain tab after the preview, so "back" and "the tab Chrome picks next" differ. */
async function addTabAfter(
  context: BrowserContext,
  worker: Worker,
  after: TabFacts
): Promise<TabFacts> {
  const pages = context.pages().length;
  await worker.evaluate(async (after) => {
    const { index } = await chrome.tabs.get(after.id);
    await chrome.tabs.create({
      url: 'data:text/html,<title>Neighbour</title>',
      windowId: after.windowId,
      index: index + 1,
      active: false,
    });
  }, after);
  // Until it is a page: a late one is the next 'page' event (KAN-560).
  await expect.poll(() => context.pages().length).toBe(pages + 1);
  return onlyTabAt(worker, 'Neighbour');
}

test('1. from the full view: the full view is active again and the preview is gone', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const { preview, fullView, previewTab } = await previewFromFullView(
    context,
    serviceWorker,
    extensionId
  );
  await addTabAfter(context, serviceWorker, previewTab);
  // PREMISE: the preview is the active tab, between the full view and a neighbour.
  expect(await activeIn(serviceWorker, previewTab.windowId)).toBe(
    previewTab.id
  );

  await backLink(preview).click();

  await expect.poll(() => tabsAt(serviceWorker, 'export.html')).toEqual([]);
  expect(await activeIn(serviceWorker, fullView.windowId)).toBe(fullView.id);
  // CONTROL: the same full view, not a new one.
  expect((await tabsAt(serviceWorker, FULL_VIEW)).map((t) => t.id)).toEqual([
    fullView.id,
  ]);
});

// Off the happy path: the opener moved to another window. Only the worker's switch reaches it; Chrome's own pick stays in the preview's window.
test('1b. the full view moved to another window: that window is focused, on the full view', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const { preview, fullView, previewTab } = await previewFromFullView(
    context,
    serviceWorker,
    extensionId
  );
  await addTabAfter(context, serviceWorker, previewTab);
  const movedTo = await serviceWorker.evaluate(
    async ([tabId, previewId]) => {
      const win = await chrome.windows.create({ tabId, focused: false });
      await chrome.tabs.update(previewId, { active: true });
      await chrome.windows.update((await chrome.tabs.get(previewId)).windowId, {
        focused: true,
      });
      return win?.id;
    },
    [fullView.id, previewTab.id]
  );
  // PREMISE: the full view is alone in its own window, and the preview's window has focus.
  expect(movedTo).not.toBe(previewTab.windowId);
  expect(
    await serviceWorker.evaluate(() =>
      chrome.windows.getLastFocused().then((w) => w.id)
    )
  ).toBe(previewTab.windowId);

  await backLink(preview).click();

  await expect.poll(() => tabsAt(serviceWorker, 'export.html')).toEqual([]);
  await expect
    .poll(() =>
      serviceWorker.evaluate(() =>
        chrome.windows.getLastFocused().then((w) => w.id)
      )
    )
    .toBe(movedTo);
  expect(await activeIn(serviceWorker, movedTo ?? -1)).toBe(fullView.id);
  expect((await tabsAt(serviceWorker, FULL_VIEW)).map((t) => t.id)).toEqual([
    fullView.id,
  ]);
});

test('2. with a hidden tab: the card asks, Stay keeps the page, Go back closes it without "Leave site?"', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const { preview, fullView } = await previewFromFullView(
    context,
    serviceWorker,
    extensionId
  );
  const dialogs: string[] = [];
  preview.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await preview.getByRole('button', { name: 'Edit', exact: true }).click();
  await preview
    .getByRole('button', { name: 'Hide: Tram 28 route', exact: true })
    .click();
  await expect(preview.getByText('1 hidden')).toBeVisible();

  // CONTROL: the guard is on and this listener hears it, so no dialog below means none was raised.
  void preview.evaluate(() => location.reload());
  await expect.poll(() => dialogs).toEqual(['beforeunload']);
  await expect(preview.getByText('1 hidden')).toBeVisible();

  await backLink(preview).click();
  await expect(card(preview)).toBeVisible();
  await expect(
    card(preview).getByText(
      'Going back loses your edits. Save as PDF first to keep them.'
    )
  ).toBeVisible();
  await expect(
    card(preview).getByRole('button', { name: 'Stay' })
  ).toBeFocused();
  await card(preview).getByRole('button', { name: 'Stay' }).click();
  await expect(card(preview)).toHaveCount(0);
  await expect(backLink(preview)).toBeFocused();
  // Stay kept the page and its edits.
  await expect(preview.getByText('1 hidden')).toBeVisible();
  expect(await tabsAt(serviceWorker, 'export.html')).toHaveLength(1);

  await backLink(preview).click();
  await card(preview).getByRole('button', { name: 'Go back' }).click();

  await expect.poll(() => tabsAt(serviceWorker, 'export.html')).toEqual([]);
  expect(await activeIn(serviceWorker, fullView.windowId)).toBe(fullView.id);
  expect(dialogs, 'Go back raised no "Leave site?"').toEqual(['beforeunload']);
});

test('3. the full view closed first: a full view opens and is active, and the preview is gone', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const { preview, fullView, previewTab } = await previewFromFullView(
    context,
    serviceWorker,
    extensionId
  );
  await addTabAfter(context, serviceWorker, previewTab);
  await serviceWorker.evaluate((id) => chrome.tabs.remove(id), fullView.id);
  // PREMISE: no full view is left to go back to.
  await expect.poll(() => tabsAt(serviceWorker, FULL_VIEW)).toEqual([]);

  await backLink(preview).click();

  await expect.poll(() => tabsAt(serviceWorker, 'export.html')).toEqual([]);
  const [opened, ...more] = await tabsAt(serviceWorker, FULL_VIEW);
  expect(more).toEqual([]);
  expect(opened?.active).toBe(true);
  // In the window the preview was in.
  expect(opened?.windowId).toBe(previewTab.windowId);
});

test('4. from the popup: its page is active, the preview is gone, then the popup opens', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await stubOpenPopup(serviceWorker, false);
  const pages = context.pages().length;
  const { pageTab, previewId } = await serviceWorker.evaluate(
    async (previewUrl) => {
      const win = await chrome.windows.create({
        url: 'data:text/html,<title>Their page</title>',
        focused: true,
      });
      const [page] = win?.tabs ?? [];
      if (page?.id === undefined) throw new Error('no page tab');
      // As openBesideActiveTab opens it from the popup: right after, as its child.
      const preview = await chrome.tabs.create({
        url: previewUrl,
        windowId: page.windowId,
        index: page.index + 1,
        openerTabId: page.id,
        active: true,
      });
      return {
        pageTab: { id: page.id, windowId: page.windowId },
        previewId: preview.id,
      };
    },
    `chrome-extension://${extensionId}/${PREVIEW}&from=popup`
  );
  // Until both are pages: a late one is the next 'page' event (KAN-560).
  await expect.poll(() => context.pages().length).toBe(pages + 2);
  const preview = context.pages().find((p) => p.url().includes('export.html'));
  if (preview === undefined) throw new Error('no preview page');
  await expect(backLink(preview)).toBeVisible();
  // PREMISE: the preview is active, and the page tab is its opener.
  expect(await activeIn(serviceWorker, pageTab.windowId)).toBe(previewId);
  expect((await onlyTabAt(serviceWorker, 'export.html')).openerTabId).toBe(
    pageTab.id
  );

  await backLink(preview).click();

  await expect
    .poll(() => openPopupCalls(serviceWorker))
    .toEqual([
      {
        args: [{ windowId: pageTab.windowId }],
        popup: expect.stringMatching(/\/index\.html$/),
        // KAN-437: opened after the preview closed, or it would die with it.
        openUrls: expect.not.arrayContaining([
          expect.stringContaining('export.html'),
        ]),
      },
    ]);
  expect(await tabsAt(serviceWorker, 'export.html')).toEqual([]);
  expect(await activeIn(serviceWorker, pageTab.windowId)).toBe(pageTab.id);
});

// The link's ink, against the sheet's left edge.
const linkLayout = (page: Page) =>
  page.evaluate(() => {
    const link = document.querySelector(
      'button[aria-label="Back to Tab Keeper"]'
    );
    const arrow = link?.querySelector('[data-icon="arrow_back"]');
    const mark = link?.querySelector('svg:not([data-icon])');
    const sheet = document.querySelector('iframe');
    if (!arrow || !mark || !sheet) throw new Error('no link or sheet');
    const edges = (el: Element) => {
      const { left, right } = el.getBoundingClientRect();
      return { left, right };
    };
    return {
      arrow: edges(arrow),
      mark: edges(mark),
      sheetLeft: sheet.getBoundingClientRect().left,
    };
  });

test('5. the floppy sits on the sheet edge with the arrow in the margin, and narrow, the arrow meets the edge', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/${PREVIEW}&from=full`);
  await expect(backLink(page)).toBeVisible();
  await expect(page.locator('iframe')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // 880 is PREVIEW_BACK_HANG_MIN_PX: 816 + 2 × (18 arrow + 6 gap + 8 air).
  for (const width of [1280, 880]) {
    await page.setViewportSize({ width, height: 720 });
    const g = await linkLayout(page);
    expect(
      Math.abs(g.mark.left - g.sheetLeft),
      `${width}: ${JSON.stringify(g)}`
    ).toBeLessThanOrEqual(1);
    expect(
      g.arrow.right,
      `${width}: the arrow hangs left of the sheet`
    ).toBeLessThanOrEqual(g.sheetLeft);
  }
  for (const width of [879, 600]) {
    await page.setViewportSize({ width, height: 720 });
    const g = await linkLayout(page);
    expect(
      Math.abs(g.arrow.left - g.sheetLeft),
      `${width}: ${JSON.stringify(g)}`
    ).toBeLessThanOrEqual(4);
    // CONTROL: not hung, so the floppy is inside the sheet.
    expect(g.mark.left).toBeGreaterThan(g.sheetLeft + 10);
  }
});
