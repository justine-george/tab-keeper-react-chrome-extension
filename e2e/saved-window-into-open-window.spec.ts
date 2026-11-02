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
  extensionId: string,
  saved: tabContainerData = SAVED()
) {
  const view = await openTabView(context, extensionId, false, [saved]);
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

// KAN-855 + R15. On a list that scrolls, the New window box lit from the header
// pins over the bottom of the list; the pointer moved onto it keeps it lit,
// and the window drawn beneath it does not take the carry.
// Scrolled while lit too: pinned, the box holds its place in the pane, so
// the place read as it lit is still where it is.
for (const scrolled of [false, true]) {
  test(`the pinned New window box over a window block keeps the carry: lit, the block beneath unlit, a new window on release${scrolled ? ' (list scrolled while lit)' : ''}`, async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = [];
    for (let w = 0; w < 6; w++)
      live.push(
        await openLiveWindow(worker, [`W${w} a`, `W${w} b`, `W${w} c`])
      );
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live[5]?.idOf('W5 c') ?? -1)).toBeAttached();
    const scroller = page.locator(
      '[data-pane="open-now"] [data-open-now-scroller]'
    );
    const box = page.locator(LAST_BOX);
    const litBlocks = page.locator(
      '[data-pane="open-now"] [data-open-window-id][data-landing]'
    );
    const windowsBefore = await windowIds(worker);
    const before = await Promise.all(
      live.map(async (w) => (await strip(worker, w.windowId)).length)
    );

    await pickUp(page, windowHandle(page, 'w1'));
    await carryTo(
      page,
      await middleOf(liveRow(page, live[0]?.idOf('W0 b') ?? -1))
    );
    await carryTo(
      page,
      await middleOf(
        page.locator('[data-pane="open-now"] [data-open-now-header] h2')
      )
    );
    await expect(box).toHaveAttribute('data-landing', '');
    if (scrolled)
      await scroller.evaluate((el) => {
        el.scrollTop = 150;
      });
    // PREMISE: the list scrolls, and the pinned box is drawn over a window block.
    expect(
      await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
    ).toBeGreaterThan(100);
    const aim = await middleOf(box);
    const beneath = await page.evaluate(
      ({ x, y }) =>
        [
          ...document.querySelectorAll(
            '[data-pane="open-now"] [data-open-window-id]'
          ),
        ]
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return x >= b.left && x < b.right && y >= b.top && y < b.bottom;
          })
          .map((el) => el.getAttribute('data-open-window-id')),
      aim
    );
    expect(beneath).toHaveLength(1);

    await carryTo(page, aim);
    await expect(box).toHaveAttribute('data-landing', '');
    await expect(litBlocks).toHaveCount(0);
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
    await page.mouse.up();

    await expect
      .poll(async () => (await windowIds(worker)).length, SETTLE)
      .toBe(windowsBefore.length + 1);
    const made = (await windowIds(worker)).find(
      (id) => !windowsBefore.includes(id)
    );
    if (made === undefined) throw new Error('no new window');
    await expect.poll(async () => (await strip(worker, made)).length).toBe(5);
    // No open window took any of it.
    expect(
      await Promise.all(
        live.map(async (w) => (await strip(worker, w.windowId)).length)
      )
    ).toEqual(before);
    // PREMISE: the aim was held where the test put the list.
    expect(scrollBefore).toBe(scrolled ? 150 : 0);
  });
}

// R16. While a saved window is over a window block of a list that scrolls, the
// New window box is still in sight: pinned at the list's bottom, unlit
// (dashed, named), the block under the pointer lit.
test('over a window block on a long list, the New window box shows pinned and unlit', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = [];
  for (let w = 0; w < 6; w++)
    live.push(await openLiveWindow(worker, [`W${w} a`, `W${w} b`, `W${w} c`]));
  const page = await setUp(context, extensionId);
  const first = live[0];
  if (first === undefined) throw new Error('no live windows');
  await expect(liveRow(page, live[5]?.idOf('W5 c') ?? -1)).toBeAttached();
  const scroller = page.locator(
    '[data-pane="open-now"] [data-open-now-scroller]'
  );
  const box = page.locator(LAST_BOX);

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(liveRow(page, first.idOf('W0 b'))));
  await expect(block(page, first.windowId)).toHaveAttribute('data-landing', '');
  // PREMISE: the list scrolls, from its top.
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  expect(
    await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
  ).toBeGreaterThan(100);

  await expect(box).not.toHaveAttribute('data-landing', '');
  await expect(box).toBeVisible();
  await expect(box.getByText('New window')).toBeVisible();
  const look = await page.evaluate(
    ({ scroller, box }) => {
      const v = document.querySelector(scroller)?.getBoundingClientRect();
      const el = document.querySelector(box);
      const b = el?.getBoundingClientRect();
      if (!v || !el || !b) return null;
      return {
        inView: b.top >= v.top - 1 && b.bottom <= v.bottom + 1,
        border: getComputedStyle(el).borderTopStyle,
      };
    },
    {
      scroller: '[data-pane="open-now"] [data-open-now-scroller]',
      box: LAST_BOX,
    }
  );
  expect(look).toEqual({ inView: true, border: 'dashed' });
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

