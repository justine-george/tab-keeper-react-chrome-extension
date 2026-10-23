import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import { localeStrings } from './fixtures/locales';
import { sessionHeaderMenu } from './fixtures/menus';
import { pixelsAt } from './fixtures/pixels';
import {
  POPUP,
  VIEWS,
  boxOf,
  detailPane,
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';
import { VIEWPORT_GUTTER_PX } from '../src/components/common/rowMenu/placeMenu';
import type { tabContainerData } from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-708 on the real artifact: a right-click on a row opens that row's ⋮ items at the pointer.

const TRIP = session('S1', 'Trip', [savedWindow('w1', 'Reading', 2)]);
const OTHERS = ['Bravo', 'Charlie', 'Delta'].map((title, i) =>
  session(`S${i + 2}`, title, [savedWindow(`x${i + 2}`, 'Notes', 1)])
);
const SESSIONS = [TRIP, ...OTHERS];

const rowMenu = (page: Page): Locator =>
  page.locator('[role="menu"][data-row-menu]');
const item = (page: Page, name: string): Locator =>
  rowMenu(page).getByRole('menuitem', { name, exact: true });
// The element carrying a session row's handlers and its held look.
const sessionRow = (page: Page, id: string): Locator =>
  page.locator(
    `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-drag-handle-row]`
  );
const tabRow = (page: Page, tabId: string): Locator =>
  page.locator(`[data-pane="detail"] [data-drag-row-id="${tabId}"]`);
const shownSession = (page: Page, title: string): Locator =>
  page
    .locator('[data-pane="detail"]')
    .getByRole('button', { name: `Rename session: ${title}`, exact: true });
const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const ids = async (page: Page) =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);

// Every contextmenu event from document start, so a spec can read whether Chrome's menu was suppressed.
async function watchContextMenus(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const seen: MouseEvent[] = [];
    Object.defineProperty(globalThis, '__contextMenus', { value: seen });
    window.addEventListener('contextmenu', (event) => seen.push(event), true);
  });
}

const contextMenusPrevented = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__contextMenus');
    if (!Array.isArray(seen)) throw new Error('no contextmenu watch here');
    return seen.map((event: unknown) =>
      event instanceof MouseEvent ? event.defaultPrevented : false
    );
  });

// A point on a row's title, clear of the strip at its right end.
async function onTitle(row: Locator): Promise<{ x: number; y: number }> {
  const box = await boxOf(row);
  return { x: Math.round(box.x + 60), y: Math.round(box.y + box.height / 2) };
}

async function rightClickAt(page: Page, at: { x: number; y: number }) {
  await page.mouse.click(at.x, at.y, { button: 'right' });
}

// The open menu's items, by exact accessible name, in order.
async function expectItems(page: Page, names: string[]): Promise<void> {
  const items = rowMenu(page).getByRole('menuitem');
  await expect(items).toHaveCount(names.length);
  for (const [i, name] of names.entries()) {
    await expect(items.nth(i)).toHaveAccessibleName(name);
  }
}

for (const view of VIEWS) {
  test(`${view}: right-clicking a session that is not selected opens its menu at the pointer; the right pane still shows S1`, async ({
    context,
    extensionId,
  }) => {
    await watchContextMenus(context);
    const page = await openSaved(context, extensionId, view, {
      sessions: SESSIONS,
    });
    await expect(shownSession(page, 'Trip')).toBeVisible();
    const at = await onTitle(sessionRow(page, 'S2'));

    await rightClickAt(page, at);

    const menu = rowMenu(page);
    await expect(menu).toHaveAccessibleName('More actions: Bravo');
    const box = await boxOf(menu);
    expect(Math.abs(box.x - at.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - at.y)).toBeLessThanOrEqual(1);
    await expectItems(page, [
      'Copy all links',
      'Save as PDF…',
      'Delete session',
    ]);
    // Chrome's menu did not open on top of ours.
    expect(await contextMenusPrevented(page)).toEqual([true]);
    await expect(sessionRow(page, 'S2')).toHaveAttribute(
      'data-row-menu-held',
      ''
    );
    await expect(shownSession(page, 'Trip')).toBeVisible();
    expect((await stored(page)).selectedTabGroupId).toBe('S1');
  });
}

