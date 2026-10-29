import type { Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-783. Copy all links on every window and group menu, live and saved, and
// on Open now's header right-click, read back off the real clipboard: the unit
// tests use a fake one. Each paste is headed by what was copied (pick 2B),
// under the With headings layout (KAN-859).

const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

const tab = (
  tabId: string,
  title: string,
  url: string,
  chromeGroupId?: string
) => ({
  tabId,
  favicon: '',
  title,
  url,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

// Hotels: two loose tabs, then Food.
const SAVED = buildSession({
  tabGroupId: 'S1',
  title: 'Kyoto trip',
  windowCount: 1,
  tabCount: 4,
  isSelected: true,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 4,
      title: 'Hotels',
      tabs: [
        tab('t1', 'Ryokan near Gion', 'https://ryokan.example/gion'),
        tab('t2', 'Kyoto bus pass', 'https://bus.example/pass'),
        tab('t3', 'Nishiki Market stalls', 'https://nishiki.example/', 'g1'),
        tab('t4', 'Best ramen in Kyoto', 'https://ramen.example/kyoto', 'g1'),
      ],
      chromeTabGroups: [{ groupId: 'g1', title: 'Food', color: 'orange' }],
    },
  ],
});

// Window 2: a loose tab, Temples (2), then a loose tab.
const OTHER = [
  'Flights SFO–KIX',
  'Fushimi Inari hours',
  'Kinkaku-ji tickets',
  'Kyoto weather',
];

async function stage(worker: Worker) {
  await worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const ids = win!.tabs!.map((t) => t.id!);
    const group = await chrome.tabs.group({
      tabIds: [ids[1], ids[2]],
      createProperties: { windowId: win!.id },
    });
    await chrome.tabGroups.update(group, { title: 'Temples', color: 'red' });
  }, OTHER.map(standIn));
}

const pane = (page: Page, name: string) =>
  page.locator(`[data-pane="${name}"]`);
const liveBlock = (page: Page, index: number) =>
  pane(page, 'open-now').locator('[data-open-window-id]').nth(index);

async function openTabView(page: Page, extensionId: string) {
  await page.setViewportSize({ width: 1500, height: 820 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  // Every live title loaded, so the copy carries names and not addresses.
  for (const title of OTHER) {
    await expect(pane(page, 'open-now').getByText(title)).toBeVisible();
  }
  await expect(pane(page, 'detail').getByText('Food')).toBeVisible();
}

const menuKeys = (page: Page) =>
  page
    .getByRole('menu')
    .locator('[data-menu-item]')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-menu-item'))
    );

async function copyAndPaste(
  page: Page,
  links: string | RegExp,
  copy = page.getByRole('menuitem', { name: 'Copy all links' })
) {
  await copy.click();
  // Barrier: the toast appears after the write resolves.
  await expect(page.getByText(links).last()).toBeVisible();

  const target = await page.context().newPage();
  await target.goto(
    'data:text/html,<div id="rich" contenteditable="true"></div><textarea id="plain" rows="30" cols="80"></textarea>'
  );
  await target.locator('#rich').click();
  await target.keyboard.press(PASTE);
  const anchors = await target
    .locator('#rich a')
    .evaluateAll((all) =>
      all.map((a) => [a.textContent, a.getAttribute('href')])
    );
  await target.locator('#plain').click();
  await target.keyboard.press(PASTE);
  const plain = await target.locator('#plain').inputValue();
  await target.close();
  return { plain, anchors };
}

test.beforeEach(async ({ context, serviceWorker }) => {
  await stage(serviceWorker);
  await seedSettings(context, {
    foldSavedSessionInTabView: false,
    copyLinksLayout: 'with-headings',
  });
  await seedSessions(context, {
    ...buildContainer([SAVED]),
    selectedTabGroupId: 'S1',
  });
});

test("a live window's ⋮ leads with Copy all links and pastes that window under its number", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);

  await liveBlock(page, 1).locator('[data-window-row]').first().hover();
  await liveBlock(page, 1)
    .getByRole('button', { name: 'More actions: Window 2' })
    .click();
  expect((await menuKeys(page))[0]).toBe('copy');
  const { plain, anchors } = await copyAndPaste(page, '4 links copied.');

  expect(plain).toBe(
    [
      'Window 2',
      '4 Tabs',
      '',
      '- Flights SFO–KIX',
      `  ${standIn('Flights SFO–KIX')}`,
      '',
      'Temples (2 Tabs)',
      '  - Fushimi Inari hours',
      `    ${standIn('Fushimi Inari hours')}`,
      '  - Kinkaku-ji tickets',
      `    ${standIn('Kinkaku-ji tickets')}`,
      '',
      '- Kyoto weather',
      `  ${standIn('Kyoto weather')}`,
    ].join('\n')
  );
  expect(anchors).toEqual(OTHER.map((title) => [title, standIn(title)]));
});

