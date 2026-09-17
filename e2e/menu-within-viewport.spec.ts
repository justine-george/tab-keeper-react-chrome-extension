import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import { saveRowMenu, sessionHeaderMenu } from './fixtures/menus';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-230. An overflow menu stays inside the popup, whatever language it is in.
//
// The menu is end-anchored by default -- `right: 0` against its trigger -- so a
// longer translation can only grow LEFTWARD, and nothing stopped it leaving the
// window. Measured on main @ a66ece8, the sort menu's left edge was -11.4 (es),
// -12.3 (fr) and -6.2 (ru) against a popup whose own left edge is 0, which cut
// off the items' glyph column and the menu's border.
//
// An e2e test because it CANNOT be a component test: OverflowMenu's jsdom suite
// computes no layout at all -- every rect is zero -- so the whole class of bug
// is invisible there. That is why it shipped.
//
// The width is set entirely by the longest translated label (`min-width: 180px`
// and `white-space: nowrap`), so the locales below are the measurement, not a
// sample: es, fr and ru are the three that overflowed, and en is the control
// that never did.

const POPUP = { width: 790, height: 550 };

/** How much of the popup an open menu must leave alone at each edge. */
const GUTTER = 0;

/**
 * Each menu, and how to reach its trigger.
 *
 * The save row's is located structurally rather than by name: since KAN-208 it
 * shares "More actions" with the session header's menu, and a locator on the
 * name alone matches both.
 */
const MENUS = [
  {
    name: 'Sort sessions',
    trigger: (page: Page, strings: Record<string, string>) =>
      page.getByRole('button', {
        name: strings['Sort sessions'],
        exact: true,
      }),
  },
  {
    name: 'save row',
    trigger: (page: Page) => saveRowMenu(page),
  },
  {
    name: 'session header',
    trigger: (page: Page, strings: Record<string, string>) =>
      sessionHeaderMenu(page, strings['More actions']),
  },
] as const;

for (const menu of MENUS) {
  for (const lang of ['en', 'es', 'fr', 'ru']) {
    test(`the ${menu.name} menu stays inside the popup (${lang})`, async ({
      context,
      extensionId,
    }) => {
      const strings = localeStrings(lang);
      // SELECTED, so the right pane renders its header -- which is where one
      // of the three menus lives. An unselected seed leaves that pane empty
      // and the test reads as a missing control.
      await seedSessions(context, {
        ...buildContainer([
          buildSession({ tabGroupId: 's0', isSelected: true }),
        ]),
        selectedTabGroupId: 's0',
      });
      // i18n reads `language` from settingsData at MODULE LOAD, so it has to be
      // seeded before the first render -- which seedSettings does.
      await seedSettings(context, { language: lang });

      const page = await context.newPage();
      await page.setViewportSize(POPUP);
      await page.goto(`chrome-extension://${extensionId}/index.html`);

      const trigger = menu.trigger(page, strings);
      // PREMISE: the control exists under its translated name. Without this a
      // renamed control reads as a passing measurement of nothing.
      await expect(trigger).toBeVisible();
      await trigger.click();

      const box = await page.evaluate(() => {
        const el = document.querySelector('[role="menu"]');
        if (!el) throw new Error('no menu opened');
        const rect = el.getBoundingClientRect();
        // Either role: a menu whose items report a current selection is a
        // radio group, so the sort menu's items are `menuitemradio` while the
        // save row's are `menuitem`. Selecting only the latter finds nothing
        // in the sort menu and the probe dies before it measures anything.
        const first = el.querySelector(
          '[role="menuitem"], [role="menuitemradio"]'
        );
        if (!first) throw new Error('the menu holds no items');
        const item = first.getBoundingClientRect();
        // What the user actually loses when the menu is clipped: the glyph
        // column at the item's left. Sampled a pixel inside the item's own box
        // so a menu that is merely flush with the edge still passes.
        const atGlyph = document.elementFromPoint(
          item.left + 2,
          item.top + item.height / 2
        );
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          glyphColumnIsHittable: first.contains(atGlyph),
        };
      });

      expect(box.left).toBeGreaterThanOrEqual(GUTTER);
      expect(box.right).toBeLessThanOrEqual(POPUP.width - GUTTER);
      expect(box.glyphColumnIsHittable).toBe(true);
      // CONTROL: the menu was measured at its real size, not collapsed. A
      // zero-width menu would satisfy both edge assertions above.
      expect(box.width).toBeGreaterThanOrEqual(180);
    });
  }
}
