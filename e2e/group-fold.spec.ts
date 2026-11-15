import type { Locator, Page, Worker } from '@playwright/test';

// Saved groups draw as bands only with tabGroups, so every spec here needs the grant.
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, bandHandle, stored } from './fixtures/savedWindows';
import { pressOpen } from './fixtures/sessionActions';
import { standIn } from './fixtures/standInPages';

// KAN-822 on the real artifact: a saved group's chevron folds it to its title
// row, as the stored collapsed flag, and the flag reaches Chrome on restore.

// A loose tab leads, so the tab the window opens on is outside the group (D9).
const tab = (id: string, group?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: standIn(`Tab ${id}`),
  ...(group === undefined ? {} : { chromeGroupId: group }),
});
const tabs = [tab('lead'), tab('a', 'g1'), tab('b', 'g1')];
const TRIP = buildSession({
  tabGroupId: 'S1',
  title: 'Trip',
  isSelected: true,
  windowCount: 1,
  tabCount: tabs.length,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: tabs.length,
      title: 'w1',
      tabs,
      chromeTabGroups: [{ groupId: 'g1', title: 'Research', color: 'blue' }],
    },
  ],
});

const band = (page: Page): Locator =>
  page.locator('[data-pane="detail"] [data-band-id="g1"][role="group"]');
const collapse = (page: Page): Locator =>
  bandHandle(page, 'g1').getByRole('button', {
    name: 'Collapse: Research',
    exact: true,
  });
const expand = (page: Page): Locator =>
  bandHandle(page, 'g1').getByRole('button', {
    name: 'Expand: Research',
    exact: true,
  });
const memberRows = (page: Page): Locator =>
  band(page).locator('[data-saved-tab-row]');

const savedGroup = async (page: Page) => {
  const group = (await stored(page)).tabGroups[0].windows[0]
    .chromeTabGroups?.[0];
  if (!group) throw new Error('no saved group');
  return group;
};
const savedCollapsed = async (page: Page) =>
  (await savedGroup(page)).collapsed ?? null;
const hasCollapsedKey = async (page: Page) =>
  'collapsed' in (await savedGroup(page));

const tabCount = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({ populate: true })).reduce(
      (n, w) => n + (w.tabs?.length ?? 0),
      0
    )
  );

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

const centerX = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`no box for ${loc.toString()}`);
  return b.x + b.width / 2;
};

async function openTrip(page: Page, extensionId: string) {
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await bandHandle(page, 'g1').waitFor();
}

async function foldResearch(page: Page) {
  await collapse(page).click();
  await expect(expand(page)).toBeVisible();
  await expect.poll(() => savedCollapsed(page)).toBe(true);
}

test.describe('a saved group', () => {
  test.beforeEach(async ({ context }) => {
    await seedSessions(context, {
      ...buildContainer([TRIP]),
      selectedTabGroupId: 'S1',
    });
  });

  test('the chevron folds the group to its title row and stores it', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await expect(collapse(page)).toHaveAttribute('aria-expanded', 'true');
    // First in the title row, before the name.
    expect(
      await bandHandle(page, 'g1').evaluate(
        (row) =>
          row.firstElementChild?.getAttribute('aria-label') ?? 'no first child'
      )
    ).toBe('Collapse: Research');
    // PREMISE: the members are drawn while open.
    await expect(memberRows(page)).toHaveCount(2);

    await collapse(page).click();

    await expect(expand(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(memberRows(page)).toHaveCount(0);
    await expect(band(page).getByText('Tab a')).toHaveCount(0);
    await expect(band(page).getByText('Tab b')).toHaveCount(0);
    // Not hidden: neither rows nor the tail marker are in the DOM.
    await expect(
      band(page).locator('[data-fixed-row-id="g1:tail"]')
    ).toHaveCount(0);
    await expect(bandHandle(page, 'g1')).toBeVisible();
    await expect(bandHandle(page, 'g1').getByText('Research')).toBeVisible();
    await expect(bandHandle(page, 'g1').getByText('2 tabs')).toBeVisible();
    // The loose tab outside the group stays.
    await expect(page.getByText('Tab lead')).toBeVisible();
    await expect.poll(() => savedCollapsed(page)).toBe(true);

    await page.reload();
    await bandHandle(page, 'g1').waitFor();
    await expect(expand(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(memberRows(page)).toHaveCount(0);
  });

  test('unfold deletes the flag and ⌘Z puts it back', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await foldResearch(page);

    await expand(page).click();
    await expect(collapse(page)).toBeVisible();
    await expect(memberRows(page)).toHaveCount(2);
    await expect.poll(() => hasCollapsedKey(page)).toBe(false);

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => savedCollapsed(page)).toBe(true);
    await expect(expand(page)).toBeVisible();
    await expect(memberRows(page)).toHaveCount(0);
  });

  test('the chevron opens nothing', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    const before = await tabCount(serviceWorker);

    await foldResearch(page);
    await expand(page).click();
    await expect.poll(() => hasCollapsedKey(page)).toBe(false);
    // Long enough for an open the press started to have landed.
    await page.waitForTimeout(1000);
    expect(await tabCount(serviceWorker)).toBe(before);

    // CONTROL: a press on a tab row does open one, and this count sees it.
    await band(page).getByText('Tab a').click();
    await expect.poll(() => tabCount(serviceWorker)).toBe(before + 1);
  });

  test("the chevron sits in the tab rows' icon column", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    const favicon = page.locator(
      '[data-saved-tab-row="a"] [data-tour-anchor="tab-dot"]'
    );
    const chevron = await centerX(collapse(page));
    const icon = await centerX(favicon);
    expect(Math.abs(chevron - icon)).toBeLessThanOrEqual(1);
    // The name starts after the chevron, not under it.
    const chevronBox = await collapse(page).boundingBox();
    const nameBox = await bandHandle(page, 'g1')
      .getByText('Research')
      .boundingBox();
    expect(nameBox!.x).toBeGreaterThanOrEqual(
      chevronBox!.x + chevronBox!.width
    );
  });

  test("Collapse all windows leaves the group's fold", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await foldResearch(page);

    await page.getByRole('button', { name: 'Collapse all windows' }).click();
    await expect(bandHandle(page, 'g1')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand all windows' }).click();

    await expect(expand(page)).toBeVisible();
    await expect(memberRows(page)).toHaveCount(0);
    expect(await savedCollapsed(page)).toBe(true);
  });

  test('a group folded here opens collapsed in Chrome', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await foldResearch(page);

    const before = await serviceWorker.evaluate(async () =>
      (await chrome.windows.getAll()).map((w) => w.id)
    );
    await pressOpen(page);
    await expect
      .poll(
        async () => {
          const g = (await groupsNow(serviceWorker)).Research;
          return g && !before.includes(g.windowId) ? g.collapsed : null;
        },
        { timeout: 15_000 }
      )
      .toBe(true);
  });
});
