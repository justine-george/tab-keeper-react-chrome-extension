import type { BrowserContext, Locator, Page } from '@playwright/test';

import {
  liveWindowOf,
  liveWindows,
  radius,
  seedCorners,
  seedLongList,
} from './fixtures/corners';
import { test as freshTest } from './fixtures/extension';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { POPUP, openFullView, openPopup } from './fixtures/onboarding';
import {
  RUN_VIEWS,
  card,
  cardAt,
  cardButton,
  landedAt,
  openRunFromHelp,
  startRunFromHelp,
} from './fixtures/run';
import { CHALK_THEME } from '../src/hooks/useThemeColors';
import { buildSession } from './fixtures/seed';
import { differingPixels, pixelsAt } from './fixtures/pixels';
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
    // KAN-908. The track 10, the knob 3px inside it at 7.
    await expectCorners(knob.locator('..'), '10px', 'the sliding pair track');
    await expectCorners(knob, '7px', 'the sliding pair knob');
    await expectCorners(knob.locator('span').first(), '7px', "the knob's cell");

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
    // KAN-901. Squircle corners, traced as line-tos: path() has no squircle.
    expect(clip, "the dim's hole").toMatch(
      // Chrome serialises the path with a space between every token.
      /^path\(evenodd, "M 0 0 H \d+ V \d+ H 0 Z M [\d.]+ [\d.]+ H [\d.]+ L [\d.]+ [\d.]+ /
    );
    expect(clip, 'no circular arcs').not.toContain(' A ');
  });

  // KAN-901. The save row lights the name field (8) and the save group (12):
  // an 8px hole there left the page lit outside the group's corners.
  test("the tour's save step cuts the dim's hole to the field's corners and the save group's", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await startRunFromHelp(page);
    await expect(cardAt(page, 1)).toBeVisible();
    await expect(card(page)).toHaveAttribute('data-coach-kind', 'save');
    const save = await page
      .locator('[data-tour-anchor="save"]')
      .evaluate((e) => {
        const b = e.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right };
      });
    const clip = await page
      .locator('[data-coach-dim]')
      .evaluate((e) => (e as HTMLElement).style.clipPath);
    const top = /Z M ([\d.]+) ([\d.]+) H ([\d.]+) /.exec(clip);
    expect(top, "the hole's top edge").not.toBeNull();
    const [from, y, to] = top!.slice(1).map(Number);
    expect(y).toBeCloseTo(save.top, 1);
    expect(from - save.left, "the field's corner").toBeCloseTo(8, 1);
    expect(save.right - to, "the save group's corner").toBeCloseTo(12, 1);
  });

  // KAN-901. The row's fill sits 4px in from the row's sides (C2), so a ring
  // round the row sat 8px from the fill at the sides and 4–5px above and below.
  for (const view of RUN_VIEWS)
    test(`${view.name}: the tour's selected-session ring sits 4px out from the row's fill on every side`, async ({
      context,
      extensionId,
    }) => {
      await seedCorners(context);
      const page = await openRunFromHelp(context, extensionId, view);
      for (let i = 0; i < 8; i++) {
        if ((await card(page).getAttribute('data-coach-kind')) === 'row') break;
        const next = cardButton(page, 'Next');
        await (
          (await next.isVisible()) ? next : cardButton(page, 'Use an example')
        ).click();
      }
      await expect(card(page)).toHaveAttribute('data-coach-kind', 'row');
      await landedAt(
        page,
        Number(await card(page).getAttribute('data-coach-step'))
      );
      const gaps = await page.evaluate(() => {
        const ring = document
          .querySelector('[data-coach-ring]')!
          .getBoundingClientRect();
        const fill = document.querySelector(
          '[data-pane="sessions"] [data-run-engaged]'
        )!;
        const at = fill.getBoundingClientRect();
        const left = at.left + fill.clientLeft;
        const top = at.top + fill.clientTop;
        return {
          left: left - ring.left,
          top: top - ring.top,
          right: ring.right - (left + fill.clientWidth),
          bottom: ring.bottom - (top + fill.clientHeight),
        };
      });
      expect(gaps).toEqual({ left: 4, top: 4, right: 4, bottom: 4 });
    });

  test('a lifted tab row is carried on a card at 12, as floating surfaces are', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'p2'));
    await page.mouse.move(at.x + 30, at.y + 70, { steps: 8 });
    await expectCorners(
      page.locator('[data-drag-card]'),
      '12px',
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
    const check = page.locator('[data-swatch-check]').first();
    await expect(check).toBeVisible();
    expect(await radius(check), "the theme check's radius").toBe('4px');
    expect(await shape(check), "the theme check's corner-shape").toBe(ROUND);
    // KAN-904. The tile is a little popup: a panel's corner, and its selected
    // row set in 3px with its own corners, as the app's highlight is.
    await expectCorners(
      page.locator('[data-swatch-tile]').first(),
      '12px',
      'a theme tile'
    );
    await expectCorners(
      page.locator('[data-theme-band="selection"]').first(),
      '3px',
      "a theme tile's selected row"
    );
    const inset = await page
      .locator('[data-swatch-tile]')
      .first()
      .evaluate((tile) => {
        const t = tile.getBoundingClientRect();
        const row = tile
          .querySelector('[data-theme-band="selection"]')!
          .getBoundingClientRect();
        const border = parseFloat(getComputedStyle(tile).borderLeftWidth);
        return {
          left: row.left - (t.left + border),
          right: t.right - border - row.right,
        };
      });
    expect(inset, "the selected row's inset").toEqual({ left: 3, right: 3 });
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
      // KAN-913. Play again, once the loop rests, rounds as icon buttons do.
      await expectCorners(
        page.getByRole('button', { name: 'Play again' }),
        '8px',
        'Play again'
      );
    }
  );
});

