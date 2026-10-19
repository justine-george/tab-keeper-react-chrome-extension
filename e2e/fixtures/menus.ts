import type { Locator, Page } from '@playwright/test';

/**
 * The popup's overflow-menu triggers, told apart by WHERE they are.
 *
 * Since KAN-208 several controls in the popup carry the name "More actions" --
 * the save row's menu, the session header's, a tab group row's, and since
 * KAN-616 every window row's. That is
 * right for a user, who reads each in its own context, but it means a locator
 * written on the name alone matches more than one and Playwright's strict mode
 * refuses it. These scope structurally instead.
 */

/**
 * The save row's menu trigger, in the left pane.
 *
 * Found by the name box it sits beside, so this needs no translated string and
 * keeps working in every locale. `> input#name` is exact: TextBox renders a
 * bare input, so the row div is its direct parent.
 */
export const saveRowMenu = (page: Page): Locator =>
  page.locator('div:has(> input#name) [aria-haspopup="menu"]');

/**
 * The session header's menu trigger, in the right pane.
 *
 * Named, because the sort menu in the left pane header is also a menu trigger,
 * and inside the header's own anchor, because every window row and group band
 * in the pane below carries the same name (KAN-616). Pass the translated name
 * for a non-English run.
 *
 * `[aria-haspopup="menu"]` is what keeps this to the TRIGGER: the open menu
 * takes its accessible name from the same label, so without it this matches
 * the trigger and its own menu as soon as the menu is open, and strict mode
 * refuses the pair.
 */
export const sessionHeaderMenu = (page: Page, name = 'More actions'): Locator =>
  page.locator(
    `[data-tour-anchor="session-menu"] [aria-label="${name}"][aria-haspopup="menu"]`
  );

/**
 * An Open now window's ⋮ trigger (KAN-696), "More actions: Window N", inside
 * that block's own header strip. Pass the translated "More actions" for a
 * non-English run.
 */
export const openNowWindowMenu = (
  _page: Page,
  windowBlock: Locator,
  moreActions = 'More actions'
): Locator =>
  windowBlock
    .locator('[data-window-row] [data-row-actions]')
    .getByRole('button', { name: new RegExp(`^${moreActions}: `) });

/**
 * Closes an Open now window from its ⋮ (KAN-696; it was an inline ×): opens
 * the menu and presses Close window, exactly named.
 */
export async function closeOpenNowWindowFromMenu(
  page: Page,
  windowBlock: Locator,
  names: { moreActions?: string; closeWindow?: string } = {}
): Promise<void> {
  await windowBlock.locator('[data-window-row]').hover();
  await openNowWindowMenu(page, windowBlock, names.moreActions).click();
  await page
    .getByRole('menuitem', {
      name: names.closeWindow ?? 'Close window',
      exact: true,
    })
    .click();
}
