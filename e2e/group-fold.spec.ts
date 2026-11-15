import type { Locator, Page, Worker } from '@playwright/test';

// Saved groups draw as bands only with tabGroups, so every spec here needs the grant.
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { POPUP, bandHandle, header, stored } from './fixtures/savedWindows';
import { elementLanded } from './fixtures/landed';
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

  // KAN-822 D3. The chevron is a button: Enter folds, Space unfolds, the stored flag following each.
  test('Enter and Space on the chevron fold and unfold the group', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await collapse(page).focus();
    await expect(collapse(page)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(expand(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(memberRows(page)).toHaveCount(0);
    await expect.poll(() => savedCollapsed(page)).toBe(true);
    // PREMISE: focus stays on the chevron, so the next press reaches it.
    await expect(expand(page)).toBeFocused();

    await page.keyboard.press('Space');
    await expect(collapse(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(memberRows(page)).toHaveCount(2);
    await expect.poll(() => hasCollapsedKey(page)).toBe(false);
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

// KAN-822 D8. Dropped on a folded group, a tab joins at its end and the group stays folded.
// c and lead loose above Research, stored folded: the group is at the window end.
const dropTabs = [tab('c'), tab('lead'), tab('a', 'g1'), tab('b', 'g1')];
const FOLDED_TRIP = buildSession({
  ...TRIP,
  tabCount: dropTabs.length,
  windows: [
    {
      ...TRIP.windows[0],
      tabCount: dropTabs.length,
      tabs: dropTabs,
      chromeTabGroups: [
        { groupId: 'g1', title: 'Research', color: 'blue', collapsed: true },
      ],
    },
  ],
});

// The stored window, each tab as id or id:group.
const storedOrder = async (page: Page) =>
  (await stored(page)).tabGroups[0].windows[0].tabs.map((t) =>
    t.chromeGroupId === undefined ? t.tabId : `${t.tabId}:${t.chromeGroupId}`
  );
const savedRow = (page: Page, id: string): Locator =>
  page.locator(`[data-pane="detail"] [data-drag-row-id="${id}"]`);
const landingSlot = (page: Page): Locator =>
  page.locator('[data-drag-landing-slot]');

// Presses on `row`, clears the activation distance, and rests at `y` past the rows' 0.18s ease.
async function holdOver(page: Page, row: Locator, y: () => Promise<number>) {
  const from = await boxOf(row);
  const x = from.x + 40;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 + 8, { steps: 2 });
  await expect(page.locator('[data-drag-held]')).toHaveCount(1);
  await page.mouse.move(x, await y(), { steps: 8 });
  await page.waitForTimeout(400);
}

test.describe('a tab dropped on a folded saved group', () => {
  test.beforeEach(async ({ context }) => {
    await seedSessions(context, {
      ...buildContainer([FOLDED_TRIP]),
      selectedTabGroupId: 'S1',
    });
  });

  test('a tab dropped on a folded group joins at its end and the group stays folded', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    // PREMISE: stored folded, drawn as its title row alone.
    await expect(band(page)).toHaveAttribute('data-group-folded', '');
    await expect(memberRows(page)).toHaveCount(0);

    await holdOver(page, savedRow(page, 'c'), async () => {
      const row = await boxOf(bandHandle(page, 'g1'));
      return row.y + row.height / 2;
    });
    // Ruling C: the join wash alone, no slot anywhere, and the group stays folded.
    await expect(band(page)).toHaveAttribute('data-drop-target', '');
    await expect(landingSlot(page)).toHaveCount(0);
    await expect(memberRows(page)).toHaveCount(0);
    await page.mouse.up();

    await expect
      .poll(() => storedOrder(page))
      .toEqual(['lead', 'a:g1', 'b:g1', 'c:g1']);
    expect(await savedCollapsed(page)).toBe(true);
    await expect(bandHandle(page, 'g1').getByText('3 tabs')).toBeVisible();
    await expect(memberRows(page)).toHaveCount(0);
    await expect(band(page)).toHaveAttribute('data-group-folded', '');
  });

  test('a tab dropped just above a folded group lands below it', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await expect(band(page)).toHaveAttribute('data-group-folded', '');
    // Measured from the window's own row, which a tab drag never moves.
    const windowTop = async () => (await boxOf(header(page, 'w1'))).y;

    // Past lead's midpoint, above the band: outside every band.
    await holdOver(page, savedRow(page, 'c'), async () => {
      return (await boxOf(band(page))).y - 3;
    });
    await expect(band(page)).not.toHaveAttribute('data-drop-target');
    // The slot is below the band's title row as the preview draws it.
    const slot = await boxOf(landingSlot(page));
    const title = await boxOf(bandHandle(page, 'g1'));
    expect(slot.y).toBeGreaterThanOrEqual(title.y + title.height);
    // The colour strip, which reads as "inside this group", ends with the title row, not beside the slot.
    const strip = await boxOf(band(page).locator('[data-group-color-strip]'));
    expect(strip.y + strip.height).toBeLessThanOrEqual(slot.y + 1);
    const promised = slot.y - (await windowTop());
    await page.mouse.up();

    await expect
      .poll(() => storedOrder(page))
      .toEqual(['lead', 'a:g1', 'b:g1', 'c']);
    expect(await savedCollapsed(page)).toBe(true);
    await expect(memberRows(page)).toHaveCount(0);
    // The preview promised where the row rests.
    await elementLanded(savedRow(page, 'c'), 'ancestors');
    const rested = (await boxOf(savedRow(page, 'c'))).y - (await windowTop());
    expect(Math.abs(rested - promised)).toBeLessThanOrEqual(1);
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

const expectLiveFolded = async (page: Page, k: Kyoto, count = 2) => {
  await expect(liveExpand(page, k)).toHaveAttribute('aria-expanded', 'false');
  await expect(liveBand(page, k)).toHaveAttribute('data-group-folded', '');
  await expect(liveMembers(page, k)).toHaveCount(0);
  // Not hidden: the tail marker is gone too (zero rects break the drag index).
  await expect(
    liveBand(page, k).locator(`[data-fixed-row-id="${k.groupId}:tail"]`)
  ).toHaveCount(0);
  await expect(liveTitleRow(page, k).getByText(`${count} tabs`)).toBeVisible();
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

  // KAN-822 D3. From the keyboard too: Enter collapses the Chrome group, Space expands it.
  test('Enter and Space on the chevron collapse and expand the Chrome group', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const k = await openLiveKyoto(page, serviceWorker);
    await expectLiveOpen(page, k);
    await liveCollapse(page, k).focus();
    await expect(liveCollapse(page, k)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect
      .poll(() => chromeCollapsed(serviceWorker, k.groupId))
      .toBe(true);
    await expectLiveFolded(page, k);
    // PREMISE: focus stays on the chevron, so the next press reaches it.
    await expect(liveExpand(page, k)).toBeFocused();

    await page.keyboard.press('Space');
    await expect
      .poll(() => chromeCollapsed(serviceWorker, k.groupId))
      .toBe(false);
    await expectLiveOpen(page, k);
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
    // Ends on Expand: one that reached Chrome would leave the group open there.
    await liveExpand(page, k).click();
    await expectLiveOpen(page, k, 1);
    await page.waitForTimeout(500);
    expect(await chromeCollapsed(serviceWorker, k.groupId)).toBe(true);

    // Cleared, the band follows Chrome again: folded, which the search's own set (empty) does not say.
    await searchField(page).fill('');
    await expect(liveBlock(page, k).getByText('Loose')).toBeVisible();
    await expectLiveFolded(page, k);

    // A search's own fold is dropped with it: the next search draws the match open again.
    await searchField(page).fill('Temples');
    await expect(liveBlock(page, k).getByText('Loose')).toHaveCount(0);
    await expectLiveOpen(page, k, 1);
    await liveCollapse(page, k).click();
    await expect(liveMembers(page, k)).toHaveCount(0);
    await searchField(page).fill('');
    await expect(liveBlock(page, k).getByText('Loose')).toBeVisible();
    await searchField(page).fill('Temples');
    await expect(liveBlock(page, k).getByText('Loose')).toHaveCount(0);
    await expectLiveOpen(page, k, 1);
  });

  test('a tab dropped on a folded Chrome group joins at its end', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const k = await openLiveKyoto(page, serviceWorker);
    // Loose stays inactive, so Chrome has no reason to expand the group it joins.
    await activate(serviceWorker, k.temples);
    await setChromeCollapsed(serviceWorker, k.groupId, true);
    await expectLiveFolded(page, k);
    const looseRow = liveBlock(page, k).locator(
      `[data-drag-row-id="${k.loose}"]`
    );
    await elementLanded(looseRow, 'ancestors');

    await holdOver(page, looseRow, async () => {
      const row = await boxOf(liveTitleRow(page, k));
      return row.y + row.height / 2;
    });
    await expect(liveBand(page, k)).toHaveAttribute('data-drop-target', '');
    await expect(landingSlot(page)).toHaveCount(0);
    await expect(liveMembers(page, k)).toHaveCount(0);
    await page.mouse.up();

    await expect
      .poll(() =>
        serviceWorker.evaluate(async (id) => {
          const t = await chrome.tabs.get(id);
          return { groupId: t.groupId, index: t.index };
        }, k.loose)
      )
      .toEqual({ groupId: k.groupId, index: 2 });
    const gardens = await serviceWorker.evaluate(
      async (id) => (await chrome.tabs.get(id)).index,
      k.gardens
    );
    expect(gardens).toBe(1);
    expect(await chromeCollapsed(serviceWorker, k.groupId)).toBe(true);
    await expectLiveFolded(page, k, 3);
  });
  // Review critical 1: a join at an open group's tail stays in that group, though a collapsed one follows it.
  test("a tab joining an open group's tail above a collapsed group stays in the open group", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const w = await serviceWorker.evaluate(async (urls) => {
      const made = await chrome.windows.create({ url: urls, focused: false });
      const [open1, open2, shut1, tail] = (made?.tabs ?? []).map(
        (t) => t.id ?? -1
      );
      const openId = await chrome.tabs.group({
        tabIds: [open1, open2],
        createProperties: { windowId: made?.id },
      });
      await chrome.tabGroups.update(openId, { title: 'Nara', color: 'green' });
      const shutId = await chrome.tabs.group({
        tabIds: [shut1],
        createProperties: { windowId: made?.id },
      });
      await chrome.tabGroups.update(shutId, {
        title: 'Osaka',
        color: 'red',
        collapsed: true,
      });
      return {
        windowId: made?.id ?? -1,
        openId,
        shutId,
        open1,
        open2,
        shut1,
        tail,
      };
    }, ['Deer', 'Park', 'Castle', 'Tail'].map(standIn));
    const k = await openKyoto(serviceWorker);
    const block = page.locator(`[data-open-window-id="${w.windowId}"]`);
    const open2Row = block.locator(`[data-drag-row-id="${w.open2}"]`);
    // PREMISE: Osaka is drawn folded, Nara open with both members.
    await expect(
      block.locator(`[data-band-id="${w.shutId}"][role="group"]`)
    ).toHaveAttribute('data-group-folded', '');
    await expect(open2Row).toBeVisible();
    const looseRow = liveBlock(page, k).locator(
      `[data-drag-row-id="${k.loose}"]`
    );
    await expect(looseRow).toBeVisible();
    await elementLanded(looseRow, 'ancestors');

    // From Kyoto's window into Nara, past its last member's midpoint: the tail.
    await holdOver(page, looseRow, async () => {
      const row = await boxOf(open2Row);
      return row.y + row.height - 6;
    });
    await expect(
      block.locator(`[data-band-id="${w.openId}"][role="group"]`)
    ).toHaveAttribute('data-drop-target', '');
    // Every place Chrome reports for the tab: asked past Osaka, it was carried out of Nara and back.
    await serviceWorker.evaluate((id) => {
      const seen: string[] = [];
      Reflect.set(globalThis, '__looseSeen', seen);
      chrome.tabs.onAttached.addListener((tabId, info) => {
        if (tabId === id) seen.push(`at ${info.newPosition}`);
      });
      chrome.tabs.onMoved.addListener((tabId, info) => {
        if (tabId === id) seen.push(`at ${info.toIndex}`);
      });
      chrome.tabs.onUpdated.addListener((tabId, change) => {
        if (tabId === id && change.groupId !== undefined)
          seen.push(`group ${change.groupId}`);
      });
    }, k.loose);
    await page.mouse.up();

    const place = (id: number) =>
      serviceWorker.evaluate(async (tabId) => {
        const t = await chrome.tabs.get(tabId);
        return { windowId: t.windowId, index: t.index, groupId: t.groupId };
      }, id);
    await expect
      .poll(() => place(k.loose))
      .toEqual({ windowId: w.windowId, index: 2, groupId: w.openId });
    expect(await place(w.open1)).toEqual({
      windowId: w.windowId,
      index: 0,
      groupId: w.openId,
    });
    expect(await place(w.open2)).toEqual({
      windowId: w.windowId,
      index: 1,
      groupId: w.openId,
    });
    expect(await place(w.shut1)).toEqual({
      windowId: w.windowId,
      index: 3,
      groupId: w.shutId,
    });
    expect(await place(w.tail)).toEqual({
      windowId: w.windowId,
      index: 4,
      groupId: -1,
    });
    expect(await chromeCollapsed(serviceWorker, w.shutId)).toBe(true);
    const seenNow = () =>
      serviceWorker.evaluate(() => {
        const log: unknown = Reflect.get(globalThis, '__looseSeen');
        return Array.isArray(log) ? log.map(String) : [];
      });
    // Settled: the same length on two reads 150ms apart, so a late bad move is in the log.
    let lastLength = -1;
    await expect
      .poll(
        async () => {
          const length = (await seenNow()).length;
          const settled = length === lastLength;
          lastLength = length;
          return settled;
        },
        { intervals: [150] }
      )
      .toBe(true);
    const seen = await seenNow();
    // PREMISE: the recorder saw the join.
    expect(seen).toContain(`group ${w.openId}`);
    // Never ungrouped, never past Osaka's member (index 3); Chrome attaches it at the end (4) on its way in.
    expect(seen.filter((e) => e.startsWith('group '))).toEqual([
      `group ${w.openId}`,
    ]);
    expect(seen).not.toContain('at 3');
  });
});

// KAN-822 fit. The chevron pushes the name right by its width; no title row may overflow, folded or open.
const FIT_GROUPS = [
  {
    id: 'g1',
    title: 'Reiseplanung Herbst: Sehenswürdigkeiten',
    color: 'blue',
    collapsed: false,
  },
  {
    id: 'g2',
    title: 'Restaurants und Cafés in der Altstadt',
    color: 'orange',
    collapsed: true,
  },
  { id: 'g3', title: 'Tag 1', color: 'purple', collapsed: false },
];
const fitTabs = [
  tab('lead'),
  tab('a', 'g1'),
  tab('b', 'g1'),
  tab('c', 'g2'),
  tab('d', 'g2'),
  tab('e', 'g3'),
];
const FIT_TRIP = buildSession({
  tabGroupId: 'S1',
  title: 'Trip',
  isSelected: true,
  windowCount: 1,
  tabCount: fitTabs.length,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: fitTabs.length,
      title: 'w1',
      tabs: fitTabs,
      chromeTabGroups: FIT_GROUPS.map(({ id, title, color, collapsed }) => ({
        groupId: id,
        title,
        color,
        // An open group stores no flag (KAN-822); a stored false reads as invalid.
        ...(collapsed ? { collapsed } : {}),
      })),
    },
  ],
});

// A window with one open and one collapsed live group, long names, so Currently open draws both chevron states.
async function openFitWindow(worker: Worker) {
  return worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const ids = (win?.tabs ?? []).map((t) => t.id ?? -1);
    const open = await chrome.tabs.group({
      tabIds: [ids[1], ids[2]],
      createProperties: { windowId: win?.id },
    });
    await chrome.tabGroups.update(open, {
      title: 'Reiseplanung Herbst: Sehenswürdigkeiten',
      color: 'green',
    });
    const shut = await chrome.tabs.group({
      tabIds: [ids[3], ids[4]],
      createProperties: { windowId: win?.id },
    });
    await chrome.tabGroups.update(shut, {
      title: 'Restaurants und Cafés in der Altstadt',
      color: 'red',
      collapsed: true,
    });
    return { windowId: win?.id ?? -1, open, shut };
  }, ['Lead', 'One', 'Two', 'Three', 'Four'].map(standIn));
}

