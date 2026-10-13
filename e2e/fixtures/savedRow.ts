import type { Locator } from '@playwright/test';

import { expect } from './extension';

// KAN-581. A saved row's hover strip covers its right end, so a click meant for the
// row itself goes on its title, at the row's left.
export const ON_TITLE = { position: { x: 24, y: 12 } } as const;

// KAN-582. Only the session shown has row actions: show this row's session (a click on its
// title, clear of where the strip appears) and wait for them.
export async function showRowActions(row: Locator): Promise<Locator> {
  await row.click(ON_TITLE);
  const actions = row.locator('[data-row-actions]');
  await expect(actions).toBeVisible();
  return actions;
}
