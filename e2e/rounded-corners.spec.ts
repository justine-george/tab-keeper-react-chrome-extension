import type { Locator, Page } from '@playwright/test';

import { liveWindows, radius, seedCorners } from './fixtures/corners';
import { test as freshTest } from './fixtures/extension';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openFullView, openPopup } from './fixtures/onboarding';
import { cardAt, startRunFromHelp } from './fixtures/run';
import { CHALK_THEME } from '../src/hooks/useThemeColors';
import { pixelsAt } from './fixtures/pixels';
import { pickUp, tabHandle } from './fixtures/sessionDrag';

// KAN-721. Every surface rounds by role, as the approved C2 mocks show
// (docs/superpowers/mocks/kan-721-r3, -r4): panel 12, control 8, a child
// flush in a panel's corner 11, all squircles.

const SQUIRCLE = 'superellipse(2)';

const shape = (loc: Locator): Promise<string> =>
  loc.evaluate((e) => getComputedStyle(e).getPropertyValue('corner-shape'));

async function expectCorners(loc: Locator, want: string, what: string) {
  await expect(loc, `${what} is drawn`).toBeVisible();
  expect(await radius(loc), `${what}'s radius`).toBe(want);
  expect(await shape(loc), `${what}'s corner-shape`).toBe(SQUIRCLE);
}

const saveGroup = (page: Page) =>
  page
    .locator('[data-save-row] > div')
    .filter({ has: page.getByRole('button', { name: 'More actions' }) });

test.describe('panels', () => {
  test('popup: lists, cards and the save group round at 12; what sits in their corners at 11', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await expectCorners(
      page.locator('[data-tour-anchor=sessions]'),
      '12px',
      'the session list'
    );
    const group = saveGroup(page);
    await expectCorners(group, '12px', 'the save group');
    await expectCorners(
      group.getByRole('button', { name: 'More actions' }),
      '0px 11px 11px 0px',
      "the save group's ⋮ half"
    );
    await expectCorners(
      group.locator('button').first(),
      '11px 0px 0px 11px',
      "the save group's save half"
    );
    const card = page.locator('[data-panel=session-card]');
    await expectCorners(card, '12px', 'the session title card');
    await expectCorners(
      card.getByRole('button', { name: 'Add current window' }),
      '8px 8px 11px',
      'Add current window, in the card’s bottom-right corner'
    );
    await expectCorners(
      page.locator('[data-panel=windows]'),
      '12px',
      'the window list'
    );
  });

  test('full view: Open now header and list round at 12', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedCorners(context);
    await liveWindows(serviceWorker);
    const page = await openFullView(context, extensionId);
    const header = page.locator('[data-open-now-header]');
    await expectCorners(header, '12px', 'the Open now header');
    await expectCorners(
      page.locator('[data-panel=open-now-list]'),
      '12px',
      'the Open now list'
    );
  });

  test('Settings: nav, header, details and the Default save tiles round at 12', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    await expectCorners(
      page.locator('[data-panel=settings-nav]'),
      '12px',
      'the Settings nav'
    );
    await expectCorners(
      page.locator('[data-panel=settings-header]'),
      '12px',
      'the Settings header'
    );
    await expectCorners(
      page.locator('[data-panel=settings-details]'),
      '12px',
      'the Settings details'
    );
    await expectCorners(
      page.locator('[data-tile]').first(),
      '12px',
      'a Default save tile'
    );
  });
});

const ROUND = 'superellipse(1)';

test.describe('controls', () => {
  test('popup: inputs, icon buttons, menus, tooltips, tags, strips and the search hint', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await expectCorners(
      page.getByPlaceholder('Name the new session'),
      '8px',
      'the name input'
    );
    await expectCorners(
      page.getByRole('button', { name: 'Sort sessions' }),
      '8px',
      'the Sort icon button'
    );
    await expectCorners(
      page
        .locator('[data-session-toolbar]')
        .getByRole('button', { name: 'Open session' }),
      '8px',
      "the session card's Open icon button"
    );

    const tag = page.locator('[data-row-tag]').first();
    expect(await radius(tag), "the row tag's radius").toBe('999px');
    expect(await shape(tag), "the row tag's corner-shape").toBe(ROUND);

    await expectCorners(
      page.locator('[data-group-color-strip]').first(),
      '8px',
      'the group colour strip'
    );

    const hint = page
      .locator('[data-pane=sessions]')
      .getByText('/', { exact: true });
    expect(await radius(hint), "the search hint's radius").toBe('4px');
    expect(await shape(hint), "the search hint's corner-shape").toBe(ROUND);

    await page
      .locator('[data-pane=detail]')
      .getByText('Livraria Lello')
      .first()
      .hover();
    await expectCorners(
      page.locator('[data-tooltip-chip]').first(),
      '8px',
      'the tooltip chip'
    );

    await page.mouse.move(2, 545);
    await page
      .locator(
        '[data-tour-anchor="session-menu"] [aria-label="More actions"][aria-haspopup="menu"]'
      )
      .click();
    const menu = page.getByRole('menu');
    await expectCorners(menu, '12px', 'the menu');
    await expectCorners(
      menu.getByRole('menuitem').first(),
      '8px',
      'a menu item'
    );
    await page.keyboard.press('Escape');

    await page
      .locator('[data-pane=sessions]')
      .getByRole('button', { name: 'Work', exact: true })
      .focus();
    await page.keyboard.press('Delete');
    await expectCorners(
      page.locator('[data-toast]').first(),
      '12px',
      'the toast'
    );
  });

  test('Settings: the sliding pair, and the Empty dialog with its buttons', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page
      .locator('[data-pane=sessions]')
      .getByRole('button', { name: 'Work', exact: true })
      .focus();
    await page.keyboard.press('Delete');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    const knob = page.locator('[data-sliding-knob]').first();
    await expectCorners(knob.locator('..'), '8px', 'the sliding pair track');
    await expectCorners(knob, '6px', 'the sliding pair knob');
    await expectCorners(knob.locator('span').first(), '6px', "the knob's cell");

    await page
      .locator('[data-pane=sessions]')
      .getByRole('button', { name: 'Recently deleted', exact: true })
      .click();
    await page.getByRole('button', { name: 'Empty', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await expectCorners(dialog, '16px', 'the Empty dialog');
    await expectCorners(
      dialog.getByRole('button', { name: 'Cancel' }),
      '8px',
      "the dialog's Cancel"
    );
  });
});