// Every title row draws exactly these parts, plus the drag grip that hangs outside it on purpose (left: -40px, DragHandle outsideRow).
const ROW_PARTS = ['actions', 'chevron', 'count tag', 'name'];

// Each row's drawn parts and where they poke out of the row, in px; a part not drawn, or an unknown child, is reported as a problem.
const boxesOutsideRow = (rows: Locator) =>
  rows.evaluateAll((els) => {
    const TOLERANCE = 0.5;
    const partOf = (c: Element) =>
      c.matches('.group-actions')
        ? 'actions'
        : c.querySelector('[data-fold-chevron]') !== null
          ? 'chevron'
          : c.querySelector('[data-row-tag]') !== null
            ? 'count tag'
            : c.matches('button, input') ||
                c.querySelector('button, input') !== null
              ? 'name'
              : 'unknown';
    return els.map((row) => {
      const box = row.getBoundingClientRect();
      const group =
        row.closest('[data-band-id]')?.getAttribute('aria-label') ?? '?';
      const parts = Array.from(row.children)
        .filter((c) => !c.matches('[data-drag-handle]'))
        .map((el) => ({ part: partOf(el), el }));
      const tag = row.querySelector('[data-row-tag]');
      const measured = [
        ...parts,
        ...(tag === null ? [] : [{ part: 'count tag (itself)', el: tag }]),
      ];
      const found = parts.map((p) => p.part).sort();
      const pokes = measured.flatMap(({ part, el }) => {
        const r = el.getBoundingClientRect();
        const left = box.left - r.left;
        const right = r.right - box.right;
        return [
          ...(left > TOLERANCE ? [{ part, side: 'left', px: left }] : []),
          ...(right > TOLERANCE ? [{ part, side: 'right', px: right }] : []),
        ];
      });
      return { group, found, pokes };
    });
  });