test("a live group's ⋮ leads with Copy all links and pastes only its own tabs", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);

  await pane(page, 'open-now').locator('[data-band-id]').first().hover();
  await pane(page, 'open-now')
    .getByRole('button', { name: 'More actions: Temples' })
    .click();
  expect((await menuKeys(page))[0]).toBe('copy');
  const { plain, anchors } = await copyAndPaste(page, '2 links copied.');

  expect(plain).toBe(
    [
      'Temples',
      '2 Tabs',
      '',
      '- Fushimi Inari hours',
      `  ${standIn('Fushimi Inari hours')}`,
      '- Kinkaku-ji tickets',
      `  ${standIn('Kinkaku-ji tickets')}`,
    ].join('\n')
  );
  expect(anchors.map(([title]) => title)).toEqual([
    'Fushimi Inari hours',
    'Kinkaku-ji tickets',
  ]);
});

test('This window has a ⋮, and Copy all links leads it', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);

  await liveBlock(page, 0).locator('[data-window-row]').first().hover();
  await liveBlock(page, 0)
    .getByRole('button', { name: 'More actions: Window 1' })
    .click();

  expect((await menuKeys(page))[0]).toBe('copy');
});

test("Open now's header right-click: Copy all links after the two saves pastes every open window", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);

  await page
    .locator('[data-open-now-header]')
    .getByRole('heading', { name: 'Currently open' })
    .click({ button: 'right' });
  expect(await menuKeys(page)).toEqual([
    'save-all-windows',
    'save-current-window',
    'copy',
    'export-open-windows',
  ]);
  const { plain } = await copyAndPaste(page, /links copied\./);

  // The session copy's shape: a counts line, then a WINDOW line per window.
  const lines = plain.split('\n');
  expect(lines[1]).toMatch(/^2 Windows · \d+ Tabs$/);
  expect(lines).toContain('WINDOW 2 (4 Tabs)');
  expect(lines).toContain('  Temples (2 Tabs)');
});

// KAN-792. The same copy as an icon, after the two saves and before Save as PDF.
test("Open now's header Copy all links icon pastes what its right-click item pastes", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);
  const header = page.locator('[data-open-now-header]');
  const labels = await header
    .getByRole('button')
    .evaluateAll((all) => all.map((b) => b.getAttribute('aria-label')));
  const at = labels.indexOf('Copy all links');
  expect(labels.slice(at - 1, at + 2)).toEqual([
    'Save current window as a session',
    'Copy all links',
    'Save open windows as PDF…',
  ]);

  const fromIcon = await copyAndPaste(
    page,
    /links copied\./,
    header.getByRole('button', { name: 'Copy all links' })
  );
  await header
    .getByRole('heading', { name: 'Currently open' })
    .click({ button: 'right' });
  const fromMenu = await copyAndPaste(page, /links copied\./);

  expect(fromIcon.plain.split('\n')[1]).toMatch(/^2 Windows · \d+ Tabs$/);
  expect(fromIcon).toEqual(fromMenu);
});

test("a saved window's ⋮ leads with Copy all links and pastes the window under its name", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);
  const row = pane(page, 'detail').locator('[data-drag-row-id="w1"]');

  await row.locator('[data-window-drag-handle]').hover();
  await row
    .locator('[aria-label="More actions"][aria-haspopup="menu"]')
    .first()
    .click();
  expect((await menuKeys(page))[0]).toBe('copy');
  const { plain } = await copyAndPaste(page, '4 links copied.');

  expect(plain).toBe(
    [
      'Hotels',
      '4 Tabs',
      '',
      '- Ryokan near Gion',
      '  https://ryokan.example/gion',
      '- Kyoto bus pass',
      '  https://bus.example/pass',
      '',
      'Food (2 Tabs)',
      '  - Nishiki Market stalls',
      '    https://nishiki.example/',
      '  - Best ramen in Kyoto',
      '    https://ramen.example/kyoto',
    ].join('\n')
  );
});

test("a saved group's ⋮ leads with Copy all links and pastes only the group", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);
  const band = pane(page, 'detail').locator('[data-band-id="g1"]');

  await band.locator('[data-group-drag-handle]').hover();
  await band
    .locator('[aria-label="More actions"][aria-haspopup="menu"]')
    .first()
    .click();
  expect((await menuKeys(page))[0]).toBe('copy');
  const { plain } = await copyAndPaste(page, '2 links copied.');

  expect(plain).toBe(
    [
      'Food',
      '2 Tabs',
      '',
      '- Nishiki Market stalls',
      '  https://nishiki.example/',
      '- Best ramen in Kyoto',
      '  https://ramen.example/kyoto',
    ].join('\n')
  );
});

// O14e. A held search hides tabs; a copy would carry them unseen.
test("while Open now's search holds text, the header has no Copy all links, icon or item (KAN-792)", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await openTabView(page, extensionId);
  const heading = page
    .locator('[data-open-now-header]')
    .getByRole('heading', { name: 'Currently open' });

  const icon = page
    .locator('[data-open-now-header]')
    .getByRole('button', { name: 'Copy all links' });

  // CONTROL: offered before the search.
  await expect(icon).toBeVisible();
  await heading.click({ button: 'right' });
  expect(await menuKeys(page)).toContain('copy');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await pane(page, 'open-now')
    .getByRole('textbox', { name: 'Search open tabs' })
    .fill('inari');
  await expect(
    pane(page, 'open-now').getByText('Kyoto weather')
  ).not.toBeVisible();
  await expect(icon).toHaveCount(0);
  await heading.click({ button: 'right' });

  expect(await menuKeys(page)).toEqual([
    'save-all-windows',
    'save-current-window',
    'export-open-windows',
  ]);
});