// The row element a fill is drawn on, by the text it holds.
const rowOf = (page: Page, scope: string, text: string) =>
  page
    .locator(`${scope} [data-drag-handle-row]`)
    .filter({ hasText: text })
    .last();

async function expectHighlight(row: Locator, what: string, indented = false) {
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
  // An indented row (a tab, a group's header) fills from its own start.
  expect(s, `${what}: 4px in at 8`).toEqual({
    left: indented ? '0px' : '4px',
    right: '4px',
    leftColor: indented ? s.leftColor : 'rgba(0, 0, 0, 0)',
    clip: 'padding-box',
    radius: indented ? '8px 12px 12px 8px / 8px' : '12px / 8px',
  });
}

// Where the first text in `row` starts, from the row's own left edge.
const textX = (row: Locator, text: string) =>
  row.evaluate((e, text) => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n !== null; n = w.nextNode()) {
      // By prefix: a search splits a title into marked and unmarked runs.
      if (!n.textContent?.trim().startsWith(text)) continue;
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
      await expectHighlight(tabRow, 'a hovered tab row', true);
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
      await expectHighlight(groupRow, 'a hovered group row', true);
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
    await expectHighlight(row, 'a hovered Open now tab row', true);
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

const CLEAR = 'rgba(0, 0, 0, 0)';
const lineColours = (lines: Locator) =>
  lines.evaluateAll((els) =>
    els.map((e) => getComputedStyle(e).borderBottomColor)
  );
const rowTops = (page: Page, scope: string) =>
  page
    .locator(`${scope} [data-drag-row-id], ${scope} [data-row-divider]`)
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));

