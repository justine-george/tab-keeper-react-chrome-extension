import type { Locator, Page } from '@playwright/test';

import type { TabMasterContainer } from '../../src/redux/slices/tabContainerDataStateSlice';
import { isValidTabMasterContainer } from '../../src/utils/functions/local';

// Saved-session drags (KAN-350, KAN-394): the store read back and the gesture, shared by every spec that drags a saved row.

export async function stored(page: Page): Promise<TabMasterContainer> {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  if (!isValidTabMasterContainer(parsed)) {
    throw new Error(`tabContainerData is not a container: ${raw}`);
  }
  return parsed;
}

export async function boxOf(loc: Locator) {
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`no box for ${loc.toString()}`);
  return b;
}

export interface Point {
  x: number;
  y: number;
}

// Presses `handle` and drags it past the activation distance, inside the pane.
export async function pickUp(page: Page, handle: Locator): Promise<Point> {
  const b = await boxOf(handle);
  const x = b.x + Math.min(60, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  return { x, y: y + 8 };
}

export const tabHandle = (page: Page, tabId: string) =>
  page.locator(`[data-drag-row-id="${tabId}"]`);
export const groupHandle = (page: Page, groupId: string) =>
  page.locator(
    `[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
  );
export const windowHandle = (page: Page, windowId: string) =>
  page.locator(`[data-drag-row-id="${windowId}"] [data-window-drag-handle]`);
