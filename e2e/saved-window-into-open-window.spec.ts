import type { Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { openTabView, session, tab, win } from './fixtures/betweenSessions';
import { allowInIncognito } from './fixtures/incognito';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  strip,
} from './fixtures/liveWindows';
import { boxOf, pickUp, stored, windowHandle } from './fixtures/sessionDrag';
import type {
  tabContainerData,
  tabData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-892 D on the real artifact: a saved window carried over an open window
// in Currently open lights that whole window, and a release adds its tabs to
// the end of it by Open's rules, with nothing taking focus: every new tab
// inactive, the window's active tab unchanged, Tab Keeper still in front. The
// New window box below the list still makes a new window. The saved session
// never changes; no toast, no Undo.
//
// Every live tab is a data: page in a window the worker opens unfocused, so
// the tab view stays the page under the pointer. Side by side at 1280x800.

const CARD = '[data-carry-card]';
const BADGE = `${CARD} [data-carry-card-badge]`;
const LAST_BOX = '[data-new-window-target="open-now-last"]';
// generatePlaceholderURL's prefix; a live tab here is never base64.
const PLACEHOLDER = 'data:text/html;base64,';
const SETTLE = { timeout: 15_000 };

// S1 w1: s0 (pinned), s1, s2, then group "Day trips" (g0, g1), saved at https
// addresses so a placeholder and a real page are told apart. No saved active
// tab: Open's target is the first unpinned tab, s1.
const PINNED: tabData = { ...tab('s0'), pinned: true };
const SAVED = (): tabContainerData =>
  session('S1', 'Trip', [
    win(
      'w1',
      [PINNED, tab('s1'), tab('s2'), tab('g0', 'day'), tab('g1', 'day')],
      [{ groupId: 'day', title: 'Day trips', color: 'green' }]
    ),
  ]);

const block = (page: Page, windowId: number) =>
  page.locator(`[data-pane="open-now"] [data-open-window-id="${windowId}"]`);
const windowRow = (page: Page, windowId: number) =>
  block(page, windowId).locator('[data-window-row]');

// What "nothing was switched to" reads: every window's active tab, and the
// window Chrome last focused.
const focusNow = (worker: Worker) =>
  worker.evaluate(async () => {
    const active = await chrome.tabs.query({ active: true });
    const last = await chrome.windows.getLastFocused();
    return {
      active: active.map((t) => `${t.windowId}:${t.id}`).sort(),
      lastFocused: last.id,
    };
  });

const windowIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({ windowTypes: ['normal'] })).map(
      (w) => w.id ?? -1
    )
  );

// A strip's addresses, a placeholder named as one.
const addresses = async (worker: Worker, windowId: number) =>
  (await strip(worker, windowId)).map((t) =>
    t.url.startsWith(PLACEHOLDER) ? 'placeholder' : t.url
  );

const toastCount = (page: Page) =>
  page
    .locator('[role="status"] [data-toast]:not([aria-hidden="true"])')
    .count();

async function middleOf(el: Locator) {
  const b = await boxOf(el);
  return { x: b.x + Math.min(80, b.width / 2), y: b.y + b.height / 2 };
}

async function setUp(
  context: Parameters<typeof openTabView>[0],
  extensionId: string
) {
  const view = await openTabView(context, extensionId, false, [SAVED()]);
  await expect(windowHandle(view, 'w1')).toBeVisible();
  return view;
}

test('held over an open window, that window lights and New window does not', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(liveRow(page, live.idOf('B'))));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  await expect(page.locator(LAST_BOX)).not.toHaveAttribute('data-landing', '');
  await expect(page.locator(BADGE)).toBeVisible();
  // Its header counts too.
  await carryTo(page, await middleOf(windowRow(page, live.windowId)));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');

  // Below the last window: the New window box lights instead.
  await carryTo(page, await middleOf(page.locator(LAST_BOX)));
  await expect(page.locator(LAST_BOX)).toHaveAttribute('data-landing', '');
  await expect(block(page, live.windowId)).not.toHaveAttribute(
    'data-landing',
    ''
  );
  // One look: the drop box's landing fill, on the whole block.
  await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  const fill = await block(page, live.windowId).evaluate(
    (el) => getComputedStyle(el).backgroundColor
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(block(page, live.windowId)).not.toHaveAttribute(
    'data-landing',
    ''
  );
  expect(fill).not.toBe('rgba(0, 0, 0, 0)');
});