// The list scrolled before the pick-up: the window drawn under the pointer
// lights and takes the tabs, not one a scroll's distance away.
test('the list already scrolled at pick-up: the window under the pointer lights and takes the tabs', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = [];
  for (let w = 0; w < 8; w++)
    live.push(await openLiveWindow(worker, [`W${w} a`, `W${w} b`, `W${w} c`]));
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live[7]?.idOf('W7 c') ?? -1)).toBeAttached();
  const scroller = page.locator(
    '[data-pane="open-now"] [data-open-now-scroller]'
  );
  const litBlocks = page.locator(
    '[data-pane="open-now"] [data-open-window-id][data-landing]'
  );
  // PREMISE: the list scrolls well past the scroll used.
  expect(
    await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
  ).toBeGreaterThan(300);
  await scroller.evaluate((el) => {
    el.scrollTop = 200;
  });
  // The window whose middle row sits nearest the list's middle.
  const target = await page.evaluate(
    ({ scroller, rows }) => {
      const v = document.querySelector(scroller)?.getBoundingClientRect();
      if (!v) return null;
      const mid = (v.top + v.bottom) / 2;
      const at = rows.map(({ windowId, rowId }) => {
        const r = document
          .querySelector(`[data-open-tab-id="${rowId}"]`)
          ?.getBoundingClientRect();
        return {
          windowId,
          off: r ? Math.abs(r.top + r.height / 2 - mid) : 1e9,
        };
      });
      at.sort((a, b) => a.off - b.off);
      return at[0]?.windowId ?? null;
    },
    {
      scroller: '[data-pane="open-now"] [data-open-now-scroller]',
      rows: live.map((w, i) => ({
        windowId: w.windowId,
        rowId: w.idOf(`W${i} b`),
      })),
    }
  );
  const aimed = live.find((w) => w.windowId === target);
  const index = live.findIndex((w) => w.windowId === target);
  if (aimed === undefined) throw new Error('no window in view');
  const before = await Promise.all(
    live.map(async (w) => (await strip(worker, w.windowId)).length)
  );

  await pickUp(page, windowHandle(page, 'w1'));
  const aim = await middleOf(liveRow(page, aimed.idOf(`W${index} b`)));
  // PREMISE: still scrolled, and the aimed window is the one drawn there.
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(200);
  const beneath = await page.evaluate(
    ({ x, y }) =>
      [
        ...document.querySelectorAll(
          '[data-pane="open-now"] [data-open-window-id]'
        ),
      ]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return x >= b.left && x < b.right && y >= b.top && y < b.bottom;
        })
        .map((el) => Number(el.getAttribute('data-open-window-id'))),
    aim
  );
  expect(beneath).toEqual([aimed.windowId]);

  await carryTo(page, aim);
  await expect(block(page, aimed.windowId)).toHaveAttribute('data-landing', '');
  await expect(litBlocks).toHaveCount(1);
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, aimed.windowId)).length, SETTLE)
    .toBe((before[index] ?? 0) + 5);
  // No other window took any of it.
  expect(
    await Promise.all(
      live.map(async (w) => (await strip(worker, w.windowId)).length)
    )
  ).toEqual(before.map((n, i) => (i === index ? n + 5 : n)));
});

// --- The arrival (spec D, Scroll and Animation): Currently open scrolls the
// least it must to show the new rows over 280ms, ease-out, and one fill in
// the landing colour behind them holds 300ms, then fades over 600ms.

// S1 w1 with no pinned tab: all four of its tabs land at the window's end.
const ARRIVING = (): tabContainerData =>
  session('S1', 'Trip', [
    win(
      'w1',
      [tab('s1'), tab('s2'), tab('g0', 'day'), tab('g1', 'day')],
      [{ groupId: 'day', title: 'Day trips', color: 'green' }]
    ),
  ]);

const SCROLLER = '[data-pane="open-now"] [data-open-now-scroller]';

interface Edges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
interface ArrivalFrame {
  t: number;
  scrollTop: number;
  view: Edges;
  block: Edges | null;
  rows: { id: number; box: Edges }[];
  bands: { ids: number[]; box: Edges }[];
  fill: {
    opacity: number;
    animations: number;
    background: string;
    box: Edges;
  } | null;
}
interface ArrivalLog {
  frames: ArrivalFrame[];
  // performance.now() as a [data-arrival] went into the page, and out.
  added: number[];
  removed: number[];
  // Where `nudge` put the list, once it had.
  nudgedTo: number | null;
  done: boolean;
}

