import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { localeStrings, shippedLanguages } from './fixtures/locales';
import { sessionHeaderMenu } from './fixtures/menus';
import {
  VIEWS,
  boxOf,
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';

// KAN-775 on the real artifact: an unselected session row's right-click leads with Open · Switch · Replace and offers Add current window.

const SESSIONS = [
  session('S1', 'Trip', [savedWindow('w1', 'Reading', 2)]),
  session('S2', 'Bravo', [savedWindow('x2', 'Notes', 1)]),
];

const rowMenu = (page: Page): Locator =>
  page.locator('[role="menu"][data-row-menu]');
const actionRow = (page: Page): Locator =>
  rowMenu(page).locator('[data-menu-action-row]');
const sessionRow = (page: Page, id: string): Locator =>
  page.locator(
    `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-drag-handle-row]`
  );
const shownSession = (page: Page, title: string): Locator =>
  page
    .locator('[data-pane="detail"]')
    .getByRole('button', { name: `Rename session: ${title}`, exact: true });
const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');
const chip = (page: Page): Locator => page.locator('[data-tooltip-chip]');

// A point on a row's title, clear of the strip at its right end.
async function rightClickTitle(page: Page, row: Locator): Promise<void> {
  const box = await boxOf(row);
  await page.mouse.click(
    Math.round(box.x + 60),
    Math.round(box.y + box.height / 2),
    { button: 'right' }
  );
}

const names = (items: Locator): Promise<string[]> =>
  items.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '')
  );

for (const view of VIEWS) {
  // KAN-793. The selected row's menu is the same as any other's.
  test(`${view}: every row's menu opens with the action row, then Add current window`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, view, {
      sessions: SESSIONS,
    });

    await rightClickTitle(page, sessionRow(page, 'S2'));
    // Switch is popup only, as the row's own button.
    await expect
      .poll(() => names(actionRow(page).getByRole('menuitem')))
      .toEqual(
        view === 'popup' ? ['Open', 'Switch', 'Replace'] : ['Open', 'Replace']
      );
    await expect(rowMenu(page).locator(':scope > [data-menu-item]')).toHaveText(
      [
        /Add current window to this session$/,
        /Copy all links$/,
        /Rename session$/,
        /Save as PDF…$/,
        /Delete session/,
      ]
    );

    await page.keyboard.press('Escape');
    await expect(rowMenu(page)).toHaveCount(0);
    await rightClickTitle(page, sessionRow(page, 'S1'));
    await expect(rowMenu(page)).toBeVisible();
    await expect
      .poll(() => names(actionRow(page).getByRole('menuitem')))
      .toEqual(
        view === 'popup' ? ['Open', 'Switch', 'Replace'] : ['Open', 'Replace']
      );
    await expect(
      rowMenu(page).locator(':scope > [data-menu-item]').first()
    ).toHaveText(/Add current window to this session$/);
  });

  test(`${view}: Add current window from an unselected row shows that session, adds the window, and says so`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, view, {
      sessions: SESSIONS,
    });
    await expect(shownSession(page, 'Trip')).toBeVisible();

    await rightClickTitle(page, sessionRow(page, 'S2'));
    await rowMenu(page)
      .getByRole('menuitem', {
        name: 'Add current window to this session',
        exact: true,
      })
      .click();

    await expect
      .poll(
        async () =>
          (await stored(page)).tabGroups.find((g) => g.tabGroupId === 'S2')
            ?.windows.length
      )
      .toBe(2);
    await expect(shownSession(page, 'Bravo')).toBeVisible();
    expect((await stored(page)).selectedTabGroupId).toBe('S2');
    await expect(toasts(page)).toContainText(
      'Current window added to this session.'
    );
    expect(
      (await stored(page)).tabGroups.find((g) => g.tabGroupId === 'S1')?.windows
        .length
    ).toBe(1);
  });
}

test('popup: a row button shows its long label below it, and lines up with the list’s icon column', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await waitForFontsLoaded(page, ['Material Symbols Outlined']);
  await rightClickTitle(page, sessionRow(page, 'S2'));

  const replace = actionRow(page).getByRole('menuitem', {
    name: 'Replace',
    exact: true,
  });
  await expect(replace).toHaveAccessibleDescription(
    'Replace this session with open windows'
  );
  await replace.hover();
  await expect(chip(page)).toHaveText('Replace this session with open windows');
  const button = await boxOf(replace);
  const tip = await boxOf(chip(page));
  expect(tip.y).toBeGreaterThanOrEqual(button.y + button.height);

  // The first row glyph and the list's glyphs share one column.
  const glyphLeft = (item: Locator) =>
    item
      .locator('.overflow-menu-glyph')
      .evaluate((el) => el.getBoundingClientRect().left);
  const rowLeft = await glyphLeft(
    actionRow(page).getByRole('menuitem').first()
  );
  const listLeft = await glyphLeft(
    rowMenu(page).locator(':scope > [data-menu-item]').first()
  );
  expect(Math.abs(rowLeft - listLeft)).toBeLessThanOrEqual(0.5);
});

// KAN-775 r7. Every fill, row and list, sits the same 4px inside the menu's border: the row menu and the header ⋮ alike.
const INSET_PX = 4;

