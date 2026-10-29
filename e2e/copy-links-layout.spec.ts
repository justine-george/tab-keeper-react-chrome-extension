import type { Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { sessionHeaderMenu } from './fixtures/menus';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-859. Every Copy links button follows Settings › Sessions › Copy links:
// Links only (the default) pastes one "URL | Title" line per tab, nothing
// else; With headings pastes the layout copy-all-links-menus.spec.ts pins.
// Read back off the real clipboard by pasting, as the other copy specs do.

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

// Hotels: two loose tabs, then Food. Day trips: a web tab and a chrome:// tab.
const SAVED = buildSession({
  tabGroupId: 'S1',
  title: 'Kyoto trip',
  windowCount: 2,
  tabCount: 6,
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
    {
      windowId: 'w2',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Day trips',
      tabs: [
        tab('t5', 'Nara deer park', 'https://nara.example/'),
        tab('t6', 'Extensions', 'chrome://extensions/'),
      ],
    },
  ],
});

const SAVED_LINES = [
  'https://ryokan.example/gion | Ryokan near Gion',
  'https://bus.example/pass | Kyoto bus pass',
  'https://nishiki.example/ | Nishiki Market stalls',
  'https://ramen.example/kyoto | Best ramen in Kyoto',
  'https://nara.example/ | Nara deer park',
  'chrome://extensions/ | Extensions',
];

// The live window: a loose tab, Temples (2), then a loose tab.
const OTHER = [
  'Flights SFO–KIX',
  'Fushimi Inari hours',
  'Kinkaku-ji tickets',
  'Kyoto weather',
];
const OTHER_LINES = OTHER.map((title) => `${standIn(title)} | ${title}`);

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

// Presses `copy`, waits for its toast, and pastes into a rich and a plain box.
async function copyAndPaste(
  page: Page,
  links: string | RegExp,
  copy = page.getByRole('menuitem', { name: 'Copy all links' })
) {
  // Barrier: a sentinel, replaced by the write. An earlier copy's toast may
  // still be up, so the toast alone cannot say this copy has landed.
  const readClipboard = () =>
    page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText('(not yet)'));
  await copy.click();
  await expect(page.getByText(links).last()).toBeVisible();
  await expect.poll(readClipboard).not.toBe('(not yet)');

  const target = await page.context().newPage();
  await target.goto(
    'data:text/html,<div id="rich" contenteditable="true"></div><textarea id="plain" rows="30" cols="80"></textarea>'
  );
  await target.locator('#rich').click();
  await target.keyboard.press(PASTE);
  const rich = await target.locator('#rich').evaluate((el) => ({
    anchors: [...el.querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]),
    items: el.querySelectorAll('li').length,
  }));
  await target.locator('#plain').click();
  await target.keyboard.press(PASTE);
  const plain = await target.locator('#plain').inputValue();
  await target.close();
  return { plain, rich };
}

// Opens a ⋮ whose trigger shows on hover: hover `handle`, then click `trigger`.
async function openMenu(handle: Locator, trigger: Locator) {
  await handle.hover();
  await trigger.click();
}

test.beforeEach(async ({ context, serviceWorker }) => {
  await stage(serviceWorker);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedSessions(context, {
    ...buildContainer([SAVED]),
    selectedTabGroupId: 'S1',
  });
});

test('a fresh install pastes links only from the session menu', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await context.newPage();
  await openTabView(page, extensionId);

  await sessionHeaderMenu(page).click();
  const { plain, rich } = await copyAndPaste(page, '6 links copied.');

  expect(plain).toBe(SAVED_LINES.join('\n'));
  // One link per web tab; the chrome:// tab stays text. No list, no headings.
  expect(rich.anchors).toEqual([
    ['Ryokan near Gion', 'https://ryokan.example/gion'],
    ['Kyoto bus pass', 'https://bus.example/pass'],
    ['Nishiki Market stalls', 'https://nishiki.example/'],
    ['Best ramen in Kyoto', 'https://ramen.example/kyoto'],
    ['Nara deer park', 'https://nara.example/'],
  ]);
  expect(rich.items).toBe(0);
});

test("with headings seeded, the session menu pastes today's layout", async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, {
    foldSavedSessionInTabView: false,
    copyLinksLayout: 'with-headings',
  });
  const page = await context.newPage();
  await openTabView(page, extensionId);

  await sessionHeaderMenu(page).click();
  const { plain, rich } = await copyAndPaste(page, '6 links copied.');

  expect(plain.startsWith('Kyoto trip\n')).toBe(true);
  expect(plain.split('\n')).toContain('WINDOW 1 · Hotels (4 Tabs)');
  expect(rich.items).toBeGreaterThan(0);
});