const FITS = [
  {
    name: 'popup 790x550, en',
    language: 'en',
    fontPx: 16,
    path: 'index.html',
    fullView: false,
    viewport: POPUP,
  },
  {
    name: 'popup 790x550, de at Large text',
    language: 'de',
    fontPx: 20,
    path: 'index.html',
    fullView: false,
    viewport: POPUP,
  },
  {
    name: 'full view 1280x800, de at Large text',
    language: 'de',
    fontPx: 20,
    path: VIEW_TAB,
    fullView: true,
    viewport: TAB_VIEWPORT,
  },
];

test.describe('group title rows with the fold chevron', () => {
  for (const fit of FITS) {
    test(`no group title row overflows: ${fit.name}`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await seedSessions(context, {
        ...buildContainer([FIT_TRIP]),
        selectedTabGroupId: 'S1',
      });
      // The full view folds the saved session away unless told not to; both panes are wanted open.
      await seedSettings(context, {
        language: fit.language,
        ...(fit.fullView ? { foldSavedSessionInTabView: false } : {}),
      });
      const win = await openFitWindow(serviceWorker);
      // Not openPage: it waits on the English "Sort sessions" label.
      const page = await context.newPage();
      await page.setViewportSize(fit.viewport);
      await page.goto(`chrome-extension://${extensionId}/${fit.path}`);
      // CONTROL: the seeded language took, so a German run is not passing in English.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.lang))
        .toBe(fit.language);
      // Chrome's Large font size sets the root; the app has no setting for it.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.setFontSizes', {
        fontSizes: { standard: fit.fontPx, fixed: 13 },
      });
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize
        )
      ).toBe(`${fit.fontPx}px`);

      const saved = page.locator(
        '[data-pane="detail"] [data-group-drag-handle]'
      );
      const live = page.locator(
        `[data-open-window-id="${win.windowId}"] [data-group-drag-handle]`
      );
      // PREMISE: every group is drawn, folded and open, in each pane there is. The popup has no Currently open pane.
      await expect(saved).toHaveCount(FIT_GROUPS.length);
      await expect(
        saved.locator('[data-fold-chevron="expand_more"]')
      ).toHaveCount(1);
      await expect(
        saved.locator('[data-fold-chevron="expand_less"]')
      ).toHaveCount(2);
      await expect(live).toHaveCount(fit.fullView ? 2 : 0);
      if (fit.fullView) {
        await expect(
          live.locator('[data-fold-chevron="expand_more"]')
        ).toHaveCount(1);
        await expect(
          live.locator('[data-fold-chevron="expand_less"]')
        ).toHaveCount(1);
      }

      // Fonts loaded and two frames painted, then two equal measurements.
      await page.evaluate(() =>
        document.fonts.ready.then(
          () =>
            new Promise((done) =>
              requestAnimationFrame(() => requestAnimationFrame(done))
            )
        )
      );
      const measure = async () => [
        ...(await boxesOutsideRow(saved)).map((r) => ({ pane: 'saved', ...r })),
        ...(await boxesOutsideRow(live)).map((r) => ({
          pane: 'open now',
          ...r,
        })),
      ];
      const rows = await measure();
      expect(await measure()).toEqual(rows);

      // PREMISE: every row drew all four parts and nothing else, so no part is skipped unmeasured.
      expect(rows).toHaveLength(FIT_GROUPS.length + (fit.fullView ? 2 : 0));
      const wrongParts = rows.filter(
        (r) => r.found.join() !== ROW_PARTS.join()
      );
      expect(
        wrongParts,
        `rows whose parts are not ${ROW_PARTS.join(', ')}: ${wrongParts.map((r) => `${r.pane} "${r.group}" has ${r.found.join(', ') || 'nothing'}`).join('; ')}`
      ).toEqual([]);

      const out = rows.flatMap((r) =>
        r.pokes.map((q) => ({ pane: r.pane, group: r.group, ...q }))
      );
      expect(
        out,
        `outside the row: ${out.map((r) => `${r.pane} "${r.group}" ${r.part} ${r.side} by ${r.px.toFixed(1)}px`).join('; ')}`
      ).toEqual([]);
    });
  }
});