test('Delete from that menu removes S2; Undo brings it back; S1 stays selected throughout', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await rightClickAt(page, await onTitle(sessionRow(page, 'S2')));

  await item(page, 'Delete session').click();

  await expect.poll(() => ids(page)).toEqual(['S1', 'S3', 'S4']);
  await expect(rowMenu(page)).toHaveCount(0);
  await expect(toasts(page)).toContainText('Session deleted.');
  expect((await stored(page)).selectedTabGroupId).toBe('S1');
  await expect(shownSession(page, 'Trip')).toBeVisible();

  await page
    .getByRole('status')
    .getByRole('button', { name: 'Undo', exact: true })
    .click();

  await expect.poll(() => ids(page)).toEqual(['S1', 'S2', 'S3', 'S4']);
  expect((await stored(page)).selectedTabGroupId).toBe('S1');
  await expect(shownSession(page, 'Trip')).toBeVisible();
});

// A window long enough to reach the pane's bottom, so a row sits near the popup's bottom-right corner.
const LONG = session('S1', 'Trip', [savedWindow('w1', 'Reading', 16)]);

for (const language of ['en', 'ru'] as const) {
  test(`${language}: near the right and bottom edges the menu flips and stays inside the popup`, async ({
    context,
    extensionId,
  }) => {
    const strings = localeStrings(language);
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [LONG],
      settings: { language },
    });
    // The lowest tab row wholly inside the pane.
    const pane = await detailPane(page);
    const tabIds = LONG.windows[0].tabs.map((t) => t.tabId);
    let lowest: { x: number; y: number; width: number; height: number } | null =
      null;
    for (const tabId of tabIds) {
      const b = await boxOf(tabRow(page, tabId));
      if (b.y + b.height <= pane.bottom) lowest = b;
    }
    if (lowest === null) throw new Error('no tab row inside the pane');
    // Its right end, inside the pane's border.
    const at = {
      x: Math.round(lowest.x + lowest.width - 4),
      y: Math.round(lowest.y + lowest.height - 4),
    };

    await rightClickAt(page, at);

    const menu = rowMenu(page);
    // CONTROL: the page runs in this language.
    await expect(
      menu.getByRole('menuitem', { name: strings['Copy link'], exact: true })
    ).toBeVisible();
    const box = await boxOf(menu);
    const gutter = VIEWPORT_GUTTER_PX;
    // PREMISE: it fits neither to the right nor below the pointer.
    expect(at.x + box.width).toBeGreaterThan(POPUP.width - gutter);
    expect(at.y + box.height).toBeGreaterThan(POPUP.height - gutter);
    // Flipped both ways: its right and bottom edges at the pointer.
    expect(Math.abs(box.x + box.width - at.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - at.y)).toBeLessThanOrEqual(1);
    // Inside the gutter on every side.
    expect(box.x).toBeGreaterThanOrEqual(gutter);
    expect(box.y).toBeGreaterThanOrEqual(gutter);
    expect(box.x + box.width).toBeLessThanOrEqual(POPUP.width - gutter);
    expect(box.y + box.height).toBeLessThanOrEqual(POPUP.height - gutter);
  });
}

// Enough sessions that the list scrolls; S1's one short window leaves the detail pane mostly empty.
const MANY: tabContainerData[] = [
  TRIP,
  ...Array.from({ length: 13 }, (_, i) =>
    session(`S${i + 2}`, `Session ${i + 2}`, [
      savedWindow(`m${i + 2}`, 'Notes', 1),
    ])
  ),
];

