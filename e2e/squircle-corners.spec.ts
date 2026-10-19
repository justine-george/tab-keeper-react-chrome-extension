import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { differingPixels } from './fixtures/pixels';
import {
  groupedWindow,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { generatePlaceholderURL } from '../src/utils/functions/local';

// KAN-693. Tab Keeper is square (RADIUS.SQUARE); the few corners it does round
// are squircles, Justine's pick from the inventory and mock. Circles stay
// round. Every element here is read twice: its computed corner-shape, and its
// pixels against the same element forced back to round -- a style can be set
// and paint nothing (KAN-134).

// Chrome's computed values: `squircle` is superellipse(2), `round` superellipse(1).
const SQUIRCLE = 'superellipse(2)';
const ROUND = 'superellipse(1)';

async function expectSquircle(page: Page, loc: Locator, what: string) {
  await expect(loc, `${what} is drawn`).toBeVisible();
  expect(
    await loc.evaluate((e) =>
      getComputedStyle(e).getPropertyValue('corner-shape')
    ),
    `${what}'s corner-shape`
  ).toBe(SQUIRCLE);
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`${what} has no box`);
  const clip = {
    x: b.x - 2,
    y: b.y - 2,
    width: b.width + 4,
    height: b.height + 4,
  };
  const shown = await page.screenshot({ clip });
  await loc.evaluate((e) => e.setAttribute('data-zz-round', ''));
  const style = await page.addStyleTag({
    content: '[data-zz-round] { corner-shape: round !important; }',
  });
  const round = await page.screenshot({ clip });
  await style.evaluate((el) => el.parentNode?.removeChild(el));
  await loc.evaluate((e) => e.removeAttribute('data-zz-round'));
  expect(
    (await differingPixels(page, shown, round)).length,
    `${what} paints differently from a round corner`
  ).toBeGreaterThan(0);
}

const W1 = groupedWindow('w1', 'Morning', [
  { groupId: 'g1', title: 'Booked', color: 'blue' },
]);
const W2 = savedWindow('w2', 'Evening', 3);

test('the drag landing slot is a squircle; a colour swatch stays a circle', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: [session('S1', 'Research', [W1, W2])],
  });

  // CONTROL: a circle is a shape, not a corner, and keeps round.
  await page.locator('[data-group-color-strip]').first().click();
  const swatch = page.getByRole('menuitemradio').first();
  await expect(swatch).toBeVisible();
  expect(
    await swatch.evaluate((e) =>
      getComputedStyle(e).getPropertyValue('corner-shape')
    )
  ).toBe(ROUND);
  await page.keyboard.press('Escape');

  const row = page.getByText('Page w2.0', { exact: true }).first();
  const rb = await row.boundingBox();
  if (rb === null) throw new Error('no saved tab row');
  const x = rb.x + 20;
  const y = rb.y + rb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 4 });
  await page.mouse.move(x, y + 40, { steps: 6 });
  await expectSquircle(
    page,
    page.locator('[data-drag-landing-slot]'),
    'the landing slot'
  );
  await page.mouse.up();
});

test('the export page and the file it saves draw squircles', async ({
  context,
  extensionId,
}) => {
  const notWeb = {
    ...W2.tabs[0],
    tabId: 'cx',
    title: 'Settings',
    url: 'chrome://settings',
  };
  await openSaved(context, extensionId, 'popup', {
    sessions: [
      session('S1', 'Research', [W1, { ...W2, tabs: [...W2.tabs, notWeb] }]),
    ],
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/export.html?session=S1`);
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  await page.mouse.move(2, 2);

  const layout = page.getByRole('group', { name: 'Layout' });
  await expectSquircle(page, layout, 'the Layout switch');
  await expectSquircle(
    page,
    layout.locator('[data-sliding-knob]'),
    "the switch's knob"
  );

  await page.getByRole('button', { name: 'Comfortable' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as HTML' }).click(),
  ]);
  const path = join(mkdtempSync(join(tmpdir(), 'squircle-')), 'export.html');
  await download.saveAs(path);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page
    .getByRole('button', { name: /^Hide: / })
    .first()
    .click();
  const tally = page.getByRole('status').filter({ hasText: 'hidden' });
  await page.mouse.move(2, 2);
  await expectSquircle(page, tally, 'the edit tally');
  const hide = page.getByRole('button', { name: /^Hide: / }).nth(1);
  await hide.hover();
  await expectSquircle(page, hide, 'the Hide button');

  // The saved file, in a browser.
  const file = await context.newPage();
  await file.setViewportSize({ width: 900, height: 900 });
  await file.setContent(readFileSync(path, 'utf8'));
  await expectSquircle(
    file,
    file.locator('.note').first(),
    "the file's Not a web link badge"
  );
  await expectSquircle(
    file,
    file.locator('.group').first(),
    "the file's group band"
  );
  await expectSquircle(
    file,
    file.locator('.sig img').first(),
    "the file's signature icon"
  );
});

test("a restored tab's placeholder page draws a squircle Go to URL", async ({
  context,
}) => {
  const page = await context.newPage();
  await page.goto(
    generatePlaceholderURL(
      'Kitchen ideas',
      '',
      'https://example.com/',
      'Go to URL'
    )
  );
  await expectSquircle(page, page.locator('#copyButton'), 'Go to URL');
});
