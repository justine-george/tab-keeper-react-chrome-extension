import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { documentLanded } from './fixtures/landed';
import { openFullView } from './fixtures/onboarding';
import { seedSettings } from './fixtures/seed';
import { stubToolbarPin } from './fixtures/toolbarPin';
import {
  boxOf,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';

// KAN-982 on the real artifact: a menu grows from what opened it and fades
// out as an inert copy; every dialog rises with its dim and fades out. A key
// opens and closes a menu at once; reduced motion keeps all of it still.

const SESSIONS = [
  session('S1', 'Trip', [savedWindow('w1', 'Reading', 2)]),
  session('S2', 'Bravo', [savedWindow('x2', 'Notes', 1)]),
];

const rowMenu = (page: Page): Locator =>
  page.locator('[role="menu"][data-row-menu]');
const sortMenu = (page: Page): Locator =>
  page.getByRole('menu', { name: 'Sort sessions' });
const sessionRow = (page: Page, id: string): Locator =>
  page.locator(
    `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-drag-handle-row]`
  );
const copies = (page: Page): Locator => page.locator('[data-leaving-copy]');

interface Motion {
  keyframes: Array<Record<string, unknown>>;
  duration: number;
  pseudo: string | null;
}

// Every animation running on `el`, read as Chrome holds them.
const motionsOf = (el: Locator): Promise<Motion[]> =>
  el.evaluate((node) =>
    node
      .getAnimations({ subtree: true })
      // Its own and its ::backdrop's, not its children's.
      .filter((a) => (a.effect as KeyframeEffect).target === node)
      .map((a) => {
        const effect = a.effect as KeyframeEffect;
        return {
          keyframes: effect
            .getKeyframes()
            .map(({ opacity, scale, translate }) => ({
              opacity,
              scale,
              translate,
            })),
          duration: Number(effect.getTiming().duration),
          pseudo: effect.pseudoElement,
        };
      })
  );

async function rightClickRow(page: Page, id: string) {
  const box = await boxOf(sessionRow(page, id));
  const at = {
    x: Math.round(box.x + 60),
    y: Math.round(box.y + box.height / 2),
  };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  return at;
}

test.describe('menus (KAN-982)', () => {
  test('a right-click menu grows from the pointer, 0.96 to 1 over 160 ms', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    const at = await rightClickRow(page, 'S2');
    const menu = rowMenu(page);
    await expect(menu).toBeVisible();

    expect(await motionsOf(menu)).toEqual([
      {
        keyframes: [
          { opacity: '0', scale: '0.96', translate: undefined },
          { opacity: '1', scale: '1', translate: undefined },
        ],
        duration: 160,
        pseudo: null,
      },
    ]);
    // The origin is the pointer, in the menu's own box.
    const origin = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const [x, y] = getComputedStyle(el)
        .transformOrigin.split(' ')
        .map(parseFloat);
      return {
        x: r.left + x * 0,
        ox: x,
        oy: y,
        left: parseFloat(el.style.left),
        top: parseFloat(el.style.top),
      };
    });
    expect(origin.ox).toBeCloseTo(at.x - origin.left, 0);
    expect(origin.oy).toBeCloseTo(at.y - origin.top, 0);
  });

  test('a right-click menu that must open upward still grows from the pointer', async ({
    context,
    extensionId,
  }) => {
    const many = Array.from({ length: 9 }, (_, i) =>
      session(`S${i + 1}`, `Session ${i + 1}`, [savedWindow(`w${i}`, 'W', 1)])
    );
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: many,
    });
    // The lowest row in view: the menu cannot fit below it, so it ends at the point.
    const rows = await page
      .locator('[data-pane="sessions"] [data-drag-handle-row]')
      .evaluateAll((els) =>
        els
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.bottom <= innerHeight)
          .map((r) => ({ x: r.x, y: r.y + r.height / 2 }))
      );
    const low = rows[rows.length - 1];
    const at = { x: Math.round(low.x + 60), y: Math.round(low.y) };
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const menu = rowMenu(page);
    await expect(menu).toBeVisible();
    const placed = await menu.evaluate((el) => {
      const [ox, oy] = getComputedStyle(el)
        .transformOrigin.split(' ')
        .map(parseFloat);
      return {
        ox,
        oy,
        left: parseFloat(el.style.left),
        top: parseFloat(el.style.top),
      };
    });
    // PREMISE: it did open upward.
    expect(placed.top).toBeLessThan(at.y - 100);
    expect(placed.ox).toBeCloseTo(at.x - placed.left, 0);
    expect(placed.oy).toBeCloseTo(at.y - placed.top, 0);
  });

  test("a button's menu grows from the button's side, at its top", async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    await page.getByRole('button', { name: 'Sort sessions' }).click();
    const menu = sortMenu(page);
    await expect(menu).toBeVisible();
    expect(await motionsOf(menu)).toHaveLength(1);
    const { origin, width } = await menu.evaluate((el) => ({
      origin: getComputedStyle(el).transformOrigin,
      width: el instanceof HTMLElement ? el.offsetWidth : Number.NaN,
    }));
    expect(origin).toBe(`${width}px 0px`);
  });

  test('closed by a press, a copy fades where it stood: inert, no role, gone soon after', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    await rightClickRow(page, 'S2');
    await expect(rowMenu(page)).toBeVisible();
    // Let the grow finish: a menu cut short while growing just goes.
    await expect.poll(() => motionsOf(rowMenu(page))).toEqual([]);
    const before = await boxOf(rowMenu(page));

    await page.mouse.click(5, 540);

    await expect(rowMenu(page)).toHaveCount(0);
    await expect(copies(page)).toHaveCount(1);
    const copy = await copies(page).evaluate((el) => ({
      inert: (el as HTMLElement).inert,
      hidden: el.getAttribute('aria-hidden'),
      roles:
        el.querySelectorAll('[role]').length +
        (el.hasAttribute('role') ? 1 : 0),
      pointer: getComputedStyle(el).pointerEvents,
      text: el.textContent,
    }));
    expect(copy).toMatchObject({
      inert: true,
      hidden: 'true',
      roles: 0,
      pointer: 'none',
    });
    expect(copy.text).toContain('Rename session');
    const box = await boxOf(copies(page));
    expect(box.x).toBeCloseTo(before.x, 0);
    expect(box.y).toBeCloseTo(before.y, 0);
    // Nothing named a menu or a menu item remains for anyone.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(copies(page)).toHaveCount(0);
  });

  test('a key opens and closes a menu at once', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    const trigger = page.getByRole('button', { name: 'Sort sessions' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(sortMenu(page)).toBeVisible();
    expect(await motionsOf(sortMenu(page))).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(sortMenu(page)).toHaveCount(0);
    expect(await copies(page).count()).toBe(0);
  });

  test('a menu opened over one still fading out cuts its fade', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    await rightClickRow(page, 'S2');
    await expect.poll(() => motionsOf(rowMenu(page))).toEqual([]);
    // Closing by right-clicking another row opens that row's menu at once.
    await rightClickRow(page, 'S1');
    await expect(rowMenu(page)).toBeVisible();
    expect(await copies(page).count()).toBe(0);
  });
});

