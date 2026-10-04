// KAN-399 on the real artifact: every text field's placeholder is PLACEHOLDER_COLOR, 4.5:1 on its ground.

import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { placeholderPaint } from './fixtures/pixels';
import {
  openSaved,
  savedWindow,
  session,
  THEMES,
} from './fixtures/savedWindows';

const S1 = () => session('S1', 'Source', [savedWindow('w1', 'Reading', 2)]);

const FIELDS: [string, 'popup' | 'tab view', (page: Page) => Locator][] = [
  ['the save field', 'popup', (page) => page.locator('input#name')],
  [
    'the saved-sessions search row',
    'popup',
    (page) => page.locator('[data-saved-search] input'),
  ],
  [
    'the Open now search row',
    'tab view',
    (page) => page.locator('[data-open-now-search] input'),
  ],
];

for (const [theme, colours] of THEMES) {
  for (const [name, view, field] of FIELDS) {
    test(`${view}, ${theme}: ${name}'s placeholder is PLACEHOLDER_COLOR, at least 4.5:1 on its ground`, async ({
      context,
      extensionId,
    }) => {
      const page = await openSaved(context, extensionId, view, {
        sessions: [S1()],
        settings: { theme },
      });
      await expect(field(page)).toBeVisible();
      await expect(field(page)).toHaveValue('');
      const { placeholder, opacity, ground, ratio } = await placeholderPaint(
        field(page)
      );
      console.log(
        `[${theme}] ${name} ${placeholder} on ${ground}: ${ratio.toFixed(2)}:1`
      );
      expect(opacity).toBe('1');
      expect(placeholder).toBe(colours.PLACEHOLDER_COLOR);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
}