test('a release adds the tabs at its end, inactive; focus and the active tab are unchanged; the session is unchanged', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();
  const before = await stored(page);
  const focus = await focusNow(worker);
  const windowsBefore = await windowIds(worker);

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  await page.mouse.up();

  // The pinned tab to the pinned run (none here, so first); the rest at the
  // end; Open's target (s1) loads, the others wait as placeholders.
  await expect
    .poll(() => addresses(worker, live.windowId), SETTLE)
    .toEqual([
      'placeholder',
      dataUrl('A'),
      dataUrl('B'),
      'https://s1.test/',
      'placeholder',
      'placeholder',
      'placeholder',
    ]);
  expect(await focusNow(worker)).toEqual(focus);
  expect(await windowIds(worker)).toEqual(windowsBefore);
  // Kept: nothing takes it later either.
  await page.waitForTimeout(1000);
  expect(await focusNow(worker)).toEqual(focus);
  expect(await stored(page)).toEqual(before);
  expect(await toastCount(page)).toBe(0);
});

// Review carry from Task 2: the window's last tab grouped -- appended tabs must not join that group.
test('pinned and grouped saved tabs land as Open lands them', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['P', 'A', 'X']);
  await worker.evaluate(
    async ({ p, x, windowId }) => {
      await chrome.tabs.update(p, { pinned: true });
      // In its own window: without one, Chrome groups it into the last focused window.
      const g = await chrome.tabs.group({
        tabIds: [x],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(g, { title: 'Live', color: 'red' });
    },
    { p: live.idOf('P'), x: live.idOf('X'), windowId: live.windowId }
  );
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('X'))).toBeVisible();
  // PREMISE: X grouped in its own window, last.
  expect(
    (await strip(worker, live.windowId)).map(
      (t) => t.id === live.idOf('X') && t.groupId !== -1
    )
  ).toEqual([false, false, true]);

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, live.windowId)).length, SETTLE)
    .toBe(8);
  const groupOf = (id: number) =>
    worker.evaluate(async (g: number) => {
      if (g === -1) return null;
      const group = await chrome.tabGroups.get(g);
      return {
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      };
    }, id);
  const rows = async () =>
    Promise.all(
      (await strip(worker, live.windowId)).map(async (t) => ({
        at: t.url.startsWith(PLACEHOLDER) ? 'placeholder' : t.url,
        pinned: t.pinned,
        group: (await groupOf(t.groupId))?.title ?? null,
      }))
    );
  // Polled: a real page's address is set a moment after the tab is made.
  await expect.poll(rows).toEqual([
    { at: dataUrl('P'), pinned: true, group: null },
    { at: 'placeholder', pinned: true, group: null },
    { at: dataUrl('A'), pinned: false, group: null },
    { at: dataUrl('X'), pinned: false, group: 'Live' },
    { at: 'https://s1.test/', pinned: false, group: null },
    { at: 'placeholder', pinned: false, group: null },
    { at: 'placeholder', pinned: false, group: 'Day trips' },
    { at: 'placeholder', pinned: false, group: 'Day trips' },
  ]);
  const tabs = await strip(worker, live.windowId);
  // The saved group is Chrome's own again, its look kept; the live one is untouched.
  expect(tabs[6]?.groupId).toBe(tabs[7]?.groupId);
  expect(tabs[6]?.groupId).not.toBe(tabs[3]?.groupId);
  expect(await groupOf(tabs[6]?.groupId ?? -1)).toEqual({
    title: 'Day trips',
    color: 'green',
    collapsed: false,
  });
});