declare global {
  interface Window {
    __arrival?: ArrivalLog;
    __groupsHidden?: boolean;
    // Open now's reads of the windows wait while this is set.
    __readsHeld?: Promise<void> | null;
    __releaseReads?: () => void;
    // The worker's answers to open-into-window, as the page got them.
    __intoWindowAnswers?: number;
  }
}

// From now until a fill has come and gone (and 300ms more), or `forMs`
// (6s): every frame's scroll, the window's rows and bands, and the fill.
// `pause` stops the fill's animation the moment it is in the page; `nudge`
// scrolls the list 10px back up with a wheel, as a user would, once it has
// glided past 10px.
async function recordArrival(
  page: Page,
  windowId: number,
  {
    pause = false,
    nudge = false,
    forMs = 6000,
  }: { pause?: boolean; nudge?: boolean; forMs?: number } = {}
): Promise<void> {
  await page.evaluate(
    ({ windowId, scroller, pause, nudge, forMs }) => {
      const log: ArrivalLog = {
        frames: [],
        added: [],
        removed: [],
        nudgedTo: null,
        done: false,
      };
      window.__arrival = log;
      const edges = (el: Element): Edges => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const isFill = (n: Node): n is HTMLElement =>
        n instanceof HTMLElement && n.matches('[data-arrival]');
      const watch = new MutationObserver((records) => {
        for (const record of records) {
          for (const n of record.addedNodes)
            if (isFill(n)) {
              log.added.push(performance.now());
              if (pause) for (const a of n.getAnimations()) a.pause();
            }
          for (const n of record.removedNodes)
            if (isFill(n)) log.removed.push(performance.now());
        }
      });
      watch.observe(document.body, { childList: true, subtree: true });
      const start = performance.now();
      const list = document.querySelector(scroller);
      const tick = () => {
        const now = performance.now();
        if (
          nudge &&
          log.nudgedTo === null &&
          list !== null &&
          list.scrollTop > 10 &&
          document.querySelector('[data-arrival]') !== null
        ) {
          list.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }));
          list.scrollTop -= 10;
          log.nudgedTo = list.scrollTop;
        }
        const block = document.querySelector(
          `[data-pane="open-now"] [data-open-window-id="${windowId}"]`
        );
        const fill = document.querySelector('[data-arrival]');
        const idsIn = (el: Element) =>
          [...el.querySelectorAll('[data-open-tab-id]')].map((row) =>
            Number(row.getAttribute('data-open-tab-id'))
          );
        log.frames.push({
          t: now,
          scrollTop: list?.scrollTop ?? -1,
          view: list ? edges(list) : { top: 0, bottom: 0, left: 0, right: 0 },
          block: block ? edges(block) : null,
          rows: block
            ? [...block.querySelectorAll('[data-open-tab-id]')].map((row) => ({
                id: Number(row.getAttribute('data-open-tab-id')),
                box: edges(row),
              }))
            : [],
          bands: block
            ? [...block.querySelectorAll('[data-band-id]')].map((band) => ({
                ids: idsIn(band),
                box: edges(band),
              }))
            : [],
          fill: fill
            ? {
                opacity: Number(getComputedStyle(fill).opacity),
                animations: fill.getAnimations().length,
                background: getComputedStyle(fill).backgroundColor,
                box: edges(fill),
              }
            : null,
        });
        const gone = log.removed[log.removed.length - 1];
        if ((gone !== undefined && now - gone > 300) || now - start > forMs) {
          watch.disconnect();
          log.done = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { windowId, scroller: SCROLLER, pause, nudge, forMs }
  );
}

async function arrivalLog(page: Page): Promise<ArrivalLog> {
  await expect
    .poll(() => page.evaluate(() => window.__arrival?.done), SETTLE)
    .toBe(true);
  const log = await page.evaluate(() => window.__arrival);
  if (log === undefined) throw new Error('no arrival log');
  return log;
}

// The new rows' span, with every band all of whose rows are new: what the
// fill covers and the list scrolls to.
function newSpan(frame: ArrivalFrame, added: number[]): Edges {
  const boxes = [
    ...frame.rows.filter((r) => added.includes(r.id)).map((r) => r.box),
    ...frame.bands
      .filter(
        (b) => b.ids.length > 0 && b.ids.every((id) => added.includes(id))
      )
      .map((b) => b.box),
  ];
  if (boxes.length !== added.length + 1)
    throw new Error(`expected ${added.length} new rows and their band`);
  return {
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
  };
}