test.describe('surfaces', () => {
  test('the tour ring rounds at 12 and the dim cuts its hole with rounded corners', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await startRunFromHelp(page);
    await expect(cardAt(page, 1)).toBeVisible();
    await expectCorners(
      page.locator('[data-coach-ring]'),
      '12px',
      'the tour ring'
    );
    await expectCorners(
      page.locator('[data-coach-mark]'),
      '16px',
      'the coach card'
    );
    const clip = await page
      .locator('[data-coach-dim]')
      .evaluate((e) => (e as HTMLElement).style.clipPath);
    expect(clip, "the dim's hole").toMatch(
      // Chrome serialises the path with a space between every token.
      /^path\(evenodd, "M 0 0 H \d+ V \d+ H 0 Z M .* A 12 12 0 0 1 /
    );
  });

  test('a lifted tab row is carried on a card at 8', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'p2'));
    await page.mouse.move(at.x + 30, at.y + 70, { steps: 8 });
    await expectCorners(
      page.locator('[data-drag-card]'),
      '8px',
      'the drag card'
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test("Settings › Display: the current theme's check is a small round mark", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Display', exact: true }).click();
    const check = page.locator('[data-theme-check]').first();
    await expect(check).toBeVisible();
    expect(await radius(check), "the theme check's radius").toBe('4px');
    expect(await shape(check), "the theme check's corner-shape").toBe(ROUND);
    await expectCorners(
      page.locator('[data-theme-tile]').first(),
      '8px',
      'a theme tile'
    );
  });
});

freshTest.describe('welcome', () => {
  freshTest.use({ freshProfile: true });
  freshTest(
    'the hero and its windows round at 12; a title bar hugs its window',
    async ({ context, extensionId }) => {
      const page = await openPopup(context, extensionId);
      const hero = page.locator('[data-hero-frame]');
      await expectCorners(hero, '12px', 'the hero frame');
      for (const side of ['left', 'right']) {
        const win = page.locator(`[data-hero-part="window-${side}"]`);
        await expectCorners(win, '12px', `the ${side} window`);
        await expectCorners(
          win.locator('> *').first(),
          '11px 11px 0px 0px',
          `the ${side} window's title bar`
        );
      }
    }
  );
});

// The row element a fill is drawn on, by the text it holds.
const rowOf = (page: Page, scope: string, text: string) =>
  page
    .locator(`${scope} [data-drag-handle-row]`)
    .filter({ hasText: text })
    .last();

async function expectHighlight(row: Locator, what: string) {
  const s = await row.evaluate((e) => {
    const c = getComputedStyle(e);
    return {
      left: c.borderLeftWidth,
      right: c.borderRightWidth,
      leftColor: c.borderLeftColor,
      clip: c.backgroundClip,
      radius: c.borderRadius,
    };
  });
  expect(s, `${what}: 4px in from each side at 8`).toEqual({
    left: '4px',
    right: '4px',
    leftColor: 'rgba(0, 0, 0, 0)',
    clip: 'padding-box',
    radius: '12px / 8px',
  });
}

// Where the first text in `row` starts, from the row's own left edge.
const textX = (row: Locator, text: string) =>
  row.evaluate((e, text) => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n !== null; n = w.nextNode()) {
      if (n.textContent?.trim() !== text) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      return r.getBoundingClientRect().left - e.getBoundingClientRect().left;
    }
    return Number.NaN;
  }, text);

// Measured on main d2bb341b (popup 790x550).
const WINDOW_TITLE_X = 72;

