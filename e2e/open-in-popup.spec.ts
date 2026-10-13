import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';

// KAN-437. The full view's Open compact view, on the built artifact.
// Tests 1-6 read what the worker did: the full view's tab, and each
// chrome.action.openPopup call, recorded by a stub in the worker.
// Test 7 calls the real openPopup, which opens a popup headless (plan Task 1, Q1/Q2).

const VIEW_TAB = 'index.html?view=tab';
const BUTTON = 'Open compact view';
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
        url: t.url || t.pendingUrl || '',
        index: t.index,
        pinned: t.pinned,
        active: t.active,
        windowId: t.windowId,
      }))
    )
  );

const viewTabs = async (worker: Worker) =>
  (await allTabs(worker)).filter((t) => t.url.includes(VIEW_TAB));

// Samples for `ms`: the most full views open at any one read.
async function mostFullViewsWithin(worker: Worker, ms: number) {
  let most = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    most = Math.max(most, (await viewTabs(worker)).length);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return most;
}

const windowIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({})).map((w) => w.id ?? -1)
  );

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
            (t.url || t.pendingUrl || '').includes(view)
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

test.describe('Open compact view (KAN-437)', () => {
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
    // No reopen after a successful open; a success sends no "done" event, so the hold is a fixed 1s.
    expect(await mostFullViewsWithin(serviceWorker, 1000)).toBe(0);
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
    await expect
      .poll(() => windowIds(serviceWorker))
      .not.toContain(tab.windowId);
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
    // Full as the page's choice leaves it: stored, then applied; the premise reads it before the press.
    // The press waits for the worker's startup reapply (R9), which reads this store, so it writes '' before the open, never inside it.
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
    // No reopen after a successful open; a success sends no "done" event, so the hold is a fixed 1s.
    expect(await mostFullViewsWithin(serviceWorker, 1000)).toBe(0);
  });
});

