import type { Locator, Page } from '@playwright/test';

import { liveWindows, radius, seedCorners } from './fixtures/corners';
import { test as freshTest } from './fixtures/extension';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openFullView, openPopup } from './fixtures/onboarding';
import { cardAt, startRunFromHelp } from './fixtures/run';
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