test.describe('lines', () => {
  test('session list: the lines touching a filled row hide; the rest stay; nothing moves', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const lines = page.locator('[data-pane=sessions] [data-row-divider]');
    await expect(lines).toHaveCount(2);
    await page.mouse.move(2, 545);
    const tops = await rowTops(page, '[data-pane=sessions]');
    const [belowPorto, belowReading] = await lineColours(lines);
    // Porto is selected: the line below it hides; the next one stays.
    expect(belowPorto).toBe(CLEAR);
    expect(belowReading).not.toBe(CLEAR);
    const drawn = belowReading;

    // Hover Reading list: both lines touching it hide.
    await rowOf(page, '[data-pane=sessions]', 'Reading list').hover();
    expect(await lineColours(lines)).toEqual([CLEAR, CLEAR]);
    expect(await rowTops(page, '[data-pane=sessions]')).toEqual(tops);

    // Hover Work: only the line above it (and still Porto's) hide.
    await rowOf(page, '[data-pane=sessions]', 'Work').hover();
    expect(await lineColours(lines)).toEqual([CLEAR, CLEAR]);
    await page.mouse.move(2, 545);
    expect(await lineColours(lines)).toEqual([CLEAR, drawn]);

    // Keyboard focus on Work fills it too.
    const work = rowOf(page, '[data-pane=sessions]', 'Work').getByRole(
      'button',
      {
        name: 'Work',
        exact: true,
      }
    );
    await work.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(work).toBeFocused();
    expect(await lineColours(lines)).toEqual([CLEAR, CLEAR]);
    expect(await rowTops(page, '[data-pane=sessions]')).toEqual(tops);
  });

  test('Settings nav: the lines touching the selected and the focused row hide', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const nav = page.locator('[data-panel=settings-nav]');
    await nav.getByRole('button', { name: 'Sessions', exact: true }).click();
    await page.mouse.move(2, 545);
    const lines = nav.locator('[data-row-divider]');
    const names = await nav.getByRole('button').allTextContents();
    const at = names.findIndex((n) => n.trim() === 'Sessions');
    expect(at).toBeGreaterThan(0);
    const colours = await lineColours(lines);
    // The line above Sessions (after the row before it) and the one below it.
    expect(colours[at - 1]).toBe(CLEAR);
    expect(colours[at]).toBe(CLEAR);
    expect(colours.filter((c) => c === CLEAR)).toHaveLength(2);

    const display = nav.getByRole('button', { name: 'Display', exact: true });
    await display.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(display).toBeFocused();
    expect((await lineColours(lines))[0]).toBe(CLEAR);
  });
});

// A popup in any language: waits on the selected row's strip, not on an English label.
async function openPopupIn(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[data-pane=sessions] [data-row-actions]').waitFor();
  return page;
}

// KAN-721, folded in. The selected row's Open / Switch / Replace strip is an
// opaque block over the row's right; no text line may run under it.
test.describe('date clip', () => {
  for (const language of ['ru', 'de']) {
    test(`${language}, popup: the selected row's lines end before its strip; the date ellipsizes`, async ({
      context,
      extensionId,
    }) => {
      await seedCorners(
        context,
        'Chalk',
        new Date(2026, 8, 29, 10, 10).getTime(),
        { language }
      );
      const page = await openPopupIn(context, extensionId);
      const porto = rowOf(page, '[data-pane=sessions]', 'Porto weekend');
      const strip = porto.locator('[data-row-actions]');
      await expect(strip).toBeVisible();
      const stripLeft = (await strip.boundingBox())!.x;
      const button = porto.locator('> button');
      const lines = await button.evaluate((b) =>
        [...b.children].map((line) => {
          const r = document.createRange();
          r.selectNodeContents(line);
          const s = getComputedStyle(line);
          return {
            right: r.getBoundingClientRect().right,
            boxRight: line.getBoundingClientRect().right,
            clips: line.scrollWidth > line.clientWidth,
            overflow: s.textOverflow,
            description: line.getAttribute('aria-description'),
          };
        })
      );
      expect(lines).toHaveLength(3);
      for (const [i, line] of lines.entries()) {
        expect(
          line.boxRight,
          `line ${i} ends before the strip`
        ).toBeLessThanOrEqual(stripLeft + 0.5);
      }
      const date = lines[2];
      expect(date.clips, 'the date is cut').toBe(true);
      expect(date.overflow).toBe('ellipsis');
      expect(date.description, 'the full date is still announced').toMatch(
        /2026|29/
      );
    });
  }

  test('a hovered row draws no strip, so its text does not move', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(
      context,
      'Chalk',
      new Date(2026, 8, 29, 10, 10).getTime(),
      {
        language: 'ru',
      }
    );
    const page = await openPopupIn(context, extensionId);
    const work = rowOf(page, '[data-pane=sessions]', 'Work').locator(
      '> button'
    );
    const at = async () =>
      work.evaluate((b) =>
        [...b.children].map((c) => {
          const r = c.getBoundingClientRect();
          return [r.left, r.width];
        })
      );
    await page.mouse.move(2, 545);
    const rest = await at();
    await work.hover();
    await expect(
      rowOf(page, '[data-pane=sessions]', 'Work').locator('[data-row-actions]')
    ).toHaveCount(0);
    expect(await at()).toEqual(rest);
  });
});