// A window long enough that tabs added at its end land below the list's
// bottom, with another window after it; the saved window dropped on its
// header. Returns the frames from just before the release.
async function dropOnLongWindow(
  context: Parameters<typeof openTabView>[0],
  extensionId: string,
  worker: Worker,
  options: {
    reduceMotion: boolean;
    pause?: boolean;
    nudge?: boolean;
    // Open now reads no groups until __groupsHidden is cleared: the tabs are
    // listed before their band.
    groupsLate?: boolean;
  }
) {
  const live = await openLiveWindow(
    worker,
    Array.from({ length: 16 }, (_, i) => `T${i}`)
  );
  await openLiveWindow(worker, ['U0', 'U1', 'U2']);
  const page = await setUp(context, extensionId, ARRIVING());
  if (options.reduceMotion)
    await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(liveRow(page, live.idOf('T15'))).toBeAttached();
  const before = (await strip(worker, live.windowId)).map((t) => t.id);
  // PREMISE: at the list's top, and four more rows after T15 would end below its bottom.
  const room = await page.evaluate(
    ({ scroller, last }) => {
      const list = document.querySelector(scroller);
      const row = document.querySelector(`[data-open-tab-id="${last}"]`);
      if (!list || !row) return null;
      const r = row.getBoundingClientRect();
      return {
        scrollTop: list.scrollTop,
        below: r.bottom + 4 * r.height > list.getBoundingClientRect().bottom,
      };
    },
    { scroller: SCROLLER, last: live.idOf('T15') }
  );
  expect(room).toEqual({ scrollTop: 0, below: true });

  if (options.groupsLate)
    await page.evaluate(() => {
      window.__groupsHidden = true;
      const query = chrome.tabGroups.query.bind(chrome.tabGroups);
      const late = async (info: chrome.tabGroups.QueryInfo) =>
        window.__groupsHidden ? [] : query(info);
      Object.defineProperty(chrome.tabGroups, 'query', { value: late });
    });

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(windowRow(page, live.windowId)));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  const lit = await block(page, live.windowId).evaluate(
    (el) => getComputedStyle(el).backgroundColor
  );
  await recordArrival(page, live.windowId, options);
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, live.windowId)).length, SETTLE)
    .toBe(before.length + 4);
  const added = (await strip(worker, live.windowId))
    .map((t) => t.id)
    .filter((id) => !before.includes(id));
  return { page, live, lit, added };
}

const inView = (box: Edges, view: Edges) =>
  box.top >= view.top - 1 && box.bottom <= view.bottom + 1;

test('the list scrolls to show the new rows, and one fill covers them, then goes', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const { page, lit, added } = await dropOnLongWindow(
    context,
    extensionId,
    worker,
    { reduceMotion: false }
  );
  const log = await arrivalLog(page);

  // One fill, in and out once: held 300ms then faded over 600ms.
  expect(log.added).toHaveLength(1);
  expect(log.removed).toHaveLength(1);
  const [inAt] = log.added;
  const [outAt] = log.removed;
  if (inAt === undefined || outAt === undefined) throw new Error('no fill');
  expect(outAt - inAt).toBeGreaterThanOrEqual(850);
  expect(outAt - inAt).toBeLessThan(2000);
  const shown = log.frames.filter((f) => f.fill !== null);
  const opacities = shown.map((f) => f.fill?.opacity ?? -1);
  expect(
    shown.filter((f) => f.t - inAt < 250).map((f) => f.fill?.opacity)
  ).toEqual(expect.arrayContaining([1]));
  for (const f of shown.filter((f) => f.t - inAt < 250))
    expect(f.fill?.opacity).toBe(1);
  expect(opacities.some((o) => o > 0.05 && o < 0.95)).toBe(true);
  opacities.forEach((o, i) => {
    if (i > 0) expect(o).toBeLessThanOrEqual((opacities[i - 1] ?? 1) + 0.001);
  });
  // The lit window's own fill.
  expect(shown[0]?.fill?.background).toBe(lit);
  expect(lit).not.toBe('rgba(0, 0, 0, 0)');

  // The fill's box: first new row's top to the last one's bottom, the
  // rows' left edge (the band's strip), 4px in from the block's right.
  const settled = shown[shown.length - 1];
  if (settled?.fill == null || settled.block === null)
    throw new Error('no fill frame');
  const span = newSpan(settled, added);
  const box = settled.fill.box;
  expect(Math.abs(box.top - span.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.bottom - span.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.left - span.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.right - (settled.block.right - 4))).toBeLessThanOrEqual(
    1
  );

  // Scrolled smoothly (several steps), from the top to where every new row shows.
  const tops = log.frames.map((f) => f.scrollTop);
  expect(tops[0]).toBe(0);
  const last = log.frames[log.frames.length - 1];
  if (last === undefined) throw new Error('no frames');
  expect(last.scrollTop).toBeGreaterThan(0);
  expect(new Set(tops).size).toBeGreaterThanOrEqual(4);
  expect(inView(newSpan(last, added), last.view)).toBe(true);
  // The least scroll: the last new row ends 8px above the list's bottom.
  expect(
    Math.abs(last.view.bottom - newSpan(last, added).bottom - 8)
  ).toBeLessThanOrEqual(1);
});