test('links only from each other button', async ({ context, extensionId }) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await context.newPage();
  await openTabView(page, extensionId);
  const linksOnly = (plain: string) => {
    const lines = plain.split('\n');
    // A tab titled by its own address (about:blank) is the bare URL.
    for (const line of lines) expect(line).toMatch(/^[a-z-]+:\S*(?: \| .+)?$/);
    return lines;
  };

  // Open now's header icon: every open window.
  const header = page.locator('[data-open-now-header]');
  const all = await copyAndPaste(
    page,
    /links copied\./,
    header.getByRole('button', { name: 'Copy all links' })
  );
  expect(linksOnly(all.plain)).toEqual(expect.arrayContaining(OTHER_LINES));

  // A live window's ⋮.
  await openMenu(
    liveBlock(page, 1).locator('[data-window-row]').first(),
    liveBlock(page, 1).getByRole('button', { name: 'More actions: Window 2' })
  );
  const live = await copyAndPaste(page, '4 links copied.');
  expect(linksOnly(live.plain)).toEqual(OTHER_LINES);

  // A live group's ⋮.
  await openMenu(
    pane(page, 'open-now').locator('[data-band-id]').first(),
    pane(page, 'open-now').getByRole('button', {
      name: 'More actions: Temples',
    })
  );
  const liveGroup = await copyAndPaste(page, '2 links copied.');
  expect(linksOnly(liveGroup.plain)).toEqual(OTHER_LINES.slice(1, 3));

  // A session row's right-click.
  await page
    .locator(
      '[data-pane="sessions"] [data-drag-row-id="S1"] [data-drag-handle-row]'
    )
    .click({ button: 'right' });
  const sessionRow = await copyAndPaste(page, '6 links copied.');
  expect(linksOnly(sessionRow.plain)).toEqual(SAVED_LINES);

  // A saved window's ⋮.
  const row = pane(page, 'detail').locator('[data-drag-row-id="w1"]');
  await openMenu(
    row.locator('[data-window-drag-handle]'),
    row.locator('[aria-label="More actions"][aria-haspopup="menu"]').first()
  );
  const savedWindow = await copyAndPaste(page, '4 links copied.');
  expect(linksOnly(savedWindow.plain)).toEqual(SAVED_LINES.slice(0, 4));

  // A saved group's ⋮.
  const band = pane(page, 'detail').locator('[data-band-id="g1"]');
  await openMenu(
    band.locator('[data-group-drag-handle]'),
    band.locator('[aria-label="More actions"][aria-haspopup="menu"]').first()
  );
  const group = await copyAndPaste(page, '2 links copied.');
  expect(linksOnly(group.plain)).toEqual(SAVED_LINES.slice(2, 4));
});

test('the export page follows the setting and pastes its edits', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, {});
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/export.html?session=S1`);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page
    .getByRole('textbox', { name: 'Rename tab: Kyoto bus pass' })
    .fill('Bus pass');
  await page.getByRole('button', { name: 'Done' }).click();

  const { plain } = await copyAndPaste(
    page,
    '6 links copied.',
    page.getByRole('button', { name: 'Copy all links' })
  );
  expect(plain).toBe(
    SAVED_LINES.map((line) =>
      line === 'https://bus.example/pass | Kyoto bus pass'
        ? 'https://bus.example/pass | Bus pass'
        : line
    ).join('\n')
  );
});

test('changing the setting in Settings › Sessions changes the next copy', async ({
  context,
  extensionId,
}) => {
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await context.newPage();
  await openTabView(page, extensionId);

  // CONTROL: Links only before the change.
  await sessionHeaderMenu(page).click();
  const before = await copyAndPaste(page, '6 links copied.');
  expect(before.plain).toBe(SAVED_LINES.join('\n'));

  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sessions"]').click();
  const pair = page.getByRole('group', { name: 'Copy links' });
  await pair.getByRole('button', { name: 'With headings' }).click();
  await expect(
    pair.getByRole('button', { name: 'With headings' })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Go back' }).click();

  await sessionHeaderMenu(page).click();
  const after = await copyAndPaste(page, /6 links copied\./);
  expect(after.plain.startsWith('Kyoto trip\n')).toBe(true);
  expect(after.plain.split('\n')).toContain('WINDOW 1 · Hotels (4 Tabs)');
});