// KAN-507. Open compact view goes back to the tab the full view was opened from.
test.describe('Open compact view goes back (KAN-507)', () => {
  // A focused window [A, B, C] with B active. ⤢ puts the full view at index 0, so Chrome alone would land on A.
  async function windowOnB(worker: Worker) {
    return worker.evaluate(async () => {
      const win = await chrome.windows.create({
        url: ['A', 'B', 'C'].map((t) => `data:text/html,<title>${t}</title>`),
        focused: true,
      });
      const [a, b, c] = (win?.tabs ?? []).map((t) => t.id ?? -1);
      if (win?.id === undefined) throw new Error('no window');
      await chrome.tabs.update(b, { active: true });
      return { windowId: win.id, a, b, c };
    });
  }
  // What the popup's ⤢ sends: its own window's id. Headless has no toolbar popup, so a page in
  // another window sends it; opened first, as a new page lands in the focused window.
  async function senderPage(context: BrowserContext, extensionId: string) {
    const sender = await context.newPage();
    await sender.goto(`chrome-extension://${extensionId}/index.html`);
    return sender;
  }
  async function pressOpenFullView(
    context: BrowserContext,
    sender: Page,
    windowId: number
  ) {
    await sender.evaluate((id) => {
      void chrome.runtime
        .sendMessage({ type: 'openInTab', windowId: id })
        .catch(() => undefined);
    }, windowId);
    return fullViewPage(context);
  }
  const activeIn = (worker: Worker, windowId: number) =>
    worker.evaluate(
      async (id) =>
        (await chrome.tabs.query({ active: true, windowId: id }))[0]?.id,
      windowId
    );

  test('8. ⤢ on B, then Open compact view: back on B, the popup over its window', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSessions(context);
    const sender = await senderPage(context, extensionId);
    const w = await windowOnB(serviceWorker);
    const page = await pressOpenFullView(context, sender, w.windowId);
    const [fullView] = await viewTabs(serviceWorker);
    // PREMISE: the full view opened in B's window, in front, at index 0.
    expect(fullView).toMatchObject({
      windowId: w.windowId,
      index: 0,
      active: true,
    });
    await stubOpenPopup(serviceWorker, false);

    await press(page);

    await expect
      .poll(() => openPopupCalls(serviceWorker))
      .toEqual([
        {
          args: [{ windowId: w.windowId }],
          popup: INDEX_POPUP,
          fullViewsOpen: 0,
        },
      ]);
    expect(await activeIn(serviceWorker, w.windowId)).toBe(w.b);
  });

  test('9. ⤢ on B, then a visit to C and back: Open compact view lands on C', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSessions(context);
    const sender = await senderPage(context, extensionId);
    const w = await windowOnB(serviceWorker);
    const page = await pressOpenFullView(context, sender, w.windowId);
    const [fullView] = await viewTabs(serviceWorker);
    await serviceWorker.evaluate(
      async ({ c, fv }) => {
        await chrome.tabs.update(c, { active: true });
        await chrome.tabs.update(fv, { active: true });
      },
      { c: w.c, fv: fullView.id }
    );
    // PREMISE: the worker has recorded both switches.
    await expect
      .poll(() =>
        serviceWorker.evaluate(
          async (id) =>
            (await chrome.storage.session.get(`recentTabs.${id}`))[
              `recentTabs.${id}`
            ],
          w.windowId
        )
      )
      .toEqual(expect.arrayContaining([fullView.id, w.c]));
    await stubOpenPopup(serviceWorker, false);

    await press(page);

    await expect.poll(() => openPopupCalls(serviceWorker)).toHaveLength(1);
    expect(await activeIn(serviceWorker, w.windowId)).toBe(w.c);
  });

  test('10. unstubbed: back on B, and Chrome’s popup opens and stays open', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSessions(context);
    const sender = await senderPage(context, extensionId);
    const w = await windowOnB(serviceWorker);
    const page = await pressOpenFullView(context, sender, w.windowId);
    const popups = () =>
      serviceWorker.evaluate(
        async () =>
          (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length
      );
    // PREMISE: no popup is open yet.
    expect(await popups()).toBe(0);

    await press(page);

    await expect.poll(popups).toBe(1);
    expect(await activeIn(serviceWorker, w.windowId)).toBe(w.b);
    // A popup opened before the switch or the close would die with it (KAN-437); this one stays.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await popups()).toBe(1);
  });

  // KAN-509. Default view Full, as the page's setting and the worker's store both hold it.
  async function defaultViewFull(
    context: BrowserContext,
    worker: Worker
  ): Promise<void> {
    await seedSettings(context, { defaultView: 'full' });
    // After the worker's start-up reapplies: one that read compact before this write would land last (KAN-518).
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ defaultView: 'full' });
      const applied: unknown = Reflect.get(
        globalThis,
        'tabKeeperDefaultViewApplied'
      );
      if (typeof applied !== 'function')
        throw new Error('no tabKeeperDefaultViewApplied');
      await applied();
      await chrome.action.setPopup({ popup: '' });
    });
  }
  // The left header's Back; Open now's header has its own since KAN-577.
  const backButton = (page: Page) =>
    page
      .getByRole('button', { name: 'Back to last tab', exact: true })
      .and(page.locator(':not([data-open-now-header] *)'));
  // The full view's page, once it has drawn Back.
  async function fullViewWithBack(context: BrowserContext): Promise<Page> {
    let found: Page | undefined;
    await expect
      .poll(() => {
        found = context.pages().find((p) => p.url().endsWith(VIEW_TAB));
        return found !== undefined;
      })
      .toBe(true);
    if (found === undefined) throw new Error('no full view page');
    await backButton(found).waitFor();
    return found;
  }

  test('11. Default view Full: the toolbar on B, then Back: back on B, the full view closed, no popup', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await defaultViewFull(context, serviceWorker);
    const w = await windowOnB(serviceWorker);
    // The toolbar click (Default view Full): the harness cannot click the toolbar, so it calls the worker's handler.
    await serviceWorker.evaluate(async (windowId) => {
      const click = Reflect.get(globalThis, 'tabKeeperToolbarClick');
      if (typeof click !== 'function') throw new Error('no toolbar hook');
      await click({ windowId });
    }, w.windowId);
    const page = await fullViewWithBack(context);
    // PREMISE: the full view opened in B's window, in front, with no Open compact view.
    expect((await viewTabs(serviceWorker))[0]).toMatchObject({
      windowId: w.windowId,
      active: true,
    });
    await expect(
      page.getByRole('button', { name: BUTTON, exact: true })
    ).toHaveCount(0);
    await stubOpenPopup(serviceWorker, false);

    await expect(backButton(page)).not.toHaveAttribute('aria-disabled');
    await backButton(page).click();

    await expect
      .poll(async () => (await viewTabs(serviceWorker)).length)
      .toBe(0);
    expect(await activeIn(serviceWorker, w.windowId)).toBe(w.b);
    // No popup, and Default view stays Full.
    expect(await openPopupCalls(serviceWorker)).toEqual([]);
    expect(await popupOf(serviceWorker)).toBe('');
  });

  test('12. Default view Full: a pinned full view alone in its window has nowhere to go; a tab used beside it brings Back to life', async ({
    context,
    serviceWorker,
  }) => {
    await seedSessions(context);
    await defaultViewFull(context, serviceWorker);
    const windowId = await serviceWorker.evaluate(async (view) => {
      const win = await chrome.windows.create({
        url: chrome.runtime.getURL(view),
        focused: true,
      });
      const tab = win?.tabs?.[0];
      if (win?.id === undefined || tab?.id === undefined)
        throw new Error('no window');
      await chrome.tabs.update(tab.id, { pinned: true });
      return win.id;
    }, VIEW_TAB);
    const page = await fullViewWithBack(context);

    await expect(backButton(page)).toHaveAttribute('aria-disabled', 'true');

    // A tab opened beside it and used, then back to the full view.
    const fullViewId = await serviceWorker.evaluate(async (id) => {
      const [view] = await chrome.tabs.query({ windowId: id, pinned: true });
      const other = await chrome.tabs.create({
        windowId: id,
        url: 'data:text/html,<title>Other</title>',
        active: true,
      });
      if (view?.id === undefined || other.id === undefined)
        throw new Error('no tabs');
      await chrome.tabs.update(view.id, { active: true });
      return view.id;
    }, windowId);
    await expect(backButton(page)).not.toHaveAttribute('aria-disabled');
    // PREMISE: the same full view, still pinned.
    expect(
      (await viewTabs(serviceWorker)).find((t) => t.id === fullViewId)
    ).toMatchObject({ pinned: true });
  });
});
