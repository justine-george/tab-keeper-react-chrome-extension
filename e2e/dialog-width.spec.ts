import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions } from './fixtures/seed';

// KAN-301. The four confirm dialogs (CloudConsentModal, FocusConfirmModal,
// DeleteCloudDataModal, LoadBackupModal) each set `width: 78%` on a fixed
// <dialog>, which in the 790px popup is 616.2px -- the width they were
// designed at. The tab view (KAN-279) opens the same page at a browser
// window's width, where 78% grows past what a confirm needs: 998px @1280,
// 1498px @1920, measured on main. DIALOG.WIDTH (styles/scale.ts) is
// `min(78%, 616px)`, shared by all four, so every dialog stays the size it
// was designed at wherever it opens.
//
// The sync-question dialog exercises the shared value for the popup and both
// tab-view sizes; Delete cloud data is checked separately, in the tab view
// only, as the one other dialog reachable without extra setup.
// FocusConfirmModal is unreachable in the tab view (Switch is hidden there,
// D7) and LoadBackupModal needs a file pick -- both are covered by the
// shared DIALOG.WIDTH token rather than faked here.

const POPUP_VIEWPORT = { width: 790, height: 550 };
const TAB_1280 = { width: 1280, height: 800 };
const TAB_1920 = { width: 1920, height: 1080 };

async function openPage(
  context: BrowserContext,
  extensionId: string,
  path: string,
  viewport: { width: number; height: number }
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}

// A fixed-position dialog's percentage width is relative to the page's own
// viewport (there is no transformed ancestor to change that), so the gap is
// measured against page.viewportSize(), not the popup's 790px app box.
async function dialogGeometry(
  page: Page,
  name: string
): Promise<{ width: number; leftGap: number; rightGap: number }> {
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  if (box === null) throw new Error(`no box for dialog "${name}"`);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('no viewport size');
  return {
    width: box.width,
    leftGap: box.x,
    rightGap: viewport.width - (box.x + box.width),
  };
}

function expectCapped(
  geo: { width: number; leftGap: number; rightGap: number },
  label: string
): void {
  expect(geo.width, `${label}: width`).toBeGreaterThanOrEqual(615);
  expect(geo.width, `${label}: width`).toBeLessThanOrEqual(617);
  expect(
    Math.abs(geo.leftGap - geo.rightGap),
    `${label}: not centred (left ${geo.leftGap}, right ${geo.rightGap})`
  ).toBeLessThanOrEqual(1);
}

test.describe('confirm dialogs stay capped at the popup width (KAN-301)', () => {
  test.use({ freshProfile: true });

  // Three separate tests, each its own fresh profile (the `context` fixture
  // mints a new one per test): opening a second page in the SAME profile
  // after the first has mounted stamps extensionInstalledTime, which flips
  // the dialog to the 'existing' wording (askForCloudConsent, App.tsx) --
  // measured hitting this while drafting the spec as one page's mount
  // changing what the NEXT page in the same profile sees.
  test('is 616±1px and centred in the popup (CONTROL)', async ({
    context,
    extensionId,
  }) => {
    const popup = await openPage(
      context,
      extensionId,
      'index.html',
      POPUP_VIEWPORT
    );
    expectCapped(
      await dialogGeometry(popup, 'Welcome to Tab Keeper'),
      'popup CONTROL'
    );
  });

  test('is 616±1px and centred in the tab view at 1280', async ({
    context,
    extensionId,
  }) => {
    const tab1280 = await openPage(
      context,
      extensionId,
      'index.html?view=tab',
      TAB_1280
    );
    expectCapped(
      await dialogGeometry(tab1280, 'Welcome to Tab Keeper'),
      'tab view @1280'
    );
  });

  test('is 616±1px and centred in the tab view at 1920', async ({
    context,
    extensionId,
  }) => {
    const tab1920 = await openPage(
      context,
      extensionId,
      'index.html?view=tab',
      TAB_1920
    );
    expectCapped(
      await dialogGeometry(tab1920, 'Welcome to Tab Keeper'),
      'tab view @1920'
    );
  });
});

test.describe('Delete cloud data dialog stays capped in the tab view (KAN-301)', () => {
  test('is 616±1px wide at 1920 in the tab view', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const tab = await openPage(
      context,
      extensionId,
      'index.html?view=tab',
      TAB_1920
    );
    await tab.locator('[aria-label="Settings"]').click();
    await tab.locator('button[aria-label="Sync & Backup"]').click();
    await tab.getByRole('button', { name: 'Delete cloud data' }).click();

    const geo = await dialogGeometry(tab, 'Delete your cloud data?');
    expect(geo.width, 'tab view @1920: width').toBeGreaterThanOrEqual(615);
    expect(geo.width, 'tab view @1920: width').toBeLessThanOrEqual(617);
  });
});
