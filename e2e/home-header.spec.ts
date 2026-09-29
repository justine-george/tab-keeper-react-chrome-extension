import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions } from './fixtures/seed';
import { waitForFontsLoaded } from './fixtures/fonts';
import { ICON } from '../src/styles/scale';

// KAN-340. The home header's icon row: even glyphs in equal boxes (I1), in
// three pairs 8px apart (A), ordered views | history | account (R1).
//
// Every assertion runs at a 16px root AND a 20px root. 20px is what Chrome's
// Settings > Appearance > Font size "Large" gives an extension page (KAN-312
// measured it), and it is the case a px literal gets wrong while looking
// right at 16px. Setting the root in the page matches the pref, since every
// size here is in rem.

const POPUP_VIEWPORT = { width: 790, height: 550 };
const TAB_VIEWPORT = { width: 1280, height: 800 };

/** In both views, in this order. */
const SHARED = ['Sort sessions', 'Undo', 'Redo', 'Sync now', 'Settings'];
/** The popup adds "Open in a tab" first; the tab view is its destination. */
const POPUP_ORDER = ['Open in a tab', ...SHARED];

const ROOTS = [16, 20] as const;

type Box = { x: number; y: number; width: number; height: number };

async function openHome(
  context: BrowserContext,
  extensionId: string,
  view: 'popup' | 'tab',
  rootPx: 16 | 20
): Promise<Page> {
  await seedSessions(context);
  const page = await context.newPage();
  const viewport = view === 'popup' ? POPUP_VIEWPORT : TAB_VIEWPORT;
  await page.setViewportSize(viewport);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${
      view === 'tab' ? '?view=tab' : ''
    }`
  );
  // Barrier: goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  await waitForFontsLoaded(page);
  await page.evaluate((px) => {
    document.documentElement.style.fontSize = `${px}px`;
  }, rootPx);
  // Park the pointer off the header so no hover fill or rotation is caught.
  await page.mouse.move(2, viewport.height - 2);
  return page;
}

const control = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true });

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`no box for ${locator.toString()}`);
  return box;
}

/** An icon's box: the glyph plus Icon's 4px padding on each side. */
const iconBox = (rootPx: number) => parseFloat(ICON.DEFAULT) * rootPx + 8;

test.describe('every header control has the same box (KAN-340 I1)', () => {
  for (const rootPx of ROOTS) {
    test(`at a ${rootPx}px root, the gear draws smaller in the same box`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', rootPx);

      for (const name of POPUP_ORDER) {
        const box = await boxOf(control(page, name));
        expect
          .soft({ name, width: box.width, height: box.height })
          .toEqual({ name, width: iconBox(rootPx), height: iconBox(rootPx) });
      }
      // The control for the box assertion: the gear really is smaller
      // inside it, so equal boxes are not equal glyphs.
      const gear = control(page, 'Settings').locator(
        '.material-symbols-outlined'
      );
      expect(await gear.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
        `${parseFloat(ICON.SMALL) * rootPx}px`
      );
    });
  }
});
