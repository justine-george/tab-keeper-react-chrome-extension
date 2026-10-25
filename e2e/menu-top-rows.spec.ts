import type { Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { expectGlyph } from './fixtures/glyphInk';
import { localeStrings, shippedLanguages } from './fixtures/locales';
import {
  VIEWS,
  boxOf,
  groupedWindow,
  openSaved,
  session,
  stored,
} from './fixtures/savedWindows';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-793 on the real artifact: a row's right-click leads with that row's own buttons.

const SESSIONS = [
  session('S1', 'Trip', [
    groupedWindow('w1', 'Reading', [
      { groupId: 'g1', title: 'Food', color: 'orange' },
    ]),
  ]),
];

const rowMenu = (page: Page): Locator =>
  page.locator('[role="menu"][data-row-menu]');
const actionRow = (page: Page): Locator =>
  rowMenu(page).locator('[data-menu-action-row]');
const rowButton = (page: Page, name: string): Locator =>
  actionRow(page).getByRole('menuitem', { name, exact: true });
const windowTitle = (page: Page): Locator =>
  page.locator(
    '[data-pane="detail"] [data-drag-row-id="w1"] [data-window-drag-handle]'
  );
const groupTitle = (page: Page): Locator =>
  page.locator(
    '[data-pane="detail"] [data-band-id="g1"] [data-group-drag-handle]'
  );
const names = (items: Locator): Promise<string[]> =>
  items.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? '')
  );

// A point on a row's title, clear of the strip at its right end.
async function rightClickTitle(page: Page, row: Locator): Promise<void> {
  const box = await boxOf(row);
  await page.mouse.click(
    Math.round(box.x + 60),
    Math.round(box.y + box.height / 2),
    { button: 'right' }
  );
}

for (const view of VIEWS) {
  test(`${view}: a saved window's Rename opens its name field with the focus in it, and Enter keeps the name`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, view, {
      sessions: SESSIONS,
    });
    await rightClickTitle(page, windowTitle(page));
    await expect
      .poll(() => names(actionRow(page).getByRole('menuitem')))
      .toEqual(
        view === 'popup' ? ['Open', 'Add tab', 'Rename'] : ['Open', 'Rename']
      );
    await rowButton(page, 'Rename').click();

    await expect(rowMenu(page)).toHaveCount(0);
    const field = page.getByPlaceholder('Name this window');
    await expect(field).toBeFocused();
    // Seeded with the name, as the title's click seeds it.
    await expect(field).toHaveValue('Reading');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Ramen list');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await stored(page)).tabGroups[0].windows[0].title)
      .toBe('Ramen list');
  });
}

test("popup: a saved group's Open opens that group's tabs", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await rightClickTitle(page, groupTitle(page));
  await rowButton(page, 'Open').click();

  await expect
    .poll(() =>
      serviceWorker.evaluate(async () =>
        (await chrome.tabs.query({})).map((tab) => tab.pendingUrl ?? tab.url)
      )
    )
    .toEqual(
      expect.arrayContaining(['https://g1-0.test/', 'https://g1-1.test/'])
    );
});

test('popup: Shift+F10 on a saved window focuses Open first; ↓ moves into the list', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await page
    .getByRole('button', { name: 'Rename window: Reading', exact: true })
    .focus();
  await page.keyboard.press('Shift+F10');

  await expect(rowButton(page, 'Open')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(rowButton(page, 'Add tab')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    rowMenu(page).getByRole('menuitem', { name: 'Copy all links' })
  ).toBeFocused();
});

// Currently open: a second window with Temples (2 tabs), kept behind the tab view.
const LIVE = ['Flights SFO–KIX', 'Fushimi Inari hours', 'Kinkaku-ji tickets'];
async function stage(worker: Worker): Promise<number> {
  return worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const ids = win!.tabs!.map((t) => t.id!);
    const group = await chrome.tabs.group({
      tabIds: [ids[1], ids[2]],
      createProperties: { windowId: win!.id },
    });
    await chrome.tabGroups.update(group, { title: 'Temples', color: 'red' });
    return win!.id!;
  }, LIVE.map(standIn));
}

async function openTabView(page: Page, extensionId: string): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 820 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  for (const title of LIVE) {
    await expect(
      page.locator('[data-pane="open-now"]').getByText(title)
    ).toBeVisible();
  }
}

test('tab view: a live window’s Go to puts that window in front', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const windowId = await stage(serviceWorker);
  const page = await context.newPage();
  await openTabView(page, extensionId);
  const lastFocused = () =>
    serviceWorker.evaluate(
      async () => (await chrome.windows.getLastFocused()).id ?? null
    );
  // PREMISE: the tab view's window is in front.
  expect(await lastFocused()).not.toBe(windowId);

  await rightClickTitle(
    page,
    page
      .locator(`[data-open-window-id="${windowId}"] [data-window-row]`)
      .first()
  );
  await expect
    .poll(() => names(actionRow(page).getByRole('menuitem')))
    .toEqual(['Go to', 'Save']);
  await rowButton(page, 'Go to').click();

  await expect.poll(lastFocused).toBe(windowId);
});