// The final review's findings (KAN-721), each seen red before its fix.
test.describe('review', () => {
  test('after a search is cleared, the selected row still stops its text before the strip', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(
      context,
      'Chalk',
      new Date(2026, 8, 29, 10, 10).getTime(),
      {
        language: 'ru',
      }
    );
    const page = await openPopupIn(context, extensionId);
    const search = page.locator('[data-saved-search] input');
    await search.fill('Po');
    await search.fill('');
    const porto = rowOf(page, '[data-pane=sessions]', 'Porto weekend');
    const strip = porto.locator('[data-row-actions]');
    await expect(strip).toBeVisible();
    await expect
      .poll(async () => {
        const left = (await strip.boundingBox())!.x;
        const rights = await porto
          .locator('> button > *')
          .evaluateAll((els) =>
            els.map((e) => e.getBoundingClientRect().right)
          );
        return rights.every((r) => r <= left + 0.5);
      })
      .toBe(true);
  });

  test('while searching, tab and group rows keep their text where it was', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedCorners(context);
    await liveWindows(serviceWorker);
    const page = await openPopup(context, extensionId);
    const tabRow = rowOf(page, '[data-pane=detail]', 'Livraria Lello');
    const groupRow = page
      .locator('[data-pane=detail] [data-group-drag-handle]')
      .first();
    const saved = async () => [
      await textX(tabRow, 'Livraria'),
      await textX(groupRow, 'Sights'),
    ];
    const before = await saved();
    await page.locator('[data-saved-search] input').fill('Lello');
    await expect(
      page.locator('[data-pane=detail] [data-drag-handle]')
    ).toHaveCount(0);
    expect(await saved()).toEqual(before);

    // Both searches at once turn Open now's tab drag off: its rows lose their handles.
    const full = await openFullView(context, extensionId);
    const liveRow = rowOf(full, '[data-pane=open-now]', 'Tram 28');
    const liveBefore = await textX(liveRow, 'Tram');
    await full.locator('[data-open-now-search] input').fill('Tram');
    await full.locator('[data-saved-search] input').fill('Porto');
    // PREMISE: the tab row lost its drag handle, so nothing in it follows one.
    await expect(liveRow.locator('> [data-drag-handle]')).toHaveCount(0);
    expect(await textX(liveRow, 'Tram')).toBe(liveBefore);
  });

  test("a rename field's keyboard ring follows its rounded corners", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const opener = page.getByRole('button', {
      name: 'Rename window: w1',
      exact: true,
    });
    await opener.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const field = page.locator('input:focus');
    await expect(field).toHaveCount(1);
    const ring = await field.evaluate((f) => {
      for (let e: Element | null = f; e !== null; e = e.parentElement) {
        const a = getComputedStyle(e, '::after');
        if (a.content !== 'none' && a.borderTopStyle === 'solid')
          return a.borderRadius;
      }
      return null;
    });
    expect(ring).toBe('8px');
  });

  test("Charcoal: the selected row's strip meets the fill's top-right curve with no sliver", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context, 'Charcoal');
    const page = await openPopup(context, extensionId);
    await page.mouse.move(2, 545);
    const porto = rowOf(page, '[data-pane=sessions]', 'Porto weekend');
    const b = (await porto.boundingBox())!;
    // The fill's top-right corner, 4px in: drawn with the strip, then without.
    const clip = { x: b.x + b.width - 4 - 12, y: b.y, width: 12, height: 12 };
    // The icons hidden in both shots: only the mask's corner is compared.
    const icons = await page.addStyleTag({
      content: '[data-row-actions] > * { visibility: hidden !important; }',
    });
    const shown = await page.screenshot({ clip });
    const hide = await page.addStyleTag({
      content: '[data-row-actions] { visibility: hidden !important; }',
    });
    const bare = await page.screenshot({ clip });
    await hide.evaluate((el) => el.parentNode?.removeChild(el));
    await icons.evaluate((el) => el.parentNode?.removeChild(el));
    // Up to 8 levels is the two curves' antialiasing stacking (measured: 1
    // pixel at 4, none at 8, with either corner build); a sliver is far more.
    expect((await differingPixels(page, shown, bare, 8)).length).toBe(0);
  });
});

