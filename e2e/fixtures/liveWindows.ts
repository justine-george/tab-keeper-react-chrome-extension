import type { Locator, Page, Worker } from '@playwright/test';

import { boxOf } from './sessionDrag';

// Live Chrome windows for Currently open specs (KAN-815, KAN-820): opened by the worker, read back, and carried into.

export const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

// A live window of one tab per title, unfocused; Chrome's ids by title.
export async function openLiveWindow(worker: Worker, titles: string[]) {
  const made = await worker.evaluate(async (urls: string[]) => {
    const w = await chrome.windows.create({ focused: false, url: urls });
    const ids = (w?.tabs ?? []).flatMap((t) =>
      t.id === undefined ? [] : [t.id]
    );
    if (w?.id === undefined || ids.length !== urls.length) return null;
    return { windowId: w.id, tabIds: ids };
  }, titles.map(dataUrl));
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  const idOf = (title: string) => {
    const id = made.tabIds[titles.indexOf(title)];
    if (id === undefined) throw new Error(`no tab ${title}`);
    return id;
  };
  return { windowId: made.windowId, idOf };
}

export interface StripTab {
  id: number;
  url: string;
  pinned: boolean;
  groupId: number;
}

// A window's tabs in Chrome's order, at the address each is going to.
export const strip = (worker: Worker, windowId: number): Promise<StripTab[]> =>
  worker.evaluate(async (id: number) => {
    const tabs = await chrome.tabs.query({ windowId: id });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => ({
        id: t.id ?? -1,
        url: t.pendingUrl || t.url || '',
        pinned: t.pinned,
        groupId: t.groupId,
      }));
  }, windowId);

export const tabCount = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.tabs.query({})).length);

export const liveRow = (page: Page, tabId: number) =>
  page.locator(`[data-open-tab-id="${tabId}"]`);

// The point just inside the top of `row`: a release there lands right before it.
export async function topOf(row: Locator) {
  const b = await boxOf(row);
  return { x: b.x + Math.min(80, b.width / 2), y: b.y + 4 };
}

// Into Currently open at `to`, past the hand-off, where an Open now list adopts it.
export async function carryTo(page: Page, to: { x: number; y: number }) {
  await page.mouse.move(to.x, to.y, { steps: 20 });
  // A last small move, so the landing is read at rest.
  await page.mouse.move(to.x, to.y + 1, { steps: 2 });
}
