import type { BrowserContext, Page } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { currentTabUrl, overAnOrdinaryTab } from './fixtures/currentTab';

// KAN-821. Add current tab on a saved window opens it if it was folded and
// brings the new tab's row into view. KAN-823: over a Tab Keeper page no Add
// current tab is offered at all. What jsdom cannot show: the real scroller,
// whether the new row actually ends up on screen, and the real current tab.

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
    {
      ...win('w4', 'Later'),
      tabs: win('w4', 'Later').tabs.map((tab, i) =>
        i < 2 ? { ...tab, chromeGroupId: 'g1' } : tab
      ),
      chromeTabGroups: [{ groupId: 'g1', title: 'Queue', color: 'blue' }],
    },
  ],
});

// `current`: the title of an ordinary page made the current tab. Without
// one, the popup page itself is the current tab: a Tab Keeper page.
async function openPopup(
  context: BrowserContext,
  extensionId: string,
  current?: string
) {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: SESSION.tabGroupId,
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  if (current !== undefined) await overAnOrdinaryTab(page, current);
  await expect(chevron(page, 'Collapse')).toBeVisible();
  return page;
}

const block = (page: Page) => page.locator('[data-drop-window-id="w3"]');
const groupAdd = (page: Page) =>
  page.getByRole('button', { name: 'Add current tab to group', exact: true });
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
  }) => {
    const page = await openPopup(context, extensionId, ADDED);
    await chevron(page, 'Collapse').click();
    await expect(chevron(page, 'Expand')).toBeVisible();
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
}) => {
  const page = await openPopup(context, extensionId, ADDED);
  // CONTROL for the KAN-823 test below: over an ordinary page, a group offers it.
  await expect(groupAdd(page)).toHaveCount(1);
  await headerAtBottomEdge(page);
  // PREMISE: open, header on screen, the row the new tab will sit above is not.
  await expect(chevron(page, 'Collapse')).toBeInViewport({ ratio: 0.5 });
  await expect(firstRow(page)).not.toBeInViewport();

  await addViaIcon(page);

  await expect(addedRow(page)).toBeInViewport({ ratio: 1 });
  expect(await storedTabCount(page)).toBe(9);
});

test('a Tab Keeper page as current tab: no Add current tab is offered', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  // PREMISE: the current tab is the popup page itself, a Tab Keeper page.
  expect(await currentTabUrl(page)).toBe(page.url());
  await chevron(page, 'Collapse').click();

  await expect(
    block(page).getByRole('button', { name: 'Add current tab', exact: true })
  ).toHaveCount(0);
  await expect(groupAdd(page)).toHaveCount(0);
  await block(page)
    .locator('[data-window-drag-handle]')
    .click({ button: 'right' });
  // The menu is open: its other top-row items are there.
  await expect(
    page.getByRole('menuitem', { name: 'Open', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Add tab', exact: true })
  ).toHaveCount(0);
  await expect(block(page)).toHaveAttribute('data-window-collapsed', '');
});