// Justine's demo, 11-01: the drag slots and the Settings Back fill still read square.
test.describe('after the demo', () => {
  test("a drag's landing slot takes a row's corners", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const at = await pickUp(page, tabHandle(page, 'p1'));
    await page.mouse.move(at.x, at.y + 70, { steps: 8 });
    await expectCorners(
      page.locator('[data-drag-landing-slot]').first(),
      '8px',
      'the landing slot'
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test("Settings' Back hover fill takes an icon button's corners", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const back = page.getByRole('button', { name: 'Go back', exact: true });
    await back.hover();
    const fill = await back.evaluate((e) => {
      const s = getComputedStyle(e, '::before');
      return {
        radius: s.borderRadius,
        shape: s.getPropertyValue('corner-shape'),
      };
    });
    expect(fill).toEqual({ radius: '8px', shape: SQUIRCLE });
  });
});

// Justine's picks, R5 (11-01): C for the nav, rounded for the rail.
test.describe('round 5 picks', () => {
  test('a keyboard-focused Settings nav row fills as a hovered one does', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const lang = page
      .locator('[data-panel=settings-nav]')
      .getByRole('button', { name: 'Language', exact: true });
    await lang.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(lang).toBeFocused();
    await page.mouse.move(780, 540);
    await expect
      .poll(() => lang.evaluate((e) => getComputedStyle(e).backgroundColor))
      .toBe('rgb(237, 238, 240)'); // Chalk HOVER_COLOR #EDEEF0
  });

  test("the Open now rail button's fills round at 8", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedCorners(context, 'Chalk', undefined, {
      foldSavedSessionInTabView: false,
    });
    await liveWindows(serviceWorker);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await expectCorners(
      page.locator('[data-open-now-rail] button').first(),
      '8px',
      'the rail button'
    );
  });

  test('the Open now drawer rounds the corners that float over the page', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedCorners(context, 'Chalk', undefined, {
      foldSavedSessionInTabView: false,
    });
    await liveWindows(serviceWorker);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await page.locator('[data-open-now-rail] button').first().click();
    await expectCorners(
      page.locator('[data-pane-layer="drawer"]'),
      '12px 0px 0px 12px',
      'the drawer'
    );
  });

  test("the saved window list's first row sits 4px below the list's top, as Open now's sits below its search", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const gap = await page.locator('[data-panel=windows]').evaluate((list) => {
      const row = list.querySelector('[data-window-drag-handle]');
      if (row === null) return Number.NaN;
      return (
        row.getBoundingClientRect().top -
        (list.getBoundingClientRect().top + list.clientTop)
      );
    });
    expect(gap).toBe(4);
  });

  // Scrolled to its end, a list's last row sits the row gutter above the list's bottom.
  const endGap = (list: Locator) =>
    list.evaluate((box) => {
      const scroller = [...box.querySelectorAll<HTMLElement>('*')].find(
        (e) =>
          getComputedStyle(e).overflowY === 'auto' &&
          e.scrollHeight > e.clientHeight + 1
      );
      if (scroller === undefined) return Number.NaN;
      scroller.scrollTop = scroller.scrollHeight;
      const rows = [...scroller.querySelectorAll('[data-drag-handle-row]')];
      const last = rows[rows.length - 1].getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return (
        Math.round(
          (s.top + scroller.clientTop + scroller.clientHeight - last.bottom) *
            64
        ) / 64
      );
    });

  test('the session list, scrolled to its end, keeps 4px under its last row', async ({
    context,
    extensionId,
  }) => {
    await seedLongList(context);
    const page = await openPopup(context, extensionId);
    expect(await endGap(page.locator('[data-tour-anchor=sessions]'))).toBe(4);
  });

  test("the Open now list, scrolled to its end, keeps its windows' 8px under its last row", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedCorners(context);
    await liveWindowOf(serviceWorker, 30);
    const page = await openFullView(context, extensionId);
    await expect(rowOf(page, '[data-pane=open-now]', 'Tab 30')).toHaveCount(1);
    // Each window block keeps 8px below itself, the last one included: no row touches the edge.
    expect(await endGap(page.locator('[data-panel=open-now-list]'))).toBe(8);
  });

  test("an indented row's fill starts in line with the group band", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const loose = rowOf(page, '[data-pane=detail]', 'Porto itinerary');
    await loose.hover();
    const [fillLeft, bandLeft] = await page.evaluate(() => {
      const row = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-pane=detail] [data-drag-handle-row]'
        ),
      ].find((r) => r.textContent?.includes('Porto itinerary'))!;
      const band = document.querySelector<HTMLElement>(
        '[data-pane=detail] [data-band-id]'
      )!;
      return [
        row.getBoundingClientRect().left + row.clientLeft,
        band.getBoundingClientRect().left,
      ];
    });
    expect(fillLeft).toBe(bandLeft);
  });

  test("the Settings nav's first row sits 4px below the box's top", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const gap = await page
      .locator('[data-panel=settings-nav]')
      .evaluate((nav) => {
        const first = nav.querySelector('button')!;
        return (
          first.getBoundingClientRect().top -
          (nav.getBoundingClientRect().top + nav.clientTop)
        );
      });
    expect(gap).toBe(4);
  });

  for (const view of ['popup', 'full view'] as const) {
    test(`${view}: Settings' Back sits on the Settings header's centre line; the menu box does not move`, async ({
      context,
      extensionId,
    }) => {
      await seedCorners(context);
      const page =
        view === 'popup'
          ? await openPopup(context, extensionId)
          : await openFullView(context, extensionId);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const m = await page.evaluate(() => {
        const mid = (root: Element, text: string) => {
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode())
            if (n.textContent?.trim() === text) {
              const r = document.createRange();
              r.selectNodeContents(n);
              const b = r.getBoundingClientRect();
              return b.top + b.height / 2;
            }
          return Number.NaN;
        };
        return {
          back: mid(document.querySelector('[aria-label="Go back"]')!, 'Back'),
          settings: mid(
            document.querySelector('[data-panel=settings-header]')!,
            'Settings'
          ),
          navTop: document
            .querySelector('[data-panel=settings-nav]')!
            .getBoundingClientRect().top,
          detailsTop: document
            .querySelector('[data-panel=settings-details]')!
            .getBoundingClientRect().top,
        };
      });
      expect(Math.abs(m.back - m.settings)).toBeLessThanOrEqual(0.5);
      // KAN-239: the menu box's top still meets the details box's.
      expect(m.navTop).toBe(m.detailsTop);
    });
  }

  test('renaming a window or a group, the tick ends the field with no gap', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    for (const name of ['Rename window: w1', 'Rename group: Sights']) {
      await page.getByRole('button', { name, exact: true }).click();
      const field = page.locator('[data-pane=detail] input:focus');
      await expect(field).toHaveCount(1);
      const f = (await field.boundingBox())!;
      const tick = (await page
        .getByRole('button', { name: 'Save changes' })
        .boundingBox())!;
      // And the field ends with the row's fill, 4px in, as the strip does at rest.
      const fillRight = await page
        .locator('[data-pane=detail] input:focus')
        .evaluate((input) => {
          const row = input.closest<HTMLElement>('[data-drag-handle-row]')!;
          return (
            row.getBoundingClientRect().right -
            parseFloat(getComputedStyle(row).borderRightWidth)
          );
        });
      expect(
        Math.abs(f.x + f.width - fillRight),
        `${name}: field ends with the fill`
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(f.x + f.width - (tick.x + tick.width)),
        `${name}: tick at the field's end`
      ).toBeLessThanOrEqual(0.5);
      await page.keyboard.press('Escape');
    }
  });

  test('renaming an Open now group, the tick ends the field with no gap', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedCorners(context);
    await liveWindows(serviceWorker);
    const page = await openFullView(context, extensionId);
    await page
      .locator('[data-pane=open-now]')
      .getByRole('button', { name: 'Rename group: Food', exact: true })
      .click();
    const field = page.locator('[data-pane=open-now] input:focus');
    await expect(field).toHaveCount(1);
    const f = (await field.boundingBox())!;
    const tick = (await page
      .locator('[data-pane=open-now]')
      .getByRole('button', { name: 'Save changes' })
      .boundingBox())!;
    expect(Math.abs(f.x + f.width - (tick.x + tick.width))).toBeLessThanOrEqual(
      0.5
    );
    // And the field ends with the row's fill, 4px in, as the strip does at rest.
    const fillRight = await field.evaluate((input) => {
      const row = input.closest<HTMLElement>('[data-drag-handle-row]')!;
      return (
        row.getBoundingClientRect().right -
        parseFloat(getComputedStyle(row).borderRightWidth)
      );
    });
    expect(Math.abs(f.x + f.width - fillRight)).toBeLessThanOrEqual(0.5);
  });
});

