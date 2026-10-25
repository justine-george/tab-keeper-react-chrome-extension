import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import {
  VIEWS,
  boxOf,
  openSaved,
  savedWindow,
  session,
  stored,
} from './fixtures/savedWindows';

// KAN-778 on the real artifact: a left press outside an open menu only closes it.

const SESSIONS = [
  session('S1', 'Trip', [savedWindow('w1', 'Reading', 2)]),
  ...['Bravo', 'Charlie', 'Delta'].map((title, i) =>
    session(`S${i + 2}`, title, [savedWindow(`x${i + 2}`, 'Notes', 1)])
  ),
];

const sessionRow = (page: Page, id: string): Locator =>
  page.locator(
    `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-drag-handle-row]`
  );
const shownSession = (page: Page, title: string): Locator =>
  page
    .locator('[data-pane="detail"]')
    .getByRole('button', { name: `Rename session: ${title}`, exact: true });
const foldButton = (page: Page, verb: 'Collapse' | 'Expand'): Locator =>
  page.getByRole('button', { name: `${verb}: Reading`, exact: true });

// A point on a row's title, clear of the strip at its right end.
async function onTitle(row: Locator): Promise<{ x: number; y: number }> {
  const box = await boxOf(row);
  return { x: Math.round(box.x + 60), y: Math.round(box.y + box.height / 2) };
}

async function centreOf(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await boxOf(loc);
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

// Two frames: long enough for a click's render, which lands in the same task.
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

const MENUS = {
  'header ⋮': {
    open: (page: Page) => sessionHeaderMenu(page).click(),
    menu: (page: Page) =>
      page.locator('[data-tour-anchor="session-menu"] [role="menu"]'),
  },
  'row menu': {
    open: async (page: Page) => {
      const at = await onTitle(sessionRow(page, 'S3'));
      await page.mouse.click(at.x, at.y, { button: 'right' });
    },
    menu: (page: Page) => page.locator('[role="menu"][data-row-menu]'),
  },
};

const TARGETS = {
  "Bravo's row": {
    element: (page: Page) => sessionRow(page, 'S2'),
    point: (page: Page) => onTitle(sessionRow(page, 'S2')),
    idle: (page: Page) => shownSession(page, 'Trip'),
    acted: (page: Page) => shownSession(page, 'Bravo'),
  },
  "a window's fold chevron": {
    element: (page: Page) => foldButton(page, 'Collapse'),
    point: (page: Page) => centreOf(foldButton(page, 'Collapse')),
    idle: (page: Page) => foldButton(page, 'Collapse'),
    acted: (page: Page) => foldButton(page, 'Expand'),
  },
};

for (const view of VIEWS) {
  for (const [targetName, target] of Object.entries(TARGETS)) {
    test(`${view}, no menu (control): a click on ${targetName} runs it`, async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, view, {
        sessions: SESSIONS,
      });
      await expect(target.idle(page)).toBeVisible();
      const at = await target.point(page);

      await page.mouse.click(at.x, at.y);

      await expect(target.acted(page)).toBeVisible();
    });

    for (const [menuName, menu] of Object.entries(MENUS)) {
      test(`${view}, ${menuName} open: a click on ${targetName} only closes the menu; the next click runs it`, async ({
        context,
        extensionId,
      }) => {
        const page = await openSaved(context, extensionId, view, {
          sessions: SESSIONS,
        });
        await menu.open(page);
        await expect(menu.menu(page)).toBeVisible();
        const at = await target.point(page);
        // PREMISE: the point is on the target, not on the menu.
        const element = await target.element(page).elementHandle();
        expect(
          await page.evaluate(
            ({ x, y, el }) => {
              const hit = document.elementFromPoint(x, y);
              return (
                hit !== null &&
                el !== null &&
                el.contains(hit) &&
                hit.closest('[role="menu"]') === null
              );
            },
            { ...at, el: element }
          )
        ).toBe(true);

        await page.mouse.click(at.x, at.y);

        await expect(menu.menu(page)).toHaveCount(0);
        await settle(page);
        await expect(target.idle(page)).toBeVisible();
        await expect(target.acted(page)).toHaveCount(0);
        expect((await stored(page)).selectedTabGroupId).toBe('S1');
        // Nor did the press move focus onto it.
        expect(
          await page.evaluate(
            (el) => el !== null && el.contains(document.activeElement),
            element
          )
        ).toBe(false);

        // The next click is the user's own.
        await page.mouse.click(at.x, at.y);
        await expect(target.acted(page)).toBeVisible();
      });
    }
  }
}

// Every write of the drag marker on <html> from here on; it starts off, so any write turned it on.
async function watchDragMarks(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__dragMarks', { value: seen });
    new MutationObserver(() => seen.push('marked')).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ['data-dragging'] }
    );
  });
  return () =>
    page.evaluate(() => {
      const seen: unknown = Reflect.get(globalThis, '__dragMarks');
      if (!Array.isArray(seen)) throw new Error('no drag watch here');
      return seen.length;
    });
}

async function pressAndMove(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(at.x, at.y + step * 10);
  }
}

const sessionIds = async (page: Page) =>
  (await stored(page)).tabGroups.map((g) => g.tabGroupId);

for (const [menuName, menu] of Object.entries(MENUS)) {
  test(`${menuName} open: a press that moves on Bravo's row starts no drag`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    const marks = await watchDragMarks(page);
    const before = await sessionIds(page);
    const at = await onTitle(sessionRow(page, 'S2'));
    await menu.open(page);
    await expect(menu.menu(page)).toBeVisible();

    await pressAndMove(page, at);
    await expect(menu.menu(page)).toHaveCount(0);
    await settle(page);
    expect(await marks()).toBe(0);
    await page.mouse.up();

    await settle(page);
    expect(await marks()).toBe(0);
    expect(await sessionIds(page)).toEqual(before);
    expect((await stored(page)).selectedTabGroupId).toBe('S1');

    // CONTROL: the same press with no menu open does start one.
    await pressAndMove(page, at);
    await expect.poll(marks).toBeGreaterThan(0);
    await page.mouse.up();
  });
}

test("with the header ⋮ open, a click on a window's ⋮ closes it and opens the window's", async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const header = MENUS['header ⋮'];
  await header.open(page);
  await expect(header.menu(page)).toBeVisible();
  const windowTrigger = page.locator(
    '[data-pane="detail"] [data-drag-row-id="w1"] [data-row-actions] [aria-haspopup="menu"]'
  );

  await windowTrigger.click();

  await expect(header.menu(page)).toHaveCount(0);
  await expect(windowTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menu')).toHaveCount(1);
});

test('with a row menu open, a click on the header ⋮ closes it and opens the header ⋮', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const row = MENUS['row menu'];
  await row.open(page);
  await expect(row.menu(page)).toBeVisible();

  await sessionHeaderMenu(page).click();

  await expect(row.menu(page)).toHaveCount(0);
  await expect(MENUS['header ⋮'].menu(page)).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(1);
});