test('a right press on another row while a menu is open swaps menus; a press outside, Esc and a scroll close it', async ({
  context,
  extensionId,
}) => {
  await watchEscapes(context);
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: MANY,
  });
  const menu = rowMenu(page);

  // Swap: one press, the other row's menu. S2 is above S3, clear of S3's menu, which opens downwards.
  await rightClickAt(page, await onTitle(sessionRow(page, 'S3')));
  await expect(menu).toHaveAccessibleName('More actions: Session 3');
  const second = await onTitle(sessionRow(page, 'S2'));
  await rightClickAt(page, second);
  await expect(menu).toHaveCount(1);
  await expect(menu).toHaveAccessibleName('More actions: Session 2');
  const box = await boxOf(menu);
  expect(Math.abs(box.x - second.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - second.y)).toBeLessThanOrEqual(1);
  await expect(sessionRow(page, 'S3')).not.toHaveAttribute(
    'data-row-menu-held'
  );
  await expect(sessionRow(page, 'S2')).toHaveAttribute(
    'data-row-menu-held',
    ''
  );

  // Pick 3 holds for an open ⋮ too: the right press closes it and opens the row's.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await sessionHeaderMenu(page).click();
  // The header ⋮'s own menu, drawn inside its anchor, not portalled.
  const headerMenu = page.locator(
    '[data-tour-anchor="session-menu"] [role="menu"]'
  );
  await expect(headerMenu).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(1);
  await rightClickAt(page, await onTitle(sessionRow(page, 'S4')));
  await expect(headerMenu).toHaveCount(0);
  await expect(menu).toHaveCount(1);
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(menu).toHaveAccessibleName('More actions: Session 4');

  // A press outside: empty space below S1's window in the detail pane.
  const pane = await boxOf(page.locator('[data-pane="detail"]'));
  const outside = {
    x: Math.round(pane.x + pane.width / 2),
    y: Math.round(pane.y + pane.height - 20),
  };
  // PREMISE: that point is nothing a press would act on.
  expect(
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return (
        el !== null &&
        el.closest(
          'button, [role="button"], [role="menu"], [data-drag-handle-row], input'
        ) === null
      );
    }, outside)
  ).toBe(true);
  await page.mouse.click(outside.x, outside.y);
  await expect(menu).toHaveCount(0);
  expect((await stored(page)).selectedTabGroupId).toBe('S1');

  // Esc: closes the menu, and is prevented so the real popup stays open (a tab here never closes on Esc).
  await rightClickAt(page, await onTitle(sessionRow(page, 'S2')));
  await expect(menu).toBeVisible();
  const escapesBefore = (await escapesPrevented(page)).length;
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect((await escapesPrevented(page)).slice(escapesBefore)).toEqual([true]);

  // A scroll of the session list.
  const list = page.locator('[data-pane="sessions"] [data-session-column]');
  const scroller = list.locator('xpath=..');
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
  // PREMISE: the list overflows and starts at the top.
  expect(
    await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)
  ).toBe(true);
  expect(await scrollTop()).toBe(0);
  await rightClickAt(page, await onTitle(sessionRow(page, 'S2')));
  await expect(menu).toBeVisible();
  const listBox = await boxOf(scroller);
  await page.mouse.move(listBox.x + 20, listBox.y + listBox.height - 20);
  await page.mouse.wheel(0, 120);
  await expect.poll(scrollTop).toBeGreaterThan(0);
  await expect(menu).toHaveCount(0);
});

test('the held row keeps its hover fill while the pointer is on the menu', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  // A point in the row's left gutter: clear of its title, its drag dots and its strip.
  const gutterOf = async (id: string): Promise<[number, number]> => {
    const b = await boxOf(sessionRow(page, id));
    return [b.x + 4, b.y + b.height / 2];
  };
  const s2 = await gutterOf('S2');
  const s3 = await gutterOf('S3');
  const paintAt = async (point: [number, number]) =>
    (await pixelsAt(page, [point]))[0];

  const rest = await paintAt(s2);
  await sessionRow(page, 'S2').hover();
  // CONTROL: hovering fills the row, so the two are told apart.
  await expect.poll(() => paintAt(s2)).not.toBe(rest);
  const hovered = await paintAt(s2);

  await rightClickAt(page, await onTitle(sessionRow(page, 'S2')));
  const onMenu = item(page, 'Save as PDF…');
  await onMenu.hover();
  // PREMISE: the pointer is on the menu, off the row.
  expect(await onMenu.evaluate((el) => el.matches(':hover'))).toBe(true);
  expect(
    await sessionRow(page, 'S2').evaluate((el) => el.matches(':hover'))
  ).toBe(false);
  const [held, other] = await pixelsAt(page, [s2, s3]);
  expect(held).toBe(hovered);
  // CONTROL: a row that is neither hovered nor held keeps its rest fill.
  expect(other).toBe(rest);
});

