import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-821. Add current tab on a saved window opens it if it was folded and
// brings the new tab's row into view; a refused add (the current tab is a Tab
// Keeper page, KAN-299) changes nothing. What jsdom cannot show: the real
// scroller, and whether the new row actually ends up on screen.

const POPUP = { width: 790, height: 550 };
const ADDED = 'Added page';
const TARGET = 'Reading list';
// The header's last pixels hang past the scroller's bottom edge: its first
// row starts where the chevron ends (measured), so it is wholly below.
const HEADER_OVERHANG = 4;

const win = (windowId: string, title: string) => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 8,
  title,
  tabs: Array.from({ length: 8 }, (_, i) => ({
    tabId: `${windowId}t${i}`,
    favicon: '',
    title: `${title} ${i + 1}`,
    url: `https://example.com/${windowId}/${i}`,
  })),
});

// Two windows above the target fill the scroller, one below gives it room to
// scroll down to the new row.
const SESSION = buildSession({
  tabGroupId: 'reading',
  title: 'Reading',
  isSelected: true,
  windowCount: 4,
  tabCount: 32,
  windows: [
    win('w1', 'Inbox'),
    win('w2', 'Notes'),
    win('w3', TARGET),
    win('w4', 'Later'),
  ],
});

async function openPopup(context: BrowserContext, extensionId: string) {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: SESSION.tabGroupId,
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(chevron(page, 'Collapse')).toBeVisible();
  return page;
}

// Driven as a tab, the popup page is itself the active tab, so every add would
// be refused. An ordinary page made active in its window is the current tab.
async function makeCurrentTab(worker: Worker, url: string) {
  await worker.evaluate(async (address) => {
    const [tk] = await chrome.tabs.query({
      url: `${chrome.runtime.getURL('index.html')}*`,
    });
    const made = await chrome.tabs.create({
      windowId: tk.windowId,
      url: address,
      active: true,
    });
    const id = made.id;
    if (id === undefined) throw new Error('the tab was made without an id');
    const title = decodeURIComponent(new URL(address).pathname.slice(1));
    for (;;) {
      const now = await chrome.tabs.get(id);
      if (now.status === 'complete' && now.title === title) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }, url);
  // CONTROL: the handler's own query now answers with that page.
  expect(
    await worker.evaluate(
      async () =>
        (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
          ?.url
    )
  ).toBe(url);
}

const block = (page: Page) => page.locator('[data-drop-window-id="w3"]');
const chevron = (page: Page, verb: 'Collapse' | 'Expand') =>
  page.getByRole('button', { name: `${verb}: ${TARGET}`, exact: true });
const addedRow = (page: Page) => block(page).getByText(ADDED, { exact: true });
const firstRow = (page: Page) =>
  block(page).locator('[data-drag-row-id="w3t0"]');
const storedTabCount = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('tabContainerData') ?? '{}').tabGroups[0]
        .windows[2].tabCount as number
  );

// The target's header sits on the scroller's bottom edge, its body below it.
async function headerAtBottomEdge(page: Page) {
  await block(page)
    .getByRole('button', { name: new RegExp(`^(Collapse|Expand): ${TARGET}$`) })
    .evaluate((el, overhang) => {
      let scroller = el.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight)
        scroller = scroller.parentElement;
      if (!scroller) throw new Error('no scroller');
      const edge = scroller.getBoundingClientRect().bottom;
      scroller.scrollTop +=
        el.getBoundingClientRect().bottom - (edge + overhang);
    }, HEADER_OVERHANG);
}

// The ⋮ lists only what the row does not already show, so Add tab is in the
// right-click menu's top row (KAN-708/775), not the ⋮.
const addViaRightClick = async (page: Page) => {
  await block(page)
    .locator('[data-window-drag-handle]')
    // Near its top: the header's last pixels are past the edge.
    .click({ button: 'right', position: { x: 8, y: 4 } });
  await page.getByRole('menuitem', { name: 'Add tab', exact: true }).click();
};
const addViaIcon = (page: Page) =>
  block(page)
    .getByRole('button', { name: 'Add current tab', exact: true })
    .click();

for (const [how, add] of [
  ['right-click Add tab', addViaRightClick],
  ['the ≡+ icon', addViaIcon],
] as const) {
  test(`collapsed window + ${how} opens it and shows the new tab`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPopup(context, extensionId);
    await chevron(page, 'Collapse').click();
    await expect(chevron(page, 'Expand')).toBeVisible();
    await makeCurrentTab(serviceWorker, standIn(ADDED));
    await headerAtBottomEdge(page);
    // PREMISE: the header is on screen and nothing of its body is.
    await expect(chevron(page, 'Expand')).toBeInViewport({ ratio: 0.5 });
    await expect(block(page)).toHaveAttribute('data-window-collapsed', '');

    await add(page);

    await expect(chevron(page, 'Collapse')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(addedRow(page)).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByText('Current tab added to this window.')
    ).toBeVisible();
    expect(await storedTabCount(page)).toBe(9);
  });
}

test('an open window at the bottom edge scrolls to the new tab', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openPopup(context, extensionId);
  await makeCurrentTab(serviceWorker, standIn(ADDED));
  await headerAtBottomEdge(page);
  // PREMISE: open, header on screen, the row the new tab will sit above is not.
  await expect(chevron(page, 'Collapse')).toBeInViewport({ ratio: 0.5 });
  await expect(firstRow(page)).not.toBeInViewport();

  await addViaIcon(page);

  await expect(addedRow(page)).toBeInViewport({ ratio: 1 });
  expect(await storedTabCount(page)).toBe(9);
});

test('a Tab Keeper page as current tab leaves the window collapsed', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await chevron(page, 'Collapse').click();
  await headerAtBottomEdge(page);

  await addViaIcon(page);
  // Long enough for the handler's query, the add and a frame to have landed.
  await page.waitForTimeout(500);

  await expect(chevron(page, 'Expand')).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(block(page)).toHaveAttribute('data-window-collapsed', '');
  await expect(page.getByText('Current tab added to this window.')).toHaveCount(
    0
  );
  expect(await storedTabCount(page)).toBe(8);
});
