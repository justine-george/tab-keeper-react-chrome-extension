import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { THEMES, POPUP, openPage } from './fixtures/onboarding';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { rgb } from './fixtures/pixels';

// KAN-668. borderContrast.test.ts holds the two edge tokens apart; this holds
// each surface to the one it should draw, which is the only thing that catches
// a control still drawing the panel frame (or the reverse) while both tokens
// pass. One panel and the controls next to it, on each screen it visits.

const TOP = 'border-top-color';

async function openSettings(page: Page, category: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator(`button[aria-label="${category}"]`).click();
}

for (const [theme, C] of THEMES) {
  test.describe(theme, () => {
    test.beforeEach(async ({ context }) => {
      await seedSessions(context, buildContainer());
    });

    test('home: the pane is a panel, the name field and save group are controls', async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, { theme });
      const page = await openPage(context, extensionId, 'index.html', POPUP);
      await expect(page.locator('[data-pane="sessions"]')).toHaveCSS(
        TOP,
        rgb(C.PANEL_BORDER_COLOR)
      );
      await expect(page.locator('input#name')).toHaveCSS(
        TOP,
        rgb(C.CONTROL_BORDER_COLOR)
      );
      // The box around Save all and its ⋮, and the line between the two.
      const group = page.locator('[data-tour-anchor="save"] > div').filter({
        has: page.getByRole('button', {
          name: 'Save all open windows as a session',
          exact: true,
        }),
      });
      await expect(group).toHaveCSS(TOP, rgb(C.CONTROL_BORDER_COLOR));
      await expect(group.locator('[aria-label="More actions"]')).toHaveCSS(
        'border-left-color',
        rgb(C.CONTROL_BORDER_COLOR)
      );
    });

    test('Quick access: the keycaps are panels, the shortcut button is a control', async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, { theme });
      // The binding Chrome reports, fixed so the row always draws caps.
      await context.addInitScript(() => {
        const c = Reflect.get(globalThis, 'chrome');
        const commands = c && Reflect.get(c, 'commands');
        if (commands) {
          Reflect.set(commands, 'getAll', () =>
            Promise.resolve([{ name: '_execute_action', shortcut: '⌥⇧K' }])
          );
        }
      });
      const page = await openPage(context, extensionId, 'index.html', POPUP);
      await openSettings(page, 'Quick access');
      const cap = page.getByTestId('popup-shortcut').locator('kbd').last();
      await expect(cap).toHaveText('K');
      await expect(cap).toHaveCSS(TOP, rgb(C.PANEL_BORDER_COLOR));
      await expect(
        page.getByRole('button', { name: 'Change or remove shortcut' })
      ).toHaveCSS(TOP, rgb(C.CONTROL_BORDER_COLOR));
    });

    test('Sync & backup: the segmented control is a control; the dialog is a panel, its Not now a control', async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, {
        theme,
        cloudConsent: 'declined',
        isAutoSync: false,
      });
      const page = await openPage(context, extensionId, 'index.html', POPUP);
      await openSettings(page, 'Sync & backup');
      const autoSync = page.getByRole('group', {
        name: 'Auto sync',
        exact: true,
      });
      await expect(autoSync).toHaveCSS(TOP, rgb(C.CONTROL_BORDER_COLOR));
      await autoSync.getByRole('button', { name: 'On', exact: true }).click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toHaveCSS(TOP, rgb(C.PANEL_BORDER_COLOR));
      await expect(
        dialog.getByRole('button', { name: 'Not now', exact: true })
      ).toHaveCSS(TOP, rgb(C.CONTROL_BORDER_COLOR));
    });
  });
}