test('the fill is drawn behind the rows, in the landing fill, and a press goes to the row', async ({
  context,
  extensionId,
  serviceWorker: worker,
}, testInfo) => {
  const { page, live, lit, added } = await dropOnLongWindow(
    context,
    extensionId,
    worker,
    { reduceMotion: false, pause: true }
  );
  const fill = page.locator('[data-arrival]');
  await expect(fill).toHaveCount(1);
  await page.mouse.move(0, 0);
  // Held where the glide ends: every new row in view.
  await expect
    .poll(() =>
      page.evaluate(
        ({ scroller, ids }) => {
          const v = document.querySelector(scroller)?.getBoundingClientRect();
          return ids.every((id) => {
            const r = document
              .querySelector(`[data-open-tab-id="${id}"]`)
              ?.getBoundingClientRect();
            return !!v && !!r && r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
          });
        },
        { scroller: SCROLLER, ids: added }
      )
    )
    .toBe(true);
  expect(
    await fill.evaluate((el) => getComputedStyle(el).backgroundColor)
  ).toBe(lit);

  const shot = await page.screenshot();
  await testInfo.attach('arrival fill, held', {
    body: shot,
    contentType: 'image/png',
  });
  const first = added[0];
  if (first === undefined) throw new Error('no new tab');
  const seen = await page.evaluate(
    async ({ shot, id, oldId }) => {
      const row = document.querySelector(`[data-open-tab-id="${id}"]`);
      const fillEl = document.querySelector('[data-arrival]');
      // The window's last old row, just above the new ones.
      const old = document.querySelector(`[data-open-tab-id="${oldId}"]`);
      // Its Switch button: the favicon and the title.
      const title = row?.querySelector('button');
      if (!row || !fillEl || !old || !title) return null;
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const px = (x: number, y: number) =>
        [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(
          0,
          3
        );
      const f = fillEl.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const o = old.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      // Every pixel of the button's box: its favicon and text are drawn over the fill.
      const titlePx: number[][] = [];
      for (let x = Math.ceil(t.left); x < t.right; x++)
        for (let y = Math.ceil(t.top); y < t.bottom; y++)
          titlePx.push(px(x, y));
      const fillPx = px(f.right - 12, r.top + r.height / 2);
      const hit = document.elementFromPoint(r.left + 40, r.top + r.height / 2);
      return {
        fillPx,
        oldPx: px(f.right - 12, o.top + o.height / 2),
        // Title pixels unlike the fill: the text's own.
        textPx: titlePx.filter(
          (p) =>
            p.reduce((sum, v, i) => sum + Math.abs(v - (fillPx[i] ?? 0)), 0) >
            90
        ).length,
        hitsRow: !!hit && row.contains(hit) && !hit.closest('[data-arrival]'),
      };
    },
    { shot: shot.toString('base64'), id: first, oldId: live.idOf('T15') }
  );
  if (seen === null) throw new Error('rows not found');
  const rgb = (lit.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const near = (a: number[], b: number[]) =>
    a.every((v, i) => Math.abs(v - (b[i] ?? -99)) <= 2);
  // Inside the fill, clear of text: the landing colour. An old row beside it: not.
  expect(near(seen.fillPx, rgb)).toBe(true);
  expect(near(seen.oldPx, rgb)).toBe(false);
  // Hundreds of pixels with the fill behind (455 measured); a fill drawn
  // over them leaves only a few edge pixels (6).
  expect(seen.textPx).toBeGreaterThan(50);
  expect(seen.hitsRow).toBe(true);

  // Let go, it fades and is gone.
  await fill.evaluate((el) => el.getAnimations().forEach((a) => a.play()));
  await expect(fill).toHaveCount(0);
});

// R17. A pinned saved tab joins the pinned run at the top, the rest the end:
// a fill on each run, and the old rows between them in neither.
test('pinned saved tabs: a fill on the pinned run and one on the tail, the old rows between uncovered, both gone together', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();
  const before = (await strip(worker, live.windowId)).map((t) => t.id);

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(windowRow(page, live.windowId)));
  await expect(block(page, live.windowId)).toHaveAttribute('data-landing', '');
  await recordArrival(page, live.windowId, { pause: true });
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, live.windowId)).length, SETTLE)
    .toBe(before.length + 5);
  const tabs = await strip(worker, live.windowId);
  const added = tabs.map((t) => t.id).filter((id) => !before.includes(id));
  const pinned = tabs.filter((t) => t.pinned).map((t) => t.id);
  // PREMISE: the new pinned tab first, the old rows next, the rest at the end.
  expect(pinned).toHaveLength(1);
  expect(tabs.map((t) => t.id).slice(0, 3)).toEqual([
    pinned[0],
    live.idOf('A'),
    live.idOf('B'),
  ]);

  const fill = page.locator('[data-arrival]');
  await expect(fill).toHaveCount(2);
  const tail = added.filter((id) => !pinned.includes(id));
  const placed = await page.evaluate(
    ({ windowId, head, tail, old }) => {
      const box = (el: Element | null) => {
        const r = el?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom } : null;
      };
      const row = (id: number) =>
        box(document.querySelector(`[data-open-tab-id="${id}"]`));
      const block = document.querySelector(
        `[data-pane="open-now"] [data-open-window-id="${windowId}"]`
      );
      const span = (ids: number[]) => {
        const boxes = [
          ...ids.map(row),
          // A band all of whose rows are in the run.
          ...[...(block?.querySelectorAll('[data-band-id]') ?? [])]
            .filter((band) =>
              [...band.querySelectorAll('[data-open-tab-id]')].every((r) =>
                ids.includes(Number(r.getAttribute('data-open-tab-id')))
              )
            )
            .map(box),
        ].flatMap((b) => (b ? [b] : []));
        return {
          top: Math.min(...boxes.map((b) => b.top)),
          bottom: Math.max(...boxes.map((b) => b.bottom)),
        };
      };
      return {
        fills: [...document.querySelectorAll('[data-arrival]')].map(box),
        head: span(head),
        tail: span(tail),
        old: old.map(row),
      };
    },
    {
      windowId: live.windowId,
      head: pinned,
      tail,
      old: [live.idOf('A'), live.idOf('B')],
    }
  );
  const near = (
    a: { top: number; bottom: number } | null,
    b: { top: number; bottom: number }
  ) =>
    a !== null &&
    Math.abs(a.top - b.top) <= 1 &&
    Math.abs(a.bottom - b.bottom) <= 1;
  expect(placed.fills).toHaveLength(2);
  expect(near(placed.fills[0] ?? null, placed.head)).toBe(true);
  expect(near(placed.fills[1] ?? null, placed.tail)).toBe(true);
  // The old rows between: under neither fill.
  for (const old of placed.old) {
    if (old === null) throw new Error('old row not drawn');
    for (const f of placed.fills) {
      if (f === null) throw new Error('fill not drawn');
      expect(f.bottom <= old.top + 1 || f.top >= old.bottom - 1).toBe(true);
    }
  }

  // Let go, both fade and go together.
  await page.evaluate(() =>
    document
      .querySelectorAll('[data-arrival]')
      .forEach((el) => el.getAnimations().forEach((a) => a.play()))
  );
  const log = await arrivalLog(page);
  expect(log.added).toHaveLength(2);
  expect(log.removed).toHaveLength(2);
  const [in0 = 0, in1 = -1e9] = log.added;
  const [out0 = 0, out1 = -1e9] = log.removed;
  expect(Math.abs(in1 - in0)).toBeLessThan(5);
  expect(Math.abs(out1 - out0)).toBeLessThan(5);
});

