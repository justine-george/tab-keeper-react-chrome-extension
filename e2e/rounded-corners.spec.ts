import type { Locator, Page } from '@playwright/test';

import { liveWindows, radius, seedCorners } from './fixtures/corners';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { openFullView, openPopup } from './fixtures/onboarding';

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