test.describe('rows', () => {
  for (const theme of ['Chalk', 'Charcoal']) {
    test(`${theme} popup: session, detail window, group and tab rows fill 4px in; text stays put; the strip mask meets the fill`, async ({
      context,
      extensionId,
    }) => {
      await seedCorners(context, theme);
      const page = await openPopup(context, extensionId);
      const porto = rowOf(page, '[data-pane=sessions]', 'Porto weekend');
      await expectHighlight(porto, 'the selected session row');
      expect(await textX(porto, 'Porto weekend')).toBe(33);
      await expectCorners(
        porto.locator('[data-row-actions]'),
        '0px 8px 8px 0px',
        'the strip mask'
      );

      const reading = rowOf(page, '[data-pane=sessions]', 'Reading list');
      await reading.hover();
      await expectHighlight(reading, 'a hovered session row');
      expect(await textX(reading, 'Reading list')).toBe(33);

      const tabRow = rowOf(page, '[data-pane=detail]', 'Livraria Lello');
      await tabRow.hover();
      await expectHighlight(tabRow, 'a hovered tab row');
      expect(await textX(tabRow, 'Livraria Lello')).toBe(40);
      await expectCorners(
        tabRow.locator('[data-row-actions]'),
        '0px 8px 8px 0px',
        "the tab row's strip mask"
      );

      const windowRow = page
        .locator('[data-pane=detail] [data-window-drag-handle]')
        .first();
      await windowRow.hover();
      await expectHighlight(windowRow, 'a hovered window row');
      expect(await textX(windowRow, 'w1')).toBe(WINDOW_TITLE_X);

      const groupRow = page
        .locator('[data-pane=detail] [data-group-drag-handle]')
        .first();
      await groupRow.hover();
      await expectHighlight(groupRow, 'a hovered group row');
      expect(await textX(groupRow, 'Sights')).toBe(4);
    });
  }

  test('Settings nav rows fill 4px in; the label stays put', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const display = page
      .locator('[data-panel=settings-nav]')
      .getByRole('button', { name: 'Display', exact: true });
    await display.hover();
    await expectHighlight(display, 'a hovered Settings nav row');
    expect(await textX(display, 'Display')).toBe(34);
  });

  test('full view: an Open now tab row fills 4px in; its favicon stays put', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedCorners(context);
    await liveWindows(serviceWorker);
    const page = await openFullView(context, extensionId);
    const row = rowOf(page, '[data-pane=open-now]', 'Tram 28');
    await row.hover();
    await expectHighlight(row, 'a hovered Open now tab row');
    expect(await textX(row, 'globe')).toBe(4);
  });

  test("the keyboard ring sits inside a session row's fill, rounded at 6", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const row = rowOf(page, '[data-pane=sessions]', 'Reading list');
    // Focus by script, then a real Shift+Tab and Tab, so the page is in key-nav.
    await row
      .getByRole('button', { name: 'Reading list', exact: true })
      .focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(
      row.getByRole('button', { name: 'Reading list', exact: true })
    ).toBeFocused();
    const ring = await row.evaluate((e) => {
      const c = getComputedStyle(e, '::after');
      return {
        content: c.content,
        radius: c.borderRadius,
        left: c.left,
        right: c.right,
        width: c.borderTopWidth,
      };
    });
    expect(ring).toEqual({
      content: '""',
      radius: '6px',
      left: '2px',
      right: '2px',
      width: '2px',
    });
  });

  test("a tab carried onto a session row: the outline is drawn inside the row's fill on all four sides", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'p2'));
    const list = await page.locator('[data-pane=sessions]').boundingBox();
    if (list === null) throw new Error('no session list');
    await page.mouse.move(list.x + list.width / 2, at.y, { steps: 8 });
    const target = rowOf(page, '[data-pane=sessions]', 'Reading list');
    const b = await target.boundingBox();
    if (b === null) throw new Error('no Reading list row');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await expect(target).toHaveAttribute('data-carry-target', '');
    const outline = await target.evaluate((e) => {
      const c = getComputedStyle(e, '::before');
      const own = getComputedStyle(e);
      return {
        content: c.content,
        border: c.borderTopWidth,
        radius: c.borderRadius,
        inset: [c.top, c.right, c.bottom, c.left].join(' '),
        outline: own.outlineStyle,
      };
    });
    expect(outline).toEqual({
      content: '""',
      border: '2px',
      radius: '8px',
      inset: '0px 0px 0px 0px',
      outline: 'none',
    });
    // And it paints: 1px inside the fill's left edge, mid-height, is the outline.
    const [painted] = await pixelsAt(page, [[b.x + 4 + 1, b.y + b.height / 2]]);
    expect(painted).toBe(CHALK_THEME.LABEL_L2_COLOR);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test("a detail window row's ⋮ menu opens whole, not cut by its rounded row", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const windowRow = page
      .locator('[data-pane=detail] [data-window-drag-handle]')
      .first();
    await windowRow.hover();
    await windowRow.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitem');
    const last = items.last();
    const box = await last.boundingBox();
    if (box === null) throw new Error('no last item');
    const hit = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.closest('[role=menuitem]')
          ?.textContent ?? null,
      [box.x + box.width / 2, box.y + box.height / 2]
    );
    expect(hit).toBe(await last.textContent());
  });
});