test('reduce motion: no smooth scroll, the fill shows and goes without a fade', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const { page, added } = await dropOnLongWindow(context, extensionId, worker, {
    reduceMotion: true,
  });
  const log = await arrivalLog(page);

  expect(log.added).toHaveLength(1);
  expect(log.removed).toHaveLength(1);
  const [inAt] = log.added;
  const [outAt] = log.removed;
  if (inAt === undefined || outAt === undefined) throw new Error('no fill');
  expect(outAt - inAt).toBeGreaterThanOrEqual(850);
  expect(outAt - inAt).toBeLessThan(2000);
  const shown = log.frames.filter((f) => f.fill !== null);
  expect(shown.length).toBeGreaterThan(0);
  for (const f of shown) {
    expect(f.fill?.animations).toBe(0);
    expect(f.fill?.opacity).toBe(1);
  }
  // Jumps, no glide: every frame the list is off its top, it rests where the
  // new rows listed then end 8px above its bottom. (A band drawn after its
  // tabs is a second jump: rows arrive in steps, R12.)
  expect(log.frames[0]?.scrollTop).toBe(0);
  const moved = log.frames.filter((f) => f.scrollTop !== 0);
  expect(moved.length).toBeGreaterThan(0);
  for (const f of moved) {
    const listed = [
      ...f.rows.filter((r) => added.includes(r.id)).map((r) => r.box),
      ...f.bands
        .filter(
          (b) => b.ids.length > 0 && b.ids.every((id) => added.includes(id))
        )
        .map((b) => b.box),
    ];
    const bottom = Math.max(...listed.map((b) => b.bottom));
    expect(Math.abs(f.view.bottom - bottom - 8)).toBeLessThanOrEqual(1);
  }
  const last = log.frames[log.frames.length - 1];
  if (last === undefined) throw new Error('no frames');
  expect(inView(newSpan(last, added), last.view)).toBe(true);
});