test('an incognito open window is no target for a normal saved window: New window lights', async ({
  context,
  extensionId,
}) => {
  const worker = await allowInIncognito(context, extensionId);
  const normal = await openLiveWindow(worker, ['A']);
  const page = await setUp(context, extensionId);
  expect(
    await page.evaluate(() => chrome.extension.isAllowedIncognitoAccess())
  ).toBe(true);
  const opened = await page.evaluate(async (url: string) => {
    const w = await chrome.windows.create({
      focused: false,
      incognito: true,
      url,
    });
    return { windowId: w?.id ?? null, tabId: w?.tabs?.[0]?.id ?? null };
  }, dataUrl('Private'));
  if (opened.tabId === null || opened.windowId === null) {
    throw new Error('no incognito tab');
  }
  await expect(liveRow(page, opened.tabId)).toBeVisible();
  // PREMISE: Open now marks it incognito.
  await expect(block(page, opened.windowId)).toHaveAttribute(
    'data-window-incognito',
    ''
  );
  const windowsBefore = await windowIds(worker);

  await pickUp(page, windowHandle(page, 'w1'));
  // CONTROL: the normal window takes it.
  await carryTo(page, await middleOf(liveRow(page, normal.idOf('A'))));
  await expect(block(page, normal.windowId)).toHaveAttribute(
    'data-landing',
    ''
  );
  await carryTo(page, await middleOf(liveRow(page, opened.tabId)));
  await expect(page.locator(LAST_BOX)).toHaveAttribute('data-landing', '');
  await expect(block(page, opened.windowId)).not.toHaveAttribute(
    'data-landing',
    ''
  );
  await expect(block(page, normal.windowId)).not.toHaveAttribute(
    'data-landing',
    ''
  );
  await page.mouse.up();

  // A new window, as the box says; the incognito window gets nothing.
  await expect
    .poll(async () => (await windowIds(worker)).length, SETTLE)
    .toBe(windowsBefore.length + 1);
  const made = (await windowIds(worker)).find(
    (id) => !windowsBefore.includes(id)
  );
  if (made === undefined) throw new Error('no new window');
  await expect.poll(async () => (await strip(worker, made)).length).toBe(5);
  expect(
    await worker.evaluate(
      async (id) => (await chrome.windows.get(id)).incognito,
      made
    )
  ).toBe(false);
  expect((await strip(worker, opened.windowId)).length).toBe(1);
  expect((await strip(worker, normal.windowId)).length).toBe(1);
});

// Review Focus 4.
test("Tab Keeper's own window takes it, and Tab Keeper stays the current tab", async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const page = await setUp(context, extensionId);
  const own = await page.evaluate(async () => {
    const t = await chrome.tabs.getCurrent();
    return { windowId: t?.windowId ?? -1, tabId: t?.id ?? -1 };
  });
  await expect(windowRow(page, own.windowId)).toBeVisible();
  const countBefore = (await strip(worker, own.windowId)).length;
  const focus = await focusNow(worker);
  // PREMISE: Tab Keeper is the current tab of its window.
  expect(focus.active).toContain(`${own.windowId}:${own.tabId}`);

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(windowRow(page, own.windowId)));
  await expect(block(page, own.windowId)).toHaveAttribute('data-landing', '');
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, own.windowId)).length, SETTLE)
    .toBe(countBefore + 5);
  await expect
    .poll(async () => {
      const urls = await addresses(worker, own.windowId);
      return [urls[0], ...urls.slice(-4)];
    })
    .toEqual([
      'placeholder',
      'https://s1.test/',
      'placeholder',
      'placeholder',
      'placeholder',
    ]);
  expect(await focusNow(worker)).toEqual(focus);
  await page.waitForTimeout(1000);
  expect(await focusNow(worker)).toEqual(focus);
  // The page under the pointer is still Tab Keeper's.
  await expect(windowHandle(page, 'w1')).toBeVisible();
});

test('folded, the open window still takes it', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();
  await block(page, live.windowId)
    .getByRole('button', { name: /^Collapse: / })
    .click();
  // PREMISE: folded, its rows gone.
  await expect(liveRow(page, live.idOf('A'))).toHaveCount(0);

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(windowRow(page, live.windowId)));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  await expect(page.locator(LAST_BOX)).not.toHaveAttribute('data-landing', '');
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, live.windowId)).length, SETTLE)
    .toBe(7);
});

// The worst path: the lit window is gone by the release. The worker opens the
// saved window as a new window instead (never drops it), and nothing takes focus.
test('the window closed mid-carry: the saved window opens in a new window, unfocused, nothing lost', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();
  const before = await stored(page);
  const focus = await focusNow(worker);
  const windowsBefore = await windowIds(worker);

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  await worker.evaluate(
    (id: number) => chrome.windows.remove(id),
    live.windowId
  );
  // PREMISE: gone in Chrome, still drawn lit (Open now reads nothing while a drag is held).
  await expect
    .poll(async () => (await windowIds(worker)).includes(live.windowId))
    .toBe(false);
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  await page.mouse.up();

  const others = windowsBefore.filter((id) => id !== live.windowId);
  await expect
    .poll(async () => (await windowIds(worker)).length, SETTLE)
    .toBe(others.length + 1);
  const made = (await windowIds(worker)).find((id) => !others.includes(id));
  if (made === undefined) throw new Error('no new window');
  await expect.poll(async () => (await strip(worker, made)).length).toBe(5);
  await page.waitForTimeout(1000);
  expect((await focusNow(worker)).lastFocused).toBe(focus.lastFocused);
  expect(await stored(page)).toEqual(before);
});