// Justine's picks, R6 (11-01).
test.describe('round 6 picks', () => {
  test('Recently deleted keeps only the line under its heading', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    await page.evaluate(
      async (list) => {
        const now = Date.now();
        await chrome.storage.local.set({
          recentlyDeleted: list.map((session, i) => ({
            session,
            deletedAt: now - (i + 1) * 3_600_000,
          })),
        });
      },
      ['Bike repair', 'Job search'].map((title, i) =>
        buildSession({ tabGroupId: `d${i}`, title })
      )
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .locator('[data-pane=sessions]')
      .getByRole('button', { name: 'Recently deleted', exact: true })
      .click();
    const rows = page.locator('[data-testid=recently-deleted-row]');
    await expect(rows).toHaveCount(2);
    expect(
      await rows.evaluateAll((els) =>
        els.map((e) => getComputedStyle(e).borderBottomStyle)
      )
    ).toEqual(['none', 'none']);
    expect(
      await rows
        .first()
        .locator('..')
        .evaluate((e) => getComputedStyle(e).borderTopWidth)
    ).toBe('1px');
  });
});

test.describe('round 6 picks, with scrollbars drawn', () => {
  test.use({ showScrollbars: true });
  // The selected row's fill to the scrollbar thumb, which sits 2px inside its track.
  const fillToThumb = (page: Page) =>
    page
      .locator('[data-pane=sessions] [data-drag-handle-row]')
      .first()
      .evaluate((row) => {
        let s: HTMLElement | null = row.parentElement;
        while (s && getComputedStyle(s).overflowY !== 'auto')
          s = s.parentElement;
        if (s === null) return Number.NaN;
        const bar = s.offsetWidth - s.clientWidth;
        if (bar === 0) return Number.NaN;
        const thumbLeft =
          s.getBoundingClientRect().left + s.clientLeft + s.clientWidth + 2;
        const fillRight =
          row.getBoundingClientRect().right -
          parseFloat(getComputedStyle(row).borderRightWidth);
        return Math.round((thumbLeft - fillRight) * 64) / 64;
      });

  test('beside a scrollbar, the fill sits 4px from the thumb, as from the top', async ({
    context,
    extensionId,
  }) => {
    await seedLongList(context);
    const page = await openPopup(context, extensionId);
    // The row is 336.5px wide: half a pixel is layout rounding.
    expect(Math.abs((await fillToThumb(page)) - 4)).toBeLessThanOrEqual(0.5);
  });

  test("the Settings menu's top gap does not make it scroll at 24px text where it fit before", async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context, 'Chalk', undefined, { language: 'ko' });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 300 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.locator('[aria-label="설정"]').first().click();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '24px';
    });
    const nav = page.locator('[data-panel=settings-nav]');
    await expect(nav).toBeVisible();
    // Main fit this with no bar; a bar takes 10px from every label (ko wrapped on CI).
    expect(
      await nav.evaluate((e) =>
        e instanceof HTMLElement
          ? e.offsetWidth - e.clientWidth - 2
          : Number.NaN
      )
    ).toBe(0);
  });

  test('with no scrollbar, the row keeps its 4px end gutter', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    const row = rowOf(page, '[data-pane=sessions]', 'Porto weekend');
    expect(
      await row.evaluate((e) => getComputedStyle(e).borderRightWidth)
    ).toBe('4px');
  });
});

test.describe('after demo 3', () => {
  test('a session row lifted in its list draws its shadow on its fill', async ({
    context,
    extensionId,
  }) => {
    await seedCorners(context);
    const page = await openPopup(context, extensionId);
    // A session dragged within the session list is drawn lifted, not as a card.
    const at = await pickUp(
      page,
      page.locator('[data-pane=sessions] [data-drag-row-id="reading"]')
    );
    await page.mouse.move(at.x, at.y + 40, { steps: 6 });
    const held = page.locator('[data-drag-held]').first();
    await expect(held).toHaveCount(1);
    const look = await held.evaluate((wrapper) => ({
      wrapper: getComputedStyle(wrapper).boxShadow,
      fill: getComputedStyle(
        wrapper.querySelector(':scope > [data-drag-handle-row]')!
      ).filter,
    }));
    expect(look.wrapper).toBe('none');
    expect(look.fill).toMatch(/^drop-shadow\(/);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});
