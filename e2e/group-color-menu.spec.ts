import type { Locator, Page, Worker } from '@playwright/test';

// Saved groups draw as bands only with tabGroups, so every spec here needs the grant.
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { POPUP, bandHandle, stored } from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';

// KAN-936 on the real artifact: a group's title menus offer its color, and a pick leaves the menu open.

const tabs = ['a', 'b'].map((id) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  chromeGroupId: 'g1',
}));
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

const colorRow = (page: Page): Locator =>
  page.getByRole('group', { name: 'Change group color' });
const swatch = (page: Page, name: string): Locator =>
  colorRow(page).getByRole('menuitemradio', { name, exact: true });
const groupHeader = (page: Page): Locator => bandHandle(page, 'g1');
const strip = (page: Page): Locator =>
  page.getByRole('button', { name: 'Change group color: Research' });
const stripColor = (page: Page) =>
  strip(page).evaluate((el) => getComputedStyle(el).backgroundColor);

const savedColor = async (page: Page) =>
  (await stored(page)).tabGroups[0].windows[0].chromeTabGroups?.[0].color;

async function openTrip(page: Page, extensionId: string) {
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await groupHeader(page).waitFor();
}

test.describe('a saved group', () => {
  test.beforeEach(async ({ context }) => {
    await seedSessions(context, {
      ...buildContainer([TRIP]),
      selectedTabGroupId: 'S1',
    });
  });

  test('right-click: picks stay open, recolor behind the menu, undo goes back to before it opened', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    const before = await stripColor(page);

    await groupHeader(page).click({ button: 'right' });
    await expect(swatch(page, 'Blue')).toHaveAttribute('aria-checked', 'true');
    await swatch(page, 'Red').click();
    await swatch(page, 'Green').click();
    await swatch(page, 'Pink').click();

    await expect(colorRow(page)).toBeVisible();
    await expect(swatch(page, 'Pink')).toHaveAttribute('aria-checked', 'true');
    await expect(swatch(page, 'Red')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => savedColor(page)).toBe('pink');
    await expect.poll(() => stripColor(page)).not.toBe(before);

    await page.keyboard.press('Escape');
    await expect(colorRow(page)).toBeHidden();

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => savedColor(page)).toBe('blue');
    await expect.poll(() => stripColor(page)).toBe(before);
  });

  test('⋮: the swatches lead the menu, a click away closes it', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await groupHeader(page).hover();
    await groupHeader(page)
      .getByRole('button', { name: 'More actions' })
      .click();
    const menu = page.locator('[role="menu"]').filter({ has: colorRow(page) });
    await expect(menu.locator(':scope > *').first()).toHaveAttribute(
      'data-menu-color-row'
    );
    await swatch(page, 'Yellow').click();
    await expect(colorRow(page)).toBeVisible();
    await expect.poll(() => savedColor(page)).toBe('yellow');

    await page.mouse.click(5, 5);
    await expect(colorRow(page)).toBeHidden();
  });

  test('the keyboard walks the row and Enter picks without closing', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await groupHeader(page).click({ button: 'right' });
    await page.keyboard.press('ArrowDown');
    await expect(swatch(page, 'Gray')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(swatch(page, 'Red')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => savedColor(page)).toBe('red');
    await expect(swatch(page, 'Red')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(swatch(page, 'Blue')).toBeFocused();
  });

  test('two menus are two undo steps; the strip still closes on a pick', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openTrip(page, extensionId);
    await groupHeader(page).click({ button: 'right' });
    await swatch(page, 'Red').click();
    await page.keyboard.press('Escape');
    await groupHeader(page).click({ button: 'right' });
    await swatch(page, 'Green').click();
    await page.keyboard.press('Escape');

    await strip(page).click();
    await page.getByRole('menuitemradio', { name: 'Purple' }).click();
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);
    await expect.poll(() => savedColor(page)).toBe('purple');

    for (const color of ['green', 'red', 'blue']) {
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => savedColor(page)).toBe(color);
    }
  });

  for (const root of [16, 20]) {
    test(`the menu fits the popup at a ${root}px root`, async ({
      context,
      extensionId,
    }) => {
      const page = await context.newPage();
      await openTrip(page, extensionId);
      await page.addStyleTag({
        content: `html{font-size:${root}px !important}`,
      });
      const header = await groupHeader(page).boundingBox();
      await page.mouse.click(header!.x + header!.width - 4, header!.y + 6, {
        button: 'right',
      });
      const box = await page
        .locator('[role="menu"]')
        .filter({ has: colorRow(page) })
        .boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(POPUP.width);
      const [first, last] = await Promise.all([
        swatch(page, 'Gray').boundingBox(),
        swatch(page, 'Orange').boundingBox(),
      ]);
      expect(first!.y).toBe(last!.y);
    });
  }
});

async function liveGroup(serviceWorker: Worker) {
  return serviceWorker.evaluate(
    async (urls) => {
      const w = await chrome.windows.create({ focused: false, url: urls });
      const tabs = await chrome.tabs.query({ windowId: w!.id });
      const groupId = await chrome.tabs.group({
        tabIds: tabs.map((t) => t.id!),
        createProperties: { windowId: w!.id },
      });
      await chrome.tabGroups.update(Number(groupId), {
        title: 'Live',
        color: 'blue',
      });
      return Number(groupId);
    },
    [standIn('Temple'), standIn('Bus')]
  );
}

const chromeColor = (serviceWorker: Worker, groupId: number) =>
  serviceWorker.evaluate(
    async (id) => (await chrome.tabGroups.get(id)).color,
    groupId
  );

async function openNow(page: Page, extensionId: string) {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const header = page
    .locator('[data-pane="open-now"] [data-group-drag-handle]')
    .first();
  await header.waitFor();
  return header;
}

test.describe('a group in Currently open', () => {
  test('right-click: every pick reaches Chrome and the menu stays open', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const groupId = await liveGroup(serviceWorker);
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await context.newPage();
    const header = await openNow(page, extensionId);

    await header.click({ button: 'right' });
    await expect(swatch(page, 'Blue')).toHaveAttribute('aria-checked', 'true');
    await swatch(page, 'Red').click();
    await expect.poll(() => chromeColor(serviceWorker, groupId)).toBe('red');
    await expect(swatch(page, 'Red')).toHaveAttribute('aria-checked', 'true');

    await swatch(page, 'Cyan').click();
    await expect.poll(() => chromeColor(serviceWorker, groupId)).toBe('cyan');
    await expect(swatch(page, 'Cyan')).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('Escape');
    await expect(colorRow(page)).toBeHidden();
  });

  test('⋮: a pick keeps the menu open; a group closed under it closes the menu', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const groupId = await liveGroup(serviceWorker);
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await context.newPage();
    const header = await openNow(page, extensionId);

    await header.hover();
    await header.getByRole('button', { name: 'More actions' }).click();
    await swatch(page, 'Green').click();
    await expect.poll(() => chromeColor(serviceWorker, groupId)).toBe('green');
    await expect(colorRow(page)).toBeVisible();

    await serviceWorker.evaluate(async (id) => {
      const tabs = await chrome.tabs.query({ groupId: id });
      await chrome.tabs.remove(tabs.map((t) => t.id!));
    }, groupId);
    await expect(colorRow(page)).toBeHidden();
  });
});