async function insets(menu: Locator) {
  return menu.evaluate((el) => {
    const m = el.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(el).borderTopWidth);
    const fills = [...el.querySelectorAll<HTMLElement>('[data-menu-item]')].map(
      (item) => item.getBoundingClientRect()
    );
    const rowItems = [
      ...el.querySelectorAll<HTMLElement>('[data-menu-action-row] > *'),
    ].map((item) => item.getBoundingClientRect());
    const list = [
      ...el.querySelectorAll<HTMLElement>(':scope > [data-menu-item]'),
    ].map((item) => item.getBoundingClientRect());
    return {
      top: Math.min(...fills.map((f) => f.top)) - m.top - border,
      bottom: m.bottom - Math.max(...fills.map((f) => f.bottom)) - border,
      left: Math.min(...fills.map((f) => f.left)) - m.left - border,
      listRight: list.map((f) => m.right - f.right - border),
      listLeft: list.map((f) => f.left - m.left - border),
      rowCount: rowItems.length,
    };
  });
}

for (const where of ['an unselected row', 'the header ⋮'] as const) {
  test(`popup: every fill sits ${INSET_PX}px inside the menu's border (${where})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    let menu: Locator;
    if (where === 'the header ⋮') {
      await sessionHeaderMenu(page).click();
      menu = page.getByRole('menu', { name: 'More actions' });
    } else {
      await rightClickTitle(page, sessionRow(page, 'S2'));
      menu = rowMenu(page);
    }
    await expect(menu).toBeVisible();

    const got = await insets(menu);
    // PREMISE: the row menu has its action row; the header's has none.
    expect(got.rowCount).toBe(where === 'the header ⋮' ? 0 : 3);
    expect(got.top).toBeCloseTo(INSET_PX, 0);
    expect(got.bottom).toBeCloseTo(INSET_PX, 0);
    expect(got.left).toBeCloseTo(INSET_PX, 0);
    for (const v of [...got.listLeft, ...got.listRight]) {
      expect(v).toBeCloseTo(INSET_PX, 0);
    }
  });
}

// KAN-775 r8. The row's buttons stand 8px taller than a list item, so the row reads as a toolbar; the list keeps every menu's item height.
test('popup: row buttons are 42px tall; list items stay 34px', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await rightClickTitle(page, sessionRow(page, 'S2'));
  const heights = (items: Locator) =>
    items.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height))
    );

  expect(await heights(actionRow(page).getByRole('menuitem'))).toEqual([
    42, 42, 42,
  ]);
  expect(
    new Set(await heights(rowMenu(page).locator(':scope > [data-menu-item]')))
  ).toEqual(new Set([34]));
});

test('popup: a row button takes the list items’ hover and press fills', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  // Each fill lands at once, so a read never catches a colour mid-transition.
  await page.addStyleTag({
    content: '[role="menu"] * { transition: none !important; }',
  });
  await rightClickTitle(page, sessionRow(page, 'S2'));
  const fill = (item: Locator) =>
    item.evaluate((el) => getComputedStyle(el).backgroundColor);
  const open = actionRow(page).getByRole('menuitem', {
    name: 'Open',
    exact: true,
  });
  const copy = rowMenu(page).locator('[data-menu-item="copy"]');

  // Hover, then press; the press is let go off the item, so nothing runs.
  const touched = async (item: Locator) => {
    const rest = await fill(item);
    await item.hover();
    await expect.poll(() => fill(item)).not.toBe(rest);
    const hover = await fill(item);
    await page.mouse.down();
    await expect.poll(() => fill(item)).not.toBe(hover);
    const press = await fill(item);
    await page.mouse.move(1, 1);
    await page.mouse.up();
    return { hover, press };
  };
  const list = await touched(copy);
  // PREMISE: the press is a fill of its own.
  expect(list.press).not.toBe(list.hover);
  await rightClickTitle(page, sessionRow(page, 'S2'));
  expect(await touched(open)).toEqual(list);
});

test('popup: Open from the row acts on that session; the selection stays', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const before = context.pages().length;
  await rightClickTitle(page, sessionRow(page, 'S2'));
  await actionRow(page)
    .getByRole('menuitem', { name: 'Open', exact: true })
    .click();

  // S2's one saved tab opens in a new window.
  await expect.poll(() => context.pages().length).toBe(before + 1);
  expect((await stored(page)).selectedTabGroupId).toBe('S1');
  await expect(shownSession(page, 'Trip')).toBeVisible();
});

for (const language of shippedLanguages()) {
  test(`${language}: the action row fits on one line inside the menu`, async ({
    context,
    extensionId,
  }) => {
    const strings = localeStrings(language);
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
      settings: { language },
    });
    await waitForFontsLoaded(page, ['Material Symbols Outlined']);
    await rightClickTitle(page, sessionRow(page, 'S2'));

    const buttons = actionRow(page).getByRole('menuitem');
    // CONTROL: the page runs in this language.
    await expect
      .poll(() => names(buttons))
      .toEqual([strings.Open, strings.Switch, strings.Replace]);
    const fit = await actionRow(page).evaluate((row) => {
      const rect = row.getBoundingClientRect();
      const kids = [...row.children].map((el) => el.getBoundingClientRect());
      return {
        overflows: row.scrollWidth > row.clientWidth,
        oneLine: kids.every((k) => Math.abs(k.top - kids[0].top) < 0.5),
        inside: kids.every((k) => k.right <= rect.right + 0.5),
        // Each label on one line: a button no taller than the first's.
        heights: kids.map((k) => Math.round(k.height)),
      };
    });
    expect(fit.overflows).toBe(false);
    expect(fit.oneLine).toBe(true);
    expect(fit.inside).toBe(true);
    expect(new Set(fit.heights).size).toBe(1);
    const menu = await boxOf(rowMenu(page));
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error('no viewport');
    expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
  });
}
