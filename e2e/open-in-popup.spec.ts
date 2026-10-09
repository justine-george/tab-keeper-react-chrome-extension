import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions } from './fixtures/seed';

// KAN-437. The full view's Open in popup, on the built artifact.
// Tests 1-6 read what the worker did: the full view's tab, and each
// chrome.action.openPopup call, recorded by a stub in the worker.
// Test 7 calls the real openPopup, which opens a popup headless (plan Task 1, Q1/Q2).

const VIEW_TAB = 'index.html?view=tab';
const BUTTON = 'Open in popup';
const INDEX_POPUP = expect.stringMatching(/\/index\.html$/);

interface TabFacts {
  id: number;
  url: string;
  index: number;
  pinned: boolean;
  active: boolean;
  windowId: number;
}

const allTabs = (worker: Worker): Promise<TabFacts[]> =>
  worker.evaluate(() =>
    chrome.tabs.query({}).then((tabs) =>
      tabs.map((t) => ({
        id: t.id ?? -1,
        url: t.url ?? t.pendingUrl ?? '',
        index: t.index,
        pinned: t.pinned,
        active: t.active,
        windowId: t.windowId,
      }))
    )
  );

const viewTabs = async (worker: Worker) =>
  (await allTabs(worker)).filter((t) => t.url.includes(VIEW_TAB));

// Each call's arguments, the popup set then, and how many full views were still open.
async function stubOpenPopup(worker: Worker, refuse: boolean): Promise<void> {
  await worker.evaluate(
    ({ refuseIt, view }) => {
      const calls: { args: unknown[]; popup: string; fullViewsOpen: number }[] =
        [];
      Reflect.set(globalThis, 'openPopupCalls', calls);
      chrome.action.openPopup = async (...args: unknown[]) => {
        const tabs = await chrome.tabs.query({});
        calls.push({
          args,
          popup: await chrome.action.getPopup({}),
          fullViewsOpen: tabs.filter((t) =>
            (t.url ?? t.pendingUrl ?? '').includes(view)
          ).length,
        });
        if (refuseIt) throw new Error('Failed to open popup.');
      };
    },
    { refuseIt: refuse, view: VIEW_TAB }
  );
}

const openPopupCalls = (worker: Worker) =>
  worker.evaluate((): unknown => Reflect.get(globalThis, 'openPopupCalls'));

const popupOf = (worker: Worker) =>
  worker.evaluate(() => chrome.action.getPopup({}));

// The full view's page, once the worker-made tab has drawn the button.
async function fullViewPage(context: BrowserContext): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = context.pages().find((p) => p.url().endsWith(VIEW_TAB));
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error('no full view page');
  await found.getByRole('button', { name: BUTTON, exact: true }).waitFor();
  return found;
}

// A new focused window: `before` other tabs, the full view (active), then `after` other tabs.
async function fullViewIn(
  context: BrowserContext,
  worker: Worker,
  layout: { before: number; after: number; pinned?: boolean }
): Promise<{ page: Page; tab: TabFacts }> {
  await worker.evaluate(
    async ({ before, after, pinned, view }) => {
      const url = [
        ...Array.from(
          { length: before },
          (_, i) => `data:text/html,<title>Before ${i}</title>`
        ),
        chrome.runtime.getURL(view),
        ...Array.from(
          { length: after },
          (_, i) => `data:text/html,<title>After ${i}</title>`
        ),
      ];
      const win = await chrome.windows.create({ url, focused: true });
      const tab = (win?.tabs ?? []).find((t) =>
        (t.pendingUrl ?? t.url ?? '').includes(view)
      );
      if (tab?.id === undefined) throw new Error('no full view tab');
      await chrome.tabs.update(tab.id, {
        active: true,
        ...(pinned ? { pinned: true } : {}),
      });
    },
    {
      before: layout.before,
      after: layout.after,
      pinned: layout.pinned ?? false,
      view: VIEW_TAB,
    }
  );
  const page = await fullViewPage(context);
  const [tab] = await viewTabs(worker);
  if (tab === undefined) throw new Error('no full view tab');
  return { page, tab };
}

// The real button; the worker closes its page right after.
const press = (page: Page) =>
  page.getByRole('button', { name: BUTTON, exact: true }).click();