// Review Focus 5. Open now's reads are held, so the worker answers before any
// re-read lists the new tabs.
test('the fill waits for rows Open now has not drawn yet, and gives up after 2s', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId, ARRIVING());
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();
  await page.evaluate(() => {
    window.__readsHeld = null;
    window.__intoWindowAnswers = 0;
    const getAll = chrome.windows.getAll.bind(chrome.windows);
    const heldGetAll = async (filter: chrome.windows.QueryOptions = {}) => {
      if (filter.populate === true) await window.__readsHeld;
      return getAll(filter);
    };
    Object.defineProperty(chrome.windows, 'getAll', { value: heldGetAll });
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    const counted = async (message: unknown) => {
      const answer: unknown = await send(message);
      const type =
        typeof message === 'object' && message !== null && 'type' in message
          ? message.type
          : null;
      if (type === 'open-into-window')
        window.__intoWindowAnswers = (window.__intoWindowAnswers ?? 0) + 1;
      return answer;
    };
    Object.defineProperty(chrome.runtime, 'sendMessage', { value: counted });
  });
  const holdReads = () =>
    page.evaluate(() => {
      window.__readsHeld = new Promise<void>((resolve) => {
        window.__releaseReads = () => {
          window.__readsHeld = null;
          resolve();
        };
      });
    });
  const releaseReads = () => page.evaluate(() => window.__releaseReads?.());
  const answers = () => page.evaluate(() => window.__intoWindowAnswers);
  const rows = block(page, live.windowId).locator('[data-open-tab-id]');
  const dropOn = async () => {
    await pickUp(page, windowHandle(page, 'w1'));
    await carryTo(page, await middleOf(windowRow(page, live.windowId)));
    await expect(block(page, live.windowId)).toHaveAttribute(
      'data-landing',
      ''
    );
    await page.mouse.up();
  };

  // 1. Answered before Open now lists the tabs: the fill waits for them.
  await holdReads();
  await recordArrival(page, live.windowId);
  await dropOn();
  await expect.poll(answers, SETTLE).toBe(1);
  // PREMISE: the tabs are in Chrome, and not yet listed; no fill.
  expect((await strip(worker, live.windowId)).length).toBe(6);
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-arrival]')).toHaveCount(0);
  await releaseReads();
  await expect(rows).toHaveCount(6);
  const waited = await arrivalLog(page);
  expect(waited.added).toHaveLength(1);
  expect(waited.removed).toHaveLength(1);

  // 2. Still not listed 2s after the answer: nothing shows, then or later.
  // Recorded long enough to outlast a slow runner's drop and wait.
  await holdReads();
  await recordArrival(page, live.windowId, { forMs: 30_000 });
  await dropOn();
  await expect.poll(answers, SETTLE).toBe(2);
  // PREMISE: answered and not listed.
  expect((await strip(worker, live.windowId)).length).toBe(10);
  await expect(rows).toHaveCount(6);
  // The 2s the fill waits for, and a margin: the subject is the wait.
  await page.waitForTimeout(2300);
  // PREMISE: the recorder is still watching, so a fill can't come and go unseen.
  expect(await page.evaluate(() => window.__arrival?.done)).toBe(false);
  await releaseReads();
  await expect(rows).toHaveCount(10);
  // A fill for these rows would be in the page with them, in the same
  // commit: read once, not retried until a wrong one fades.
  expect(
    await page.evaluate(() => ({
      recorded: window.__arrival?.added.length,
      inPage: document.querySelectorAll('[data-arrival]').length,
      watching: window.__arrival?.done === false,
    }))
  ).toEqual({ recorded: 0, inPage: 0, watching: true });
});