test('tab view: a live group’s Save saves its two tabs as a session', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stage(serviceWorker);
  await seedSessions(context, buildContainer([]));
  const page = await context.newPage();
  await openTabView(page, extensionId);

  await rightClickTitle(
    page,
    page
      .locator('[data-pane="open-now"] [data-band-id] [data-group-drag-handle]')
      .first()
  );
  await expect
    .poll(() => names(actionRow(page).getByRole('menuitem')))
    .toEqual(['Go to', 'Save', 'Rename']);
  await rowButton(page, 'Save').click();

  await expect.poll(async () => (await stored(page)).tabGroups.length).toBe(1);
  const saved = (await stored(page)).tabGroups[0];
  expect(saved.windows.flatMap((w) => w.tabs.map((t) => t.title))).toEqual([
    'Fushimi Inari hours',
    'Kinkaku-ji tickets',
  ]);
});

// KAN-796. A group's Save is a group with the window saves' plus, on its strip and in its top row alike.
test('tab view: a live group’s Save draws group_add on its strip and in its right-click row', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stage(serviceWorker);
  const page = await context.newPage();
  await openTabView(page, extensionId);
  await waitForFontsLoaded(page, ['Material Symbols Outlined']);
  const title = page
    .locator('[data-pane="open-now"] [data-band-id] [data-group-drag-handle]')
    .first();

  // The strip shows under the pointer only.
  await title.hover();
  const stripSave = title.getByRole('button', {
    name: 'Save group as a session: Temples',
  });
  await expect(stripSave).toHaveCSS('opacity', '1');
  await expectGlyph(page, stripSave, 'group_add');

  await rightClickTitle(page, title);
  await expect
    .poll(() => names(actionRow(page).getByRole('menuitem')))
    .toEqual(['Go to', 'Save', 'Rename']);
  await expectGlyph(page, rowButton(page, 'Save'), 'group_add');
});

test('tab view: a live group’s Go to lands on its tab used last, with its window in front', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const windowId = await stage(serviceWorker);
  // In Chrome's order: Flights, then Temples (Inari, Kinkaku-ji), then Kyoto weather.
  const ids = await serviceWorker.evaluate(
    async (id) =>
      (await chrome.tabs.query({ windowId: id }))
        .sort((a, b) => a.index - b.index)
        .map((tab) => tab.id ?? -1),
    windowId
  );
  const [flights, , kinkaku] = ids;
  // Use the group's second tab, then leave the group, as a person would.
  for (const id of [kinkaku, flights]) {
    await serviceWorker.evaluate(async (tabId) => {
      await chrome.tabs.update(tabId, { active: true });
    }, id);
  }
  const page = await context.newPage();
  await openTabView(page, extensionId);
  const activeIn = () =>
    serviceWorker.evaluate(
      async (id) =>
        (await chrome.tabs.query({ windowId: id, active: true }))[0]?.id,
      windowId
    );
  const lastFocused = () =>
    serviceWorker.evaluate(
      async () => (await chrome.windows.getLastFocused()).id ?? null
    );
  // PREMISE: the group is not showing, and its window is behind the tab view.
  expect(await activeIn()).toBe(flights);
  expect(await lastFocused()).not.toBe(windowId);

  await rightClickTitle(
    page,
    page
      .locator('[data-pane="open-now"] [data-band-id] [data-group-drag-handle]')
      .first()
  );
  await rowButton(page, 'Go to').click();

  await expect.poll(activeIn).toBe(kinkaku);
  await expect.poll(lastFocused).toBe(windowId);
});

// Whether a top row sits on one line, inside its menu, with every button one line tall.
const rowFit = (page: Page) =>
  actionRow(page).evaluate((row) => {
    const rect = row.getBoundingClientRect();
    const kids = [...row.children].map((el) => el.getBoundingClientRect());
    return {
      overflows: row.scrollWidth > row.clientWidth,
      oneLine: kids.every((k) => Math.abs(k.top - kids[0].top) < 0.5),
      inside: kids.every((k) => k.right <= rect.right + 0.5),
      sameHeight: new Set(kids.map((k) => Math.round(k.height))).size === 1,
    };
  });
const FITS = {
  overflows: false,
  oneLine: true,
  inside: true,
  sameHeight: true,
};

// A live window's Go to · Save: es, fr, pt and sv spell Go to out in full.
for (const language of shippedLanguages()) {
  test(`${language}: a live window's top row fits on one line inside the tab view`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const strings = localeStrings(language);
    const windowId = await stage(serviceWorker);
    await seedSettings(context, { language });
    const page = await context.newPage();
    await openTabView(page, extensionId);
    await waitForFontsLoaded(page, ['Material Symbols Outlined']);
    await rightClickTitle(
      page,
      page
        .locator(`[data-open-window-id="${windowId}"] [data-window-row]`)
        .first()
    );

    // CONTROL: the page runs in this language.
    await expect
      .poll(() => names(actionRow(page).getByRole('menuitem')))
      .toEqual([strings.GoToWindowShort, strings.Save]);
    expect(await rowFit(page)).toEqual(FITS);
    const menu = await boxOf(rowMenu(page));
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error('no viewport');
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
  });
}

// The widest row: a saved window's three buttons, in the popup.
for (const language of shippedLanguages()) {
  test(`${language}: a saved window's top row fits on one line inside the popup`, async ({
    context,
    extensionId,
  }) => {
    const strings = localeStrings(language);
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
      settings: { language },
    });
    await waitForFontsLoaded(page, ['Material Symbols Outlined']);
    await rightClickTitle(page, windowTitle(page));

    // CONTROL: the page runs in this language.
    await expect
      .poll(() => names(actionRow(page).getByRole('menuitem')))
      .toEqual([strings.Open, strings['Add tab'], strings.Rename]);
    expect(await rowFit(page)).toEqual(FITS);
    const menu = await boxOf(rowMenu(page));
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error('no viewport');
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
  });
}