test('a right press never starts a drag', async ({ context, extensionId }) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  // Every write of the drag marker on <html> from here on; it starts off, so any write turned it on.
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__dragMarks', { value: seen });
    new MutationObserver(() => seen.push('marked')).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ['data-dragging'] }
    );
  });
  const marks = () =>
    page.evaluate(() => {
      const seen: unknown = Reflect.get(globalThis, '__dragMarks');
      if (!Array.isArray(seen)) throw new Error('no drag watch here');
      return seen.length;
    });
  const before = await ids(page);
  const at = await onTitle(sessionRow(page, 'S2'));

  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(at.x, at.y + step * 10);
    expect(
      await page.evaluate(() =>
        document.documentElement.hasAttribute('data-dragging')
      )
    ).toBe(false);
  }
  await page.mouse.up({ button: 'right' });

  expect(await marks()).toBe(0);
  expect(await ids(page)).toEqual(before);
  expect((await stored(page)).selectedTabGroupId).toBe('S1');

  // CONTROL: the same press with the left button does start one, and the watch sees it.
  await page.keyboard.press('Escape');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(at.x, at.y + step * 10);
  }
  await expect.poll(marks).toBeGreaterThan(0);
  await page.mouse.up();
});

const SUSPENDED = session('S1', 'Trip', [
  {
    ...savedWindow('w1', 'Reading', 1),
    tabs: [
      {
        tabId: 'w1-t0',
        favicon: '',
        title: 'Kyoto bus map',
        url: 'chrome-extension://laameccjpleogmfhilmffpdbiibgbekf/suspended.html?title=Kyoto%20bus%20map&url=https%3A%2F%2Fbus.example%2Fkyoto%3Fline%3D5&time=1',
      },
    ],
  },
]);

test('Copy link on a saved tab puts the tidied address on the clipboard and toasts "1 link copied."', async ({
  context,
  extensionId,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [SUSPENDED],
  });
  await page.evaluate(() => navigator.clipboard.writeText('before'));

  await rightClickAt(page, await onTitle(tabRow(page, 'w1-t0')));
  await expectItems(page, ['Open in new tab', 'Copy link', 'Delete tab']);
  await item(page, 'Copy link').click();

  // Barrier: the toast shows after the write resolves.
  await expect(toasts(page)).toContainText('1 link copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'https://bus.example/kyoto?line=5'
  );
});

test("the rename field keeps Chrome's menu", async ({
  context,
  extensionId,
}) => {
  await watchContextMenus(context);
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const header = page.locator(
    '[data-pane="detail"] [data-drag-row-id="w1"] [data-window-drag-handle]'
  );
  await header
    .getByRole('button', { name: 'Rename window: Reading', exact: true })
    .click();
  const field = header.getByRole('textbox');
  await expect(field).toBeFocused();

  await field.click({ button: 'right' });

  await expect(page.locator('[data-row-menu]')).toHaveCount(0);
  expect(await contextMenusPrevented(page)).toEqual([false]);
  // The field is still open, with its text.
  await expect(field).toHaveValue('Reading');

  // CONTROL: the same press on a tab row of that window opens its menu, and suppresses Chrome's.
  await page.keyboard.press('Escape');
  await rightClickAt(page, await onTitle(tabRow(page, 'w1-t0')));
  await expect(rowMenu(page)).toBeVisible();
  expect(await contextMenusPrevented(page)).toEqual([false, true]);
});

// One Chrome window, unfocused so the tab view stays in front, with one data: tab per title.
async function openWindow(
  worker: Worker,
  titles: string[]
): Promise<{ windowId: number; tabIds: number[] }> {
  const made = await worker.evaluate(
    async (urls) => {
      const win = await chrome.windows.create({ focused: false, url: urls });
      const tabIds = (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
      if (win?.id === undefined || tabIds.length !== urls.length) return null;
      return { windowId: win.id, tabIds };
    },
    titles.map((title) => `data:text/html,<title>${title}</title>`)
  );
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  return made;
}

test('Open now tab: Switch to tab / Copy link / Close tab; Close tab closes that tab', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const made = await openWindow(serviceWorker, ['Kyoto', 'Osaka']);
  const block = page.locator(
    `[data-pane="open-now"] [data-open-window-id="${made.windowId}"]`
  );
  const row = block.getByRole('button', {
    name: 'Switch to tab: Osaka',
    exact: true,
  });
  await expect(row).toBeVisible();
  const titlesIn = () =>
    serviceWorker.evaluate(
      async (windowId) =>
        (await chrome.tabs.query({ windowId })).map((t) => t.title),
      made.windowId
    );
  // PREMISE: Chrome has both tabs.
  await expect.poll(titlesIn).toEqual(['Kyoto', 'Osaka']);

  await rightClickAt(page, await onTitle(row));

  const menu = rowMenu(page);
  await expect(menu).toHaveAccessibleName('Osaka');
  await expectItems(page, ['Switch to tab', 'Copy link', 'Close tab']);
  await item(page, 'Close tab').click();

  await expect.poll(titlesIn).toEqual(['Kyoto']);
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Tab closed.');
});

