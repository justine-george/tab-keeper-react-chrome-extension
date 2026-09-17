import type { Locator, Page } from '@playwright/test';

/**
 * The popup's overflow-menu triggers, told apart by WHERE they are.
 *
 * Since KAN-208 three controls in the popup carry the name "More actions" --
 * the save row's menu, the session header's, and a tab group row's. That is
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
 * so position alone does not separate them -- and then excluded from the save
 * row, which carries the same name. Pass the translated name for a non-English
 * run.
 *
 * `[aria-haspopup="menu"]` is what keeps this to the TRIGGER: the open menu
 * takes its accessible name from the same label, so without it this matches
 * the trigger and its own menu as soon as the menu is open, and strict mode
 * refuses the pair.
 */
export const sessionHeaderMenu = (page: Page, name = 'More actions'): Locator =>
  page.locator(
    `[aria-label="${name}"][aria-haspopup="menu"]:not(div:has(> input#name) *)`
  );
