import type { Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import {
  VIEWS,
  boxOf,
  openSaved,
  savedWindow,
  session,
  type View,
} from './fixtures/savedWindows';
import { standIn } from './fixtures/standInPages';

// KAN-778 beyond the session list: a click outside an open menu runs nothing in any pane.
// Each target counts its runs, so "the next click runs it" also proves the swallowed one never did.

const SESSIONS = [
  session('S1', 'Trip', [savedWindow('w1', 'Reading', 2)]),
  ...['Bravo', 'Charlie'].map((title, i) =>
    session(`S${i + 2}`, title, [savedWindow(`x${i + 2}`, 'Notes', 1)])
  ),
];

const detail = (page: Page) => page.locator('[data-pane="detail"]');
const openNow = (page: Page) => page.locator('[data-pane="open-now"]');
const sessionRow = (page: Page, id: string): Locator =>
  page.locator(
    `[data-pane="sessions"] [data-drag-row-id="${id}"] [data-drag-handle-row]`
  );

async function centreOf(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await boxOf(loc);
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

// A point on a row's title, clear of the strip at its right end.
async function onTitle(row: Locator): Promise<{ x: number; y: number }> {
  const box = await boxOf(row);
  return { x: Math.round(box.x + 60), y: Math.round(box.y + box.height / 2) };
}

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

const MENUS = {
  'header ⋮': {
    open: (page: Page) => sessionHeaderMenu(page).click(),
    menu: (page: Page) =>
      page.locator('[data-tour-anchor="session-menu"] [role="menu"]'),
  },
  'row menu': {
    open: async (page: Page) => {
      const at = await onTitle(sessionRow(page, 'S3'));
      await page.mouse.click(at.x, at.y, { button: 'right' });
    },
    menu: (page: Page) => page.locator('[role="menu"][data-row-menu]'),
  },
};

// Every activation of `tabId` from now on, counted in the worker.
async function countActivations(worker: Worker, tabId: number) {
  await worker.evaluate((id) => {
    let n = 0;
    Reflect.set(globalThis, '__activations', () => n);
    chrome.tabs.onActivated.addListener((info) => {
      if (info.tabId === id) n += 1;
    });
  }, tabId);
  return () =>
    worker.evaluate(() => {
      const read: unknown = Reflect.get(globalThis, '__activations');
      return typeof read === 'function' ? Number(read()) : -1;
    });
}

// Every tab created at `url` from now on, counted in the worker.
async function countCreated(worker: Worker, url: string) {
  await worker.evaluate((want) => {
    let n = 0;
    Reflect.set(globalThis, '__created', () => n);
    chrome.tabs.onCreated.addListener((tab) => {
      if ((tab.pendingUrl ?? tab.url) === want) n += 1;
    });
  }, url);
  return () =>
    worker.evaluate(() => {
      const read: unknown = Reflect.get(globalThis, '__created');
      return typeof read === 'function' ? Number(read()) : -1;
    });
}

interface Target {
  views: readonly View[];
  // Readies the target; returns where it is and how many times it has run.
  ready: (
    page: Page,
    worker: Worker
  ) => Promise<{
    element: Locator;
    runs: () => Promise<number>;
    // Where to click it: its centre unless given.
    at?: () => Promise<{ x: number; y: number }>;
  }>;
}

const TARGETS: Record<string, Target> = {
  "the session header's title (rename)": {
    views: VIEWS,
    ready: async (page) => {
      const element = detail(page).getByRole('button', {
        name: 'Rename session: Trip',
        exact: true,
      });
      return {
        element,
        runs: async () => detail(page).getByRole('textbox').count(),
      };
    },
  },
  'a saved tab (opens it)': {
    views: VIEWS,
    ready: async (page, worker) => {
      const runs = await countCreated(worker, 'https://w1-0.test/');
      const element = detail(page).locator('[data-drag-row-id="w1-t0"]');
      // Its left end: the header ⋮'s menu drops over the rest of the row.
      return {
        element,
        runs,
        at: async () => {
          const box = await boxOf(element);
          return {
            x: Math.round(box.x + 24),
            y: Math.round(box.y + box.height / 2),
          };
        },
      };
    },
  },
  "an Open now window's fold chevron": {
    views: ['tab view'],
    ready: async (page, worker) => {
      await worker.evaluate(
        (urls) => chrome.windows.create({ url: urls, focused: false }),
        [standIn('Alpha'), standIn('Beta')]
      );
      const collapse = openNow(page).getByRole('button', {
        name: /^Collapse: /,
      });
      await expect(collapse).toHaveCount(2);
      const element = collapse.last();
      const name = await element.getAttribute('aria-label');
      const expand = openNow(page).getByRole('button', {
        name: (name ?? '').replace(/^Collapse/, 'Expand'),
        exact: true,
      });
      return { element, runs: () => expand.count() };
    },
  },
  'an Open now tab (switches to it)': {
    views: ['tab view'],
    ready: async (page, worker) => {
      const tabId = await worker.evaluate(
        async (urls) => {
          const win = await chrome.windows.create({
            url: urls,
            focused: false,
          });
          return win?.tabs?.[1]?.id ?? -1;
        },
        [standIn('Alpha'), standIn('Beta')]
      );
      expect(tabId).toBeGreaterThan(0);
      const element = openNow(page).getByRole('button', {
        name: 'Switch to tab: Beta',
        exact: true,
      });
      await expect(element).toBeVisible();
      return { element, runs: await countActivations(worker, tabId) };
    },
  },
};

for (const [targetName, target] of Object.entries(TARGETS)) {
  for (const view of target.views) {
    test(`${view}, no menu (control): a click on ${targetName} runs it once`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await openSaved(context, extensionId, view, {
        sessions: SESSIONS,
      });
      const {
        element,
        runs,
        at: pointAt,
      } = await target.ready(page, serviceWorker);
      expect(await runs()).toBe(0);

      const at = await (pointAt ?? (() => centreOf(element)))();
      await page.mouse.click(at.x, at.y);

      await expect.poll(runs).toBe(1);
    });

    for (const [menuName, menu] of Object.entries(MENUS)) {
      test(`${view}, ${menuName} open: a click on ${targetName} only closes the menu; the next click runs it once`, async ({
        context,
        extensionId,
        serviceWorker,
      }) => {
        const page = await openSaved(context, extensionId, view, {
          sessions: SESSIONS,
        });
        const {
          element,
          runs,
          at: pointAt,
        } = await target.ready(page, serviceWorker);
        await menu.open(page);
        await expect(menu.menu(page)).toBeVisible();
        const at = await (pointAt ?? (() => centreOf(element)))();
        // PREMISE: the point is on the target, not on the menu.
        const handle = await element.elementHandle();
        expect(
          await page.evaluate(
            ({ x, y, el }) => {
              const hit = document.elementFromPoint(x, y);
              return (
                hit !== null &&
                el !== null &&
                el.contains(hit) &&
                hit.closest('[role="menu"]') === null
              );
            },
            { ...at, el: handle }
          )
        ).toBe(true);

        await page.mouse.click(at.x, at.y);

        await expect(menu.menu(page)).toHaveCount(0);
        await settle(page);
        expect(await runs()).toBe(0);

        await page.mouse.click(at.x, at.y);
        await expect.poll(runs).toBe(1);
      });
    }
  }
}