// KAN-708. The colour bar sits beside the group's header, so it answers for itself.
grantedTest(
  "right-clicking a saved group's colour bar opens its colour picker; Esc closes it",
  async ({ context, extensionId }) => {
    await watchContextMenus(context);
    const tabs = ['a', 'b'].map((id) => ({
      tabId: id,
      favicon: '',
      title: `Tab ${id}`,
      url: `https://${id}.test/`,
      chromeGroupId: 'g1',
    }));
    const session = buildSession({
      tabGroupId: 's1',
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
          chromeTabGroups: [
            { groupId: 'g1', title: 'Research', color: 'blue' },
          ],
        },
      ],
    });
    await seedSessions(context, {
      ...buildContainer([session]),
      selectedTabGroupId: 's1',
    });
    const page = await context.newPage();
    await page.setViewportSize(POPUP);
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const bar = page.getByRole('button', {
      name: 'Change group color: Research',
      exact: true,
    });
    await expect(bar).toBeVisible();

    await bar.click({ button: 'right' });

    const picker = page.getByRole('menu').filter({
      has: page.getByRole('menuitemradio', { name: 'Grey', exact: true }),
    });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('menuitemradio')).toHaveCount(9);
    await expect(page.locator('[data-row-menu]')).toHaveCount(0);
    expect(await contextMenusPrevented(page)).toEqual([true]);

    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  }
);

// KAN-708. Anything with a ⋮ answers a right-click with that ⋮'s items; the pane around the header keeps Chrome's menu.
test('right-clicking the session header opens its ⋮ items at the pointer', async ({
  context,
  extensionId,
}) => {
  await watchContextMenus(context);
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const title = shownSession(page, 'Trip');
  await expect(title).toBeVisible();

  // The header ⋮'s own items, read from its menu.
  await sessionHeaderMenu(page).click();
  const overflow = page
    .locator('[data-tour-anchor="session-menu"] [role="menu"]')
    .getByRole('menuitem');
  await expect(overflow.first()).toBeVisible();
  // Each item's accessible name, as the ARIA tree gives it (icon glyph text excluded).
  const expected: string[] = [];
  for (let i = 0; i < (await overflow.count()); i++) {
    expected.push(await overflow.nth(i).ariaSnapshot());
  }
  // PREMISE: the ⋮ has items to compare against.
  expect(expected.length).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(overflow).toHaveCount(0);

  const box = await boxOf(title);
  const at = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  await rightClickAt(page, at);

  const menu = rowMenu(page);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAccessibleName('More actions: Trip');
  const opened = rowMenu(page).getByRole('menuitem');
  await expect(opened).toHaveCount(expected.length);
  for (const [i, snapshot] of expected.entries()) {
    await expect(opened.nth(i)).toMatchAriaSnapshot(snapshot);
  }
  const placed = await boxOf(menu);
  expect(Math.abs(placed.x - at.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(placed.y - at.y)).toBeLessThanOrEqual(1);
  expect(await contextMenusPrevented(page)).toEqual([true]);
  expect((await stored(page)).selectedTabGroupId).toBe('S1');

  // Empty pane space below the header keeps Chrome's menu.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const pane = await boxOf(page.locator('[data-pane="detail"]'));
  const outside = {
    x: Math.round(pane.x + pane.width / 2),
    y: Math.round(pane.y + pane.height - 20),
  };
  // PREMISE: that point is nothing a press would act on.
  expect(
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return (
        el !== null &&
        el.closest(
          'button, [role="button"], [role="menu"], [data-drag-handle-row], input'
        ) === null
      );
    }, outside)
  ).toBe(true);
  await rightClickAt(page, outside);
  await expect(page.locator('[data-row-menu]')).toHaveCount(0);
  expect(await contextMenusPrevented(page)).toEqual([true, false]);
});
