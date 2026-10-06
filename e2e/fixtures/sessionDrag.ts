import type { Locator, Page } from '@playwright/test';

import { boxOf } from './savedWindows';

// Saved-session drags (KAN-350, KAN-394): the store read back and the gesture, shared by every spec that drags a saved row.

export { stored, boxOf } from './savedWindows';

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

// Where a drag is aimed at the save row (KAN-394 P3): its name field's
// centre, read at rest, which every build draws in the same place.
export async function saveRowAim(page: Page): Promise<Point> {
  const b = await boxOf(page.locator('#name'));
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Records, from now on, whether a carry ever marked the document
// (data-carrying, on <html>) and whether a New session target was ever drawn.
// Any write of the marker counts: it starts off, so a write turned it on,
// even if it was turned off again before the observer ran.
export async function watchSaveRow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.documentElement;
    const flags = root.dataset;
    flags.sawCarrying = root.hasAttribute('data-carrying') ? '1' : '0';
    flags.sawSessionTarget = '0';
    const flagTarget = () => {
      const t = document.querySelector('[data-new-session-target]');
      if (
        flags.sawSessionTarget !== '1' &&
        t !== null &&
        getComputedStyle(t).visibility === 'visible'
      )
        flags.sawSessionTarget = '1';
    };
    new MutationObserver(() => {
      flags.sawCarrying = '1';
    }).observe(root, { attributes: true, attributeFilter: ['data-carrying'] });
    // Any <html> attribute can change what the target's styles resolve to.
    new MutationObserver(flagTarget).observe(root, { attributes: true });
    new MutationObserver(flagTarget).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    flagTarget();
  });
}

// What watchSaveRow saw, read two frames on, after every observer has run.
export const saveRowSeen = (page: Page) =>
  page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    const flags = document.documentElement.dataset;
    return { carrying: flags.sawCarrying, target: flags.sawSessionTarget };
  });
