import type { Locator } from '@playwright/test';

import { expect } from './extension';

// KAN-581. A saved row's hover strip covers its right end (up to four buttons), so a
// click meant for the row itself goes on its title, at the row's left.
export const ON_TITLE = { position: { x: 24, y: 12 } } as const;

// KAN-582. A row that is not the one shown gets its actions after 2s on it; resting on the
// title keeps every button clear of the pointer, so none is held back as appeared-under-it.
export async function revealRowActions(row: Locator): Promise<Locator> {
  await row.hover(ON_TITLE);
  const actions = row.locator('[data-row-actions]');
  await expect(actions).toBeVisible({ timeout: 4000 });
  return actions;
}
