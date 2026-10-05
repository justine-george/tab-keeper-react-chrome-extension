import type { Page } from '@playwright/test';

import { isValidTabMasterContainer } from '../../src/utils/functions/local';

// The run's e2e helpers; Task 7 adds the rest.

export async function storedTitles(page: Page): Promise<string[]> {
  const parsed: unknown = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('tabContainerData') ?? 'null')
  );
  return isValidTabMasterContainer(parsed)
    ? parsed.tabGroups.map((g) => g.title)
    : [];
}