test.describe('Open in popup (KAN-437)', () => {
  test('1. beside other tabs: the full view closes first, then the popup opens over its window', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await stubOpenPopup(serviceWorker, false);
    const { page, tab } = await fullViewIn(context, serviceWorker, {
      before: 1,
      after: 0,
    });

    await press(page);

    await expect
      .poll(() => openPopupCalls(serviceWorker))
      .toEqual([
        {
          args: [{ windowId: tab.windowId }],
          popup: INDEX_POPUP,
          fullViewsOpen: 0,
        },
      ]);
    expect(await viewTabs(serviceWorker)).toEqual([]);
  });

  test('2. alone in its window: the window goes with it, and the popup names no window', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await stubOpenPopup(serviceWorker, false);
    const { page, tab } = await fullViewIn(context, serviceWorker, {
      before: 0,
      after: 0,
    });
    // PREMISE: another window holds a tab, so this one may close.
    expect(
      (await allTabs(serviceWorker)).some((t) => t.windowId !== tab.windowId)
    ).toBe(true);

    await press(page);

    await expect
      .poll(() => openPopupCalls(serviceWorker))
      .toEqual([{ args: [], popup: INDEX_POPUP, fullViewsOpen: 0 }]);
    expect((await allTabs(serviceWorker)).map((t) => t.windowId)).not.toContain(
      tab.windowId
    );
  });

  test('3. pinned: the full view stays, and the popup opens over it', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await stubOpenPopup(serviceWorker, false);
    const { page, tab } = await fullViewIn(context, serviceWorker, {
      before: 1,
      after: 0,
      pinned: true,
    });
    expect(tab.pinned).toBe(true);

    await press(page);

    await expect
      .poll(() => openPopupCalls(serviceWorker))
      .toEqual([
        {
          args: [{ windowId: tab.windowId }],
          popup: INDEX_POPUP,
          fullViewsOpen: 1,
        },
      ]);
    expect((await viewTabs(serviceWorker)).map((t) => t.id)).toEqual([tab.id]);
  });

  test('4. the only tab Chrome has: it stays, and the popup opens over it', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await stubOpenPopup(serviceWorker, false);
    const { page, tab } = await fullViewIn(context, serviceWorker, {
      before: 0,
      after: 0,
    });
    await serviceWorker.evaluate(async (keep) => {
      const others = (await chrome.windows.getAll({})).flatMap((w) =>
        w.id === undefined || w.id === keep ? [] : [w.id]
      );
      await Promise.all(others.map((id) => chrome.windows.remove(id)));
    }, tab.windowId);
    // PREMISE: the full view is the only tab left.
    await expect
      .poll(async () => (await allTabs(serviceWorker)).map((t) => t.id))
      .toEqual([tab.id]);

    await press(page);

    await expect
      .poll(() => openPopupCalls(serviceWorker))
      .toEqual([
        {
          args: [{ windowId: tab.windowId }],
          popup: INDEX_POPUP,
          fullViewsOpen: 1,
        },
      ]);
    expect((await viewTabs(serviceWorker)).map((t) => t.id)).toEqual([tab.id]);
  });

  test('5. Chrome refuses: the full view comes back at its index, in its window', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await stubOpenPopup(serviceWorker, true);
    const { page, tab } = await fullViewIn(context, serviceWorker, {
      before: 1,
      after: 1,
    });
    expect(tab.index).toBe(1);

    await press(page);

    await expect
      .poll(async () =>
        (await viewTabs(serviceWorker)).map((t) => ({
          reopened: t.id !== tab.id,
          index: t.index,
          windowId: t.windowId,
          active: t.active,
          pinned: t.pinned,
        }))
      )
      .toEqual([
        {
          reopened: true,
          index: 1,
          windowId: tab.windowId,
          active: true,
          pinned: false,
        },
      ]);
    expect(await openPopupCalls(serviceWorker)).toEqual([
      {
        args: [{ windowId: tab.windowId }],
        popup: INDEX_POPUP,
        fullViewsOpen: 0,
      },
    ]);
  });

  test('6. Default view Full: the popup is set for this open, then put back', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await stubOpenPopup(serviceWorker, false);
    const { page, tab } = await fullViewIn(context, serviceWorker, {
      before: 1,
      after: 0,
    });
    // Full as the page's choice leaves it: mirrored, then applied. Set once the
    // full view has drawn, after the worker's startup reapply (plan Task 1, R3),
    // and mirrored so a late reapply would also write ''.
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({ defaultView: 'full' });
      await chrome.action.setPopup({ popup: '' });
    });
    // PREMISE: no popup is set.
    expect(await popupOf(serviceWorker)).toBe('');

    await press(page);

    await expect
      .poll(() => openPopupCalls(serviceWorker))
      .toEqual([
        {
          args: [{ windowId: tab.windowId }],
          popup: INDEX_POPUP,
          fullViewsOpen: 0,
        },
      ]);
    await expect.poll(() => popupOf(serviceWorker)).toBe('');
  });

  test('7. unstubbed: the full view closes and Chrome shows the popup', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    const { page } = await fullViewIn(context, serviceWorker, {
      before: 1,
      after: 0,
    });
    const popups = () =>
      serviceWorker.evaluate(
        async () =>
          (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length
      );
    // PREMISE: no popup is open yet.
    expect(await popups()).toBe(0);

    await press(page);

    await expect
      .poll(async () => (await viewTabs(serviceWorker)).length)
      .toBe(0);
    await expect.poll(popups).toBe(1);
  });
});