// R14. With no fill, a window block is no layer of its own: a folded
// window's ⋮ menu is drawn over the next window, under it.
test("with no fill, a folded open window's ⋮ menu is drawn over the next window", async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const next = await openLiveWindow(worker, ['C', 'D', 'E']);
  const page = await setUp(context, extensionId, ARRIVING());
  await expect(liveRow(page, next.idOf('E'))).toBeVisible();
  await block(page, live.windowId)
    .getByRole('button', { name: /^Collapse: / })
    .click();
  await expect(liveRow(page, live.idOf('A'))).toHaveCount(0);
  await windowRow(page, live.windowId).hover();
  await windowRow(page, live.windowId)
    .getByRole('button', { name: /^More actions: / })
    .click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // PREMISE: the menu reaches down over the next window's rows.
  const over = await page.evaluate(
    ({ next }) => {
      const m = document
        .querySelector('[role="menu"]')
        ?.getBoundingClientRect();
      const b = document
        .querySelector(`[data-pane="open-now"] [data-open-window-id="${next}"]`)
        ?.getBoundingClientRect();
      return !!m && !!b && m.bottom > b.top + 20;
    },
    { next: next.windowId }
  );
  expect(over).toBe(true);
  // Every item takes a click at its left, middle and right.
  const onTop = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(
      (item) => {
        const r = item.getBoundingClientRect();
        const y = r.top + r.height / 2;
        return [r.left + 8, r.left + r.width / 2, r.right - 8].every((x) =>
          item.contains(document.elementFromPoint(x, y))
        );
      }
    )
  );
  expect(onTop.length).toBeGreaterThan(0);
  expect(onTop.every(Boolean)).toBe(true);
});

// A scroll of the user's own mid-glide ends the glide: the list stays where they put it.
test("a scroll of the user's own during the glide is left where they put it", async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const { page } = await dropOnLongWindow(context, extensionId, worker, {
    reduceMotion: false,
    nudge: true,
  });
  const log = await arrivalLog(page);

  const to = log.nudgedTo;
  if (to === null) throw new Error('the list never glided past 10px');
  const at = log.frames.findIndex((f) => f.scrollTop === to);
  expect(at).toBeGreaterThan(0);
  // Every frame from the nudge on: where the user put it.
  expect(new Set(log.frames.slice(at).map((f) => f.scrollTop))).toEqual(
    new Set([to])
  );
  // The fill still shows and goes.
  expect(log.added).toHaveLength(1);
  expect(log.removed).toHaveLength(1);
});

// The worker's answer can come after a re-read listed the tabs but before one
// drew their group's band (R12: rows arrive in steps). While the fill shows,
// the band drawn later joins it, and the list follows the rows it pushed down.
test('a band drawn after its tabs: the fill takes it in, and the list follows', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const { page, live, added } = await dropOnLongWindow(
    context,
    extensionId,
    worker,
    { reduceMotion: false, pause: true, groupsLate: true }
  );
  const fill = page.locator('[data-arrival]');
  const bands = block(page, live.windowId).locator('[data-band-id]');
  // Where the fill is against the new rows (and their band), and whether they show.
  const fit = () =>
    page.evaluate(
      ({ scroller, windowId, ids }) => {
        const b = document
          .querySelector(
            `[data-pane="open-now"] [data-open-window-id="${windowId}"]`
          )
          ?.getBoundingClientRect();
        const f = document
          .querySelector('[data-arrival]')
          ?.getBoundingClientRect();
        const v = document.querySelector(scroller)?.getBoundingClientRect();
        const boxes = [
          ...ids.map((id) =>
            document.querySelector(`[data-open-tab-id="${id}"]`)
          ),
          ...document.querySelectorAll(
            `[data-open-window-id="${windowId}"] [data-band-id]`
          ),
        ].flatMap((el) => (el ? [el.getBoundingClientRect()] : []));
        if (!b || !f || !v || boxes.length === 0) return null;
        const top = Math.min(...boxes.map((r) => r.top));
        const bottom = Math.max(...boxes.map((r) => r.bottom));
        return {
          covers:
            Math.abs(f.top - top) <= 1 && Math.abs(f.bottom - bottom) <= 1,
          shows: top >= v.top - 1 && bottom <= v.bottom + 1,
        };
      },
      { scroller: SCROLLER, windowId: live.windowId, ids: added }
    );

  await expect(fill).toHaveCount(1);
  // PREMISE: listed with no band yet; the fill and the list on the rows.
  await expect(bands).toHaveCount(0);
  await expect.poll(fit).toEqual({ covers: true, shows: true });
  // The glide (280ms from the fill's first frame) is over: a glide still
  // running would follow the band on its own.
  await expect
    .poll(() =>
      page.evaluate(() => performance.now() - (window.__arrival?.added[0] ?? 0))
    )
    .toBeGreaterThan(500);

  const groupId = (await strip(worker, live.windowId)).find(
    (t) => t.id === added[3]
  )?.groupId;
  if (groupId === undefined || groupId === -1) throw new Error('not grouped');
  await page.evaluate(() => {
    window.__groupsHidden = false;
  });
  // Any group event re-reads.
  await worker.evaluate(
    (id: number) => chrome.tabGroups.update(id, { title: 'Day trips' }),
    groupId
  );
  await expect(bands).toHaveCount(1);
  await expect.poll(fit).toEqual({ covers: true, shows: true });

  await fill.evaluate((el) => el.getAnimations().forEach((a) => a.play()));
  await expect(fill).toHaveCount(0);
});