test.describe('dialogs (KAN-982)', () => {
  async function openSwitch(page: Page) {
    await rightClickRow(page, 'S2');
    await rowMenu(page)
      .locator('[data-menu-action-row]')
      .getByRole('menuitem', { name: 'Switch', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('a dialog rises 16 px with its dim, both over 200 ms', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    const dialog = await openSwitch(page);
    const motions = await motionsOf(dialog);
    const own = motions.find((m) => m.pseudo === null);
    const dim = motions.find((m) => m.pseudo === '::backdrop');
    expect(own).toMatchObject({
      duration: 200,
      keyframes: [
        { opacity: '0', translate: '0px 16px' },
        { opacity: '1', translate: '0px' },
      ],
    });
    expect(dim).toMatchObject({
      duration: 200,
      keyframes: [{ opacity: '0' }, { opacity: '1' }],
    });
  });

  test('closed, the dialog and its dim fade out together, then are gone', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    const dialog = await openSwitch(page);
    await expect.poll(() => motionsOf(dialog)).toEqual([]);
    const dimColor = await dialog.evaluate(
      (el) => getComputedStyle(el, '::backdrop').backgroundColor
    );

    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    const parts = await copies(page).evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName,
        background: getComputedStyle(el).backgroundColor,
        text: el.textContent,
      }))
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({
      tag: 'DIV',
      background: dimColor,
      text: '',
    });
    expect(parts[1].tag).toBe('DIV');
    expect(parts[1].text).toContain('Switch');
    await expect(copies(page)).toHaveCount(0);
  });
});

test.describe('the pin guide (KAN-982)', () => {
  // Its arrow is fixed to Chrome's toolbar: a rise would carry it along.
  test('fades in where it stands, and its arrow never moves', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await seedSettings(context, { isPinGuideDismissed: false });
    const page = await openFullView(context, extensionId);
    const arrow = page.locator('[data-pin-arrow] svg');
    const guide = page.getByRole('dialog', {
      name: 'Pin Tab Keeper to your toolbar',
      exact: true,
    });
    await expect(guide).toBeVisible();
    expect((await motionsOf(guide)).find((m) => m.pseudo === null)).toEqual({
      duration: 200,
      pseudo: null,
      keyframes: [
        { opacity: '0', scale: undefined, translate: undefined },
        { opacity: '1', scale: undefined, translate: undefined },
      ],
    });
    // Its first frame, held: where the arrow is as the guide starts to come in.
    await page.evaluate(() =>
      document.getAnimations().forEach((a) => {
        a.pause();
        a.currentTime = 0;
      })
    );
    const arriving = await boxOf(arrow);
    await page.evaluate(() =>
      document.getAnimations().forEach((a) => {
        if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish();
      })
    );
    await documentLanded(page);
    const landed = await boxOf(arrow);
    expect(arriving.x).toBeCloseTo(landed.x, 0);
    expect(arriving.y).toBeCloseTo(landed.y, 0);
  });
});

test.describe('reduced motion (KAN-982)', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no grow, no copy, no rise', async ({ context, extensionId }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    await rightClickRow(page, 'S2');
    await expect(rowMenu(page)).toBeVisible();
    expect(await motionsOf(rowMenu(page))).toEqual([]);
    await page.mouse.click(5, 540);
    await expect(rowMenu(page)).toHaveCount(0);
    expect(await copies(page).count()).toBe(0);

    await rightClickRow(page, 'S2');
    await rowMenu(page)
      .locator('[data-menu-action-row]')
      .getByRole('menuitem', { name: 'Switch', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await motionsOf(dialog)).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await copies(page).count()).toBe(0);
  });
});
