import type { Locator, Page, Worker } from '@playwright/test';

// Saved groups draw as bands only with tabGroups, so every spec here needs the grant.
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP, bandHandle, stored } from './fixtures/savedWindows';
import { pressOpen } from './fixtures/sessionActions';
import { standIn } from './fixtures/standInPages';
import { openPage } from './fixtures/onboarding';

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

const boxOf = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`no box for ${loc.toString()}`);
  return b;
};
const centerX = async (loc: Locator) => {
  const b = await boxOf(loc);
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

    // PREMISE: an open band carries no fold mark.
    await expect(band(page)).not.toHaveAttribute('data-group-folded');

    await collapse(page).click();

    await expect(expand(page)).toHaveAttribute('aria-expanded', 'false');
    // The band's mark, which Task 4's drop rules read.
    await expect(band(page)).toHaveAttribute('data-group-folded', '');
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
    await expect(band(page)).not.toHaveAttribute('data-group-folded');
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
    const chevronBox = await boxOf(collapse(page));
    const nameBox = await boxOf(bandHandle(page, 'g1').getByText('Research'));
    expect(nameBox.x).toBeGreaterThanOrEqual(chevronBox.x + chevronBox.width);
  });

  test('a saved search matching a folded member leaves the group folded (D6)', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await foldResearch(page);

    await page.locator('[data-saved-search] input').fill('Tab a');
    // PREMISE: the search is applied: the tab outside the match is filtered out.
    await expect(page.getByText('Tab lead')).toHaveCount(0);

    await expect(expand(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(band(page)).toHaveAttribute('data-group-folded', '');
    await expect(memberRows(page)).toHaveCount(0);
    expect(await savedCollapsed(page)).toBe(true);

    // Cleared, it is still the stored fold.
    await page.locator('[data-saved-search] input').fill('');
    await expect(page.getByText('Tab lead')).toBeVisible();
    await expect(expand(page)).toBeVisible();
    expect(await savedCollapsed(page)).toBe(true);
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

// KAN-822 D2. In Currently open the fold is Chrome's own collapse, both ways.
const VIEW_TAB = 'index.html?view=tab';
const TAB_VIEWPORT = { width: 1280, height: 800 };

// open-now-group-edit.spec.ts's window: Temples and Gardens grouped as Kyoto, Loose outside it.
async function openKyoto(worker: Worker) {
  return worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const [temples, gardens, loose] = (win?.tabs ?? []).map((t) => t.id ?? -1);
    const groupId = await chrome.tabs.group({
      tabIds: [temples, gardens],
      createProperties: { windowId: win?.id },
    });
    await chrome.tabGroups.update(groupId, { title: 'Kyoto', color: 'blue' });
    return { windowId: win?.id ?? -1, groupId, temples, gardens, loose };
  }, ['Temples', 'Gardens', 'Loose'].map(standIn));
}
type Kyoto = Awaited<ReturnType<typeof openKyoto>>;

const chromeCollapsed = (worker: Worker, groupId: number) =>
  worker.evaluate(
    async (id) => (await chrome.tabGroups.get(id)).collapsed,
    groupId
  );
const setChromeCollapsed = (
  worker: Worker,
  groupId: number,
  collapsed: boolean
) =>
  worker.evaluate(
    async ({ id, collapsed }) => {
      await chrome.tabGroups.update(id, { collapsed });
    },
    { id: groupId, collapsed }
  );
const activate = (worker: Worker, tabId: number) =>
  worker.evaluate(async (id) => {
    await chrome.tabs.update(id, { active: true });
  }, tabId);
const activeTab = (worker: Worker, windowId: number) =>
  worker.evaluate(
    async (windowId) =>
      (await chrome.tabs.query({ windowId, active: true }))[0]?.id ?? -1,
    windowId
  );

const liveBlock = (page: Page, k: Kyoto): Locator =>
  page.locator(`[data-open-window-id="${k.windowId}"]`);
const liveBand = (page: Page, k: Kyoto): Locator =>
  liveBlock(page, k).locator(`[data-band-id="${k.groupId}"][role="group"]`);
const liveTitleRow = (page: Page, k: Kyoto): Locator =>
  liveBand(page, k).locator('[data-group-drag-handle]');
const liveCollapse = (page: Page, k: Kyoto): Locator =>
  liveTitleRow(page, k).getByRole('button', {
    name: 'Collapse: Kyoto',
    exact: true,
  });
const liveExpand = (page: Page, k: Kyoto): Locator =>
  liveTitleRow(page, k).getByRole('button', {
    name: 'Expand: Kyoto',
    exact: true,
  });
const liveMembers = (page: Page, k: Kyoto): Locator =>
  liveBand(page, k).locator('[data-open-tab-id]');
const searchField = (page: Page): Locator =>
  page
    .locator('[data-pane="open-now"]')
    .getByRole('textbox', { name: 'Search open tabs', exact: true });

async function openLiveKyoto(page: Page, worker: Worker): Promise<Kyoto> {
  const k = await openKyoto(worker);
  // PREMISE: the grant reached the pane, the band and its two members are drawn, titles loaded.
  await expect(liveMembers(page, k)).toHaveCount(2);
  await expect(
    liveBand(page, k).getByRole('button', {
      name: 'Switch to tab: Temples',
      exact: true,
    })
  ).toBeVisible();
  return k;
}

const expectLiveFolded = async (page: Page, k: Kyoto) => {
  await expect(liveExpand(page, k)).toHaveAttribute('aria-expanded', 'false');
  await expect(liveBand(page, k)).toHaveAttribute('data-group-folded', '');
  await expect(liveMembers(page, k)).toHaveCount(0);
  // Not hidden: the tail marker is gone too (zero rects break the drag index).
  await expect(
    liveBand(page, k).locator(`[data-fixed-row-id="${k.groupId}:tail"]`)
  ).toHaveCount(0);
  await expect(liveTitleRow(page, k).getByText('2 tabs')).toBeVisible();
};
const expectLiveOpen = async (page: Page, k: Kyoto, members = 2) => {
  await expect(liveCollapse(page, k)).toHaveAttribute('aria-expanded', 'true');
  await expect(liveBand(page, k)).not.toHaveAttribute('data-group-folded');
  await expect(liveMembers(page, k)).toHaveCount(members);
};

test.describe('a group in Currently open', () => {
  test('the chevron collapses the Chrome group, and the band folds', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const k = await openLiveKyoto(page, serviceWorker);
    // The loose tab in front, so a Go to group the press leaked would switch away from it (KAN-797).
    await activate(serviceWorker, k.loose);
    await expectLiveOpen(page, k);
    // First in the title row, before the name.
    expect(
      await liveTitleRow(page, k).evaluate(
        (row) =>
          row.firstElementChild?.getAttribute('aria-label') ?? 'no first child'
      )
    ).toBe('Collapse: Kyoto');

    await liveCollapse(page, k).click();
    await expect
      .poll(() => chromeCollapsed(serviceWorker, k.groupId))
      .toBe(true);
    await expectLiveFolded(page, k);
    await expect(liveBlock(page, k).getByText('Loose')).toBeVisible();

    await liveExpand(page, k).click();
    await expect
      .poll(() => chromeCollapsed(serviceWorker, k.groupId))
      .toBe(false);
    await expectLiveOpen(page, k);
    // Neither press went to the group or opened its rename.
    expect(await activeTab(serviceWorker, k.windowId)).toBe(k.loose);
    await expect(liveTitleRow(page, k).locator('input')).toHaveCount(0);
  });

  test("the chevron sits in the tab rows' icon column", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const k = await openLiveKyoto(page, serviceWorker);
    const favicon = liveBand(page, k)
      .getByRole('button', { name: 'Switch to tab: Temples', exact: true })
      .locator(':scope > *')
      .first();
    const chevron = await centerX(liveCollapse(page, k));
    const icon = await centerX(favicon);
    expect(Math.abs(chevron - icon)).toBeLessThanOrEqual(1);
    const chevronBox = await boxOf(liveCollapse(page, k));
    const nameBox = await boxOf(liveTitleRow(page, k).getByText('Kyoto'));
    expect(nameBox.x).toBeGreaterThanOrEqual(chevronBox.x + chevronBox.width);
  });

  test('a collapse made in Chrome shows folded', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const k = await openLiveKyoto(page, serviceWorker);
    await activate(serviceWorker, k.loose);
    await expectLiveOpen(page, k);

    await setChromeCollapsed(serviceWorker, k.groupId, true);
    await expectLiveFolded(page, k);

    // Chrome expands a collapsed group when a tab in it becomes active, and the band follows.
    await activate(serviceWorker, k.temples);
    await expect
      .poll(() => chromeCollapsed(serviceWorker, k.groupId))
      .toBe(false);
    await expectLiveOpen(page, k);
  });

  test('folding the group that holds the active tab keeps it collapsed', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const k = await openLiveKyoto(page, serviceWorker);
    await activate(serviceWorker, k.temples);
    await expect
      .poll(() => activeTab(serviceWorker, k.windowId))
      .toBe(k.temples);

    await liveCollapse(page, k).click();
    await expect
      .poll(() => chromeCollapsed(serviceWorker, k.groupId))
      .toBe(true);
    await expectLiveFolded(page, k);
    // Long enough for Chrome to have undone it, as it does on activating a member.
    await page.waitForTimeout(1000);
    expect(await chromeCollapsed(serviceWorker, k.groupId)).toBe(true);
    expect(await activeTab(serviceWorker, k.windowId)).toBe(k.temples);
    await expect(liveExpand(page, k)).toBeVisible();
  });

  test('during a search the chevron folds only the drawing', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const k = await openLiveKyoto(page, serviceWorker);
    await activate(serviceWorker, k.loose);
    await setChromeCollapsed(serviceWorker, k.groupId, true);
    await expectLiveFolded(page, k);

    // A search draws its match open, whatever Chrome holds (D6).
    await searchField(page).fill('Temples');
    // PREMISE: the search is applied: the tab outside the match is not drawn.
    await expect(liveBlock(page, k).getByText('Loose')).toHaveCount(0);
    await expectLiveOpen(page, k, 1);

    await liveCollapse(page, k).click();
    await expect(liveExpand(page, k)).toHaveAttribute('aria-expanded', 'false');
    await expect(liveMembers(page, k)).toHaveCount(0);
    await liveExpand(page, k).click();
    await expectLiveOpen(page, k, 1);
    await liveCollapse(page, k).click();
    await expect(liveMembers(page, k)).toHaveCount(0);
    // An Expand that reached Chrome would have opened the group there.
    await page.waitForTimeout(500);
    expect(await chromeCollapsed(serviceWorker, k.groupId)).toBe(true);

    // Cleared, the band follows Chrome again.
    await searchField(page).fill('');
    await expect(liveBlock(page, k).getByText('Loose')).toBeVisible();
    await expectLiveFolded(page, k);
    // The next search starts from no folds of its own, so it draws the match open again.
    await searchField(page).fill('Temples');
    await expect(liveBlock(page, k).getByText('Loose')).toHaveCount(0);
    await expectLiveOpen(page, k, 1);
  });
});
