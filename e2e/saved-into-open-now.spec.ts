import type { Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import { openTabView, session, tab, win } from './fixtures/betweenSessions';
import { allowInIncognito } from './fixtures/incognito';
import { elementLanded } from './fixtures/landed';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  strip,
  tabCount,
  topOf,
} from './fixtures/liveWindows';
import {
  boxOf,
  groupHandle,
  pickUp,
  stored,
  tabHandle,
  windowHandle,
} from './fixtures/sessionDrag';
import type {
  tabContainerData,
  tabData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-815 on the real artifact: a saved tab, group or window let go over
// Currently open opens a copy in Chrome, in the background. The saved session
// never changes, and nothing is focused or switched to.
//
// Every live tab is a data: page in a window the worker opens unfocused, so
// the tab view stays the page under the pointer. The tab view is side by side
// (1280x800): the session list, the saved detail, then Currently open.

const CARD = '[data-carry-card]';
const BADGE = `${CARD} [data-carry-card-badge]`;
const OPEN_NOW = '[data-pane="open-now"]';
const HEADER_BOX = '[data-new-window-target="open-now-first"]';
const LAST_BOX = '[data-new-window-target="open-now-last"]';

// generatePlaceholderURL's prefix; a live tab here is never base64.
const PLACEHOLDER = 'data:text/html;base64,';

// S1 w1: s0 (pinned), s1, s2, then group "Day trips" (g0, g1). Saved at https
// addresses, so a placeholder (data:) and a real page are told apart.
const PINNED: tabData = { ...tab('s0'), pinned: true };
const SAVED = (): tabContainerData => {
  const s = session('S1', 'Trip', [
    win(
      'w1',
      [PINNED, tab('s1'), tab('s2'), tab('g0', 'day'), tab('g1', 'day')],
      [{ groupId: 'day', title: 'Day trips', color: 'green' }]
    ),
  ]);
  // KAN-853: a maximized saved window opens maximized, as Open opens it.
  s.windows[0].state = 'maximized';
  return s;
};

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

async function middleOf(el: Locator) {
  const b = await boxOf(el);
  return { x: b.x + Math.min(80, b.width / 2), y: b.y + b.height / 2 };
}

// Opens the tab view on S1, after the live windows, so Open now lists them.
async function setUp(
  context: Parameters<typeof openTabView>[0],
  extensionId: string,
  sessions: tabContainerData[] = [SAVED()],
  viewport?: { width: number; height: number }
) {
  const view = await openTabView(
    context,
    extensionId,
    false,
    sessions,
    viewport
  );
  await expect(tabHandle(view, 's2')).toBeVisible();
  return view;
}

test.describe('a saved tab let go at a slot opens there, in the background', () => {
  test('between two live tabs: Chrome order, its real page, nothing switched to, the session unchanged', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('D'))).toBeVisible();
    const before = await stored(page);
    const focus = await focusNow(worker);

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('C'))));
    await expect(page.locator(BADGE)).toBeVisible();
    await page.mouse.up();

    await expect
      .poll(async () => (await strip(worker, live.windowId)).map((t) => t.url))
      .toEqual([
        dataUrl('A'),
        dataUrl('B'),
        'https://s2.test/',
        dataUrl('C'),
        dataUrl('D'),
      ]);
    expect((await strip(worker, live.windowId))[2]).toMatchObject({
      pinned: false,
      groupId: -1,
    });
    expect(await focusNow(worker)).toEqual(focus);
    expect(await stored(page)).toEqual(before);
  });

  test('into the pinned run it opens pinned; below it, unpinned', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['P1', 'P2', 'A', 'B']);
    await worker.evaluate(
      async (ids: number[]) => {
        for (const id of ids) await chrome.tabs.update(id, { pinned: true });
      },
      [live.idOf('P1'), live.idOf('P2')]
    );
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await pickUp(page, tabHandle(page, 's1'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('P2'))));
    await page.mouse.up();
    await expect
      .poll(async () => (await strip(worker, live.windowId))[1])
      .toMatchObject({ url: 'https://s1.test/', pinned: true });

    // The saved PINNED tab, below the run: the slot decides.
    await pickUp(page, tabHandle(page, 's0'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await strip(worker, live.windowId)).find(
          (t) => t.url === 'https://s0.test/'
        )
      )
      .toMatchObject({ pinned: false });
    const urls = (await strip(worker, live.windowId)).map((t) => t.url);
    expect(urls.indexOf('https://s0.test/')).toBe(
      urls.indexOf(dataUrl('B')) - 1
    );
  });

  // Review Focus 1.
  test("inside a live group's band it joins the group; just below the band it opens loose", async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'G1', 'G2', 'B']);
    // In the live window: without one, tabs.group moves them to the current window.
    const groupId = await worker.evaluate(
      async ({
        ids,
        windowId,
      }: {
        ids: [number, number];
        windowId: number;
      }) => {
        const id = await chrome.tabs.group({
          tabIds: ids,
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(id, { title: 'Live', color: 'blue' });
        return id;
      },
      {
        ids: [live.idOf('G1'), live.idOf('G2')] as [number, number],
        windowId: live.windowId,
      }
    );
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('G2'))).toBeVisible();

    await pickUp(page, tabHandle(page, 's1'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('G2'))));
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await strip(worker, live.windowId)).find(
          (t) => t.url === 'https://s1.test/'
        )
      )
      .toMatchObject({ groupId });

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await strip(worker, live.windowId)).find(
          (t) => t.url === 'https://s2.test/'
        )
      )
      .toMatchObject({ groupId: -1 });
  });

  test('onto a folded live window it keeps its saved pin', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    const block = page.locator(`[data-open-window-id="${live.windowId}"]`);
    await expect(block).toBeVisible();
    await block
      .getByRole('button', { name: /^Collapse: / })
      .first()
      .click();
    await expect(liveRow(page, live.idOf('A'))).toHaveCount(0);

    await pickUp(page, tabHandle(page, 's0'));
    await carryTo(page, await middleOf(block));
    await page.mouse.up();

    await expect
      .poll(async () => (await strip(worker, live.windowId))[0])
      .toMatchObject({ url: 'https://s0.test/', pinned: true });
  });
});

test('a group with the grant opens as a group: its look, shown, its first page real and the rest waiting', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();
  const before = await stored(page);
  const focus = await focusNow(worker);

  await pickUp(page, groupHandle(page, 'day'));
  await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
  await page.mouse.up();

  // The first at its real page; the second waiting as a placeholder (KAN-250).
  await expect
    .poll(async () =>
      (await strip(worker, live.windowId)).map((t) =>
        t.url.startsWith(PLACEHOLDER) ? 'placeholder' : t.url
      )
    )
    .toEqual([dataUrl('A'), 'https://g0.test/', 'placeholder', dataUrl('B')]);
  const tabs = await strip(worker, live.windowId);
  expect(tabs[1].groupId).not.toBe(-1);
  expect(tabs[2].groupId).toBe(tabs[1].groupId);
  const group = await worker.evaluate(
    (id: number) => chrome.tabGroups.get(id),
    tabs[1].groupId
  );
  expect(group).toMatchObject({
    title: 'Day trips',
    color: 'green',
    collapsed: false,
  });
  expect(await focusNow(worker)).toEqual(focus);
  expect(await stored(page)).toEqual(before);
});

// KAN-853. A new window comes to the front, as his pick: it is not drawn where it was let go.
test('a window opens as a new window, in front, maximized as saved', async ({
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
  await expect(page.locator(LAST_BOX)).toHaveAttribute('data-landing', '');
  await expect(page.locator(BADGE)).toBeVisible();
  await page.mouse.up();

  await expect
    .poll(async () => (await windowIds(worker)).length)
    .toBe(windowsBefore.length + 1);
  const made = (await windowIds(worker)).find(
    (id) => !windowsBefore.includes(id)
  );
  if (made === undefined) throw new Error('no new window');
  await expect.poll(async () => (await strip(worker, made)).length).toBe(5);
  // PREMISE: the tab view's window had focus.
  expect(focus.lastFocused).not.toBe(made);
  await expect
    .poll(async () => (await focusNow(worker)).lastFocused)
    .toBe(made);
  // Kept: nothing takes it back.
  await page.waitForTimeout(2000);
  expect((await focusNow(worker)).lastFocused).toBe(made);
  const state = await worker.evaluate(
    async (id: number) => (await chrome.windows.get(id)).state,
    made
  );
  expect(state).toBe('maximized');
  expect(await stored(page)).toEqual(before);
});

test.describe('the New window boxes open a new window holding just the tab', () => {
  for (const box of ['header', 'below'] as const) {
    test(`the ${box} box`, async ({
      context,
      extensionId,
      serviceWorker: worker,
    }) => {
      const live = await openLiveWindow(worker, ['A', 'B']);
      const page = await setUp(context, extensionId);
      await expect(liveRow(page, live.idOf('B'))).toBeVisible();
      const windowsBefore = await windowIds(worker);
      const focus = await focusNow(worker);

      await pickUp(page, tabHandle(page, 's2'));
      await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
      const target = page.locator(box === 'header' ? HEADER_BOX : LAST_BOX);
      await expect(target).toBeVisible();
      await carryTo(page, await middleOf(target));
      await expect(target).toHaveAttribute('data-landing', '');
      await expect(page.locator(BADGE)).toBeVisible();
      await page.mouse.up();

      await expect
        .poll(async () => (await windowIds(worker)).length)
        .toBe(windowsBefore.length + 1);
      const made = (await windowIds(worker)).find(
        (id) => !windowsBefore.includes(id)
      );
      if (made === undefined) throw new Error('no new window');
      await expect
        .poll(async () => (await strip(worker, made)).map((t) => t.url))
        .toEqual(['https://s2.test/']);
      // KAN-853. In front.
      expect(focus.lastFocused).not.toBe(made);
      await expect
        .poll(async () => (await focusNow(worker)).lastFocused)
        .toBe(made);
    });
  }
});

// KAN-855 (his pick B). A saved window lands anywhere in Currently open, so
// the box it lands in is pinned to the bottom of the visible list while it is
// carried, however long the list.
test('a saved window held over a long list: the lit New window box shows at its bottom', async ({
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
  const scroller = page.locator(`${OPEN_NOW} [data-open-now-scroller]`);
  const box = page.locator(LAST_BOX);
  const inView = () =>
    page.evaluate(
      ({ scroller, box }) => {
        const v = document.querySelector(scroller)?.getBoundingClientRect();
        const b = document.querySelector(box)?.getBoundingClientRect();
        if (!v || !b) return 'not drawn';
        return b.top >= v.top - 1 && b.bottom <= v.bottom + 1
          ? 'in view'
          : `${Math.round(b.top)}..${Math.round(b.bottom)} in ${Math.round(v.top)}..${Math.round(v.bottom)}`;
      },
      { scroller: `${OPEN_NOW} [data-open-now-scroller]`, box: LAST_BOX }
    );

  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(liveRow(page, first.idOf('W0 b'))));
  await expect(box).toHaveAttribute('data-landing', '');
  // PREMISE: the list is scrolled to its top, with more of it below.
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  expect(
    await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
  ).toBeGreaterThan(100);

  await expect.poll(inView).toBe('in view');
  await expect(box).toBeVisible();

  // Let go there: a new window, as before.
  const windowsBefore = await windowIds(worker);
  await page.mouse.up();
  await expect
    .poll(async () => (await windowIds(worker)).length)
    .toBe(windowsBefore.length + 1);
});

// KAN-852. Wherever the list was, the new window is drawn whole on screen.
test.describe('the new window is scrolled into view', () => {
  const SCROLLER = `${OPEN_NOW} [data-open-now-scroller]`;

  // The new window's block lies inside the list's visible box.
  const shownWhole = (page: Page, windowId: number) =>
    page.evaluate(
      ({ scroller, windowId }) => {
        const view = document.querySelector(scroller)?.getBoundingClientRect();
        const block = document
          .querySelector(`[data-open-window-id="${windowId}"]`)
          ?.getBoundingClientRect();
        if (!view || !block) return 'not drawn';
        return block.top >= view.top - 1 && block.bottom <= view.bottom + 1
          ? 'whole'
          : `${Math.round(block.top)}..${Math.round(block.bottom)} in ${Math.round(view.top)}..${Math.round(view.bottom)}`;
      },
      { scroller: SCROLLER, windowId }
    );

  for (const drop of ['below', 'header', 'window'] as const) {
    test(`from the ${drop === 'window' ? 'saved window' : `${drop} box`}`, async ({
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
      const last = live[5];
      if (last === undefined) throw new Error('no live windows');
      await expect(liveRow(page, last.idOf('W5 c'))).toBeAttached();
      const scroller = page.locator(SCROLLER);
      // PREMISE: the list scrolls.
      expect(
        await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
      ).toBeGreaterThan(100);
      // The box below the last window is reached at the bottom of the list.
      if (drop === 'below')
        await scroller.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
      const windowsBefore = await windowIds(worker);

      await pickUp(
        page,
        drop === 'window' ? windowHandle(page, 'w1') : tabHandle(page, 's2')
      );
      const anchor =
        drop === 'below' ? last.idOf('W5 a') : (live[0]?.idOf('W0 a') ?? -1);
      await carryTo(page, await middleOf(liveRow(page, anchor)));
      if (drop !== 'window') {
        const target = page.locator(drop === 'header' ? HEADER_BOX : LAST_BOX);
        // Drawn once the carry is over the list, below the last window.
        await expect(target).toBeAttached();
        if (drop === 'below')
          await scroller.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
        await expect(target).toBeVisible();
        await carryTo(page, await middleOf(target));
      }
      await expect(page.locator(BADGE)).toBeVisible();
      await page.mouse.up();

      await expect
        .poll(async () => (await windowIds(worker)).length)
        .toBe(windowsBefore.length + 1);
      const made = (await windowIds(worker)).find(
        (id) => !windowsBefore.includes(id)
      );
      if (made === undefined) throw new Error('no new window');
      await expect.poll(() => shownWhole(page, made)).toBe('whole');
    });
  }
});

// Demo round 1 (D1, D2): only one landing is drawn, as on the saved side.
test.describe('the ghost', () => {
  const OPEN_NOW_SLOT = `${OPEN_NOW} [data-drag-landing-slot]`;
  const OPEN_NOW_PHANTOM = `${OPEN_NOW} [data-drag-row-id^="open-now:"]`;

  test('in the lit box below the last window, the box alone is drawn', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await pickUp(page, tabHandle(page, 's2'));
    // CONTROL: between two rows the slot is drawn.
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await expect(page.locator(OPEN_NOW_SLOT)).toBeVisible();

    const b = await boxOf(liveRow(page, live.idOf('B')));
    await carryTo(page, { x: b.x + 80, y: b.y + b.height + 6 });
    await expect(page.locator(LAST_BOX)).toHaveAttribute('data-landing', '');
    await expect(page.locator(OPEN_NOW_SLOT)).toBeHidden();
    await page.keyboard.press('Escape');
  });

  // Demo D4 (his pick): like the saved side's, drawn only while lit, so rows a
  // gap pushes down never land on it.
  test('the box below the last window is drawn only while lit', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const label = page.locator(LAST_BOX).getByText('New window');

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await expect(page.locator(OPEN_NOW_SLOT)).toBeVisible();
    await expect(label).toBeHidden();
    const border = () =>
      page
        .locator(LAST_BOX)
        .evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(await border()).toBe('rgba(0, 0, 0, 0)');

    const b = await boxOf(liveRow(page, live.idOf('B')));
    await carryTo(page, { x: b.x + 80, y: b.y + b.height + 6 });
    await expect(page.locator(LAST_BOX)).toHaveAttribute('data-landing', '');
    await expect(label).toBeVisible();
    expect(await border()).not.toBe('rgba(0, 0, 0, 0)');
    await page.keyboard.press('Escape');
  });

  test('up over the header the ghost does not go back to the box below', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
    // PREMISE: the list holds it.
    await expect(page.locator(OPEN_NOW_PHANTOM)).toHaveAttribute(
      'data-drag-held',
      ''
    );
    await carryTo(page, await middleOf(page.locator(HEADER_BOX)));
    await expect(page.locator(HEADER_BOX)).toHaveAttribute('data-landing', '');
    // Still the list's drag, as the saved list keeps its own over its header.
    await expect(page.locator(OPEN_NOW_PHANTOM)).toHaveAttribute(
      'data-drag-held',
      ''
    );
    await expect(
      page.locator(`${OPEN_NOW} [data-phantom-resting-slot]`)
    ).toBeHidden();
    await expect(page.locator(OPEN_NOW_SLOT)).toBeHidden();
    await page.keyboard.press('Escape');
  });
});

// 1 A, and demo D3 (his pick): once over Currently open, the saved side takes
// nothing. The source keeps its row, the card dims there, and a release there
// moves nothing and opens nothing.
test.describe('crossed into Currently open', () => {
  // Demo D6: carried left onto the session list it is not headed here.
  test('carried onto the session list first, Currently open draws nothing until it is over it', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const list = await boxOf(page.locator('[data-pane="sessions"]'));

    const at = await pickUp(page, tabHandle(page, 's2'));
    await page.mouse.move(list.x + list.width / 2, at.y, { steps: 10 });
    // PREMISE: carried.
    await expect(page.locator(CARD)).toBeVisible();
    await expect(page.locator(HEADER_BOX)).toHaveCount(0);
    await expect(page.locator(LAST_BOX)).toHaveCount(0);

    await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
    await expect(page.locator(HEADER_BOX)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('the source keeps its row, back over the saved side too', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const source = page.locator('[data-pane="detail"] [data-drag-row-id="s2"]');

    const at = await pickUp(page, tabHandle(page, 's2'));
    await page.mouse.move(at.x, at.y + 40, { steps: 4 });
    await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
    await expect(source).toBeVisible();
    await carryTo(page, at);
    await expect(source).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('let go back on the saved side: the card dimmed, nothing moves, nothing opens', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const before = await stored(page);
    const tabsBefore = await tabCount(worker);

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await middleOf(liveRow(page, live.idOf('A'))));
    // Back over the saved side, on s0's row: before crossing, a move there.
    await carryTo(page, await topOf(tabHandle(page, 's0')));
    await expect(page.locator(CARD)).toBeVisible();
    await expect(page.locator(BADGE)).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute(
      'data-carry-crossed-out',
      ''
    );
    await page.mouse.up();

    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
    expect(await tabCount(worker)).toBe(tabsBefore);
  });
});

test.describe('the +', () => {
  test('shows over a slot, the header box and the box below; not over the saved side', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    const at = await pickUp(page, tabHandle(page, 's2'));
    await page.mouse.move(at.x, at.y + 40, { steps: 4 });
    await expect(page.locator(CARD)).toHaveCount(0);
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await expect(page.locator(BADGE)).toBeVisible();
    await carryTo(page, await middleOf(page.locator(HEADER_BOX)));
    await expect(page.locator(BADGE)).toBeVisible();
    await carryTo(page, await middleOf(page.locator(LAST_BOX)));
    await expect(page.locator(BADGE)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('an incognito window refuses a normal saved tab: no +, and nothing opens', async ({
    context,
    extensionId,
  }) => {
    const worker = await allowInIncognito(context, extensionId);
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
    const tabsBefore = await tabCount(worker);

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await middleOf(liveRow(page, opened.tabId)));
    await expect(page.locator(CARD)).toHaveCount(1);
    await expect(page.locator(BADGE)).toHaveCount(0);
    await page.mouse.up();

    await page.waitForTimeout(800);
    expect(await tabCount(worker)).toBe(tabsBefore);
  });
});

test.describe('nothing opens', () => {
  test("under Currently open's search: no boxes, no +, and a release opens nothing (O14c)", async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['Alpha', 'Beta']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('Beta'))).toBeVisible();
    await page.locator(`${OPEN_NOW} input`).fill('Alpha');
    await expect(liveRow(page, live.idOf('Beta'))).toHaveCount(0);
    const tabsBefore = await tabCount(worker);
    const windowsBefore = await windowIds(worker);

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('Alpha'))));
    await expect(page.locator(CARD)).toHaveCount(1);
    await expect(page.locator(HEADER_BOX)).toHaveCount(0);
    await expect(page.locator(LAST_BOX)).toHaveCount(0);
    await expect(page.locator(BADGE)).toHaveCount(0);
    await page.mouse.up();

    await page.waitForTimeout(800);
    expect(await tabCount(worker)).toBe(tabsBefore);
    expect(await windowIds(worker)).toEqual(windowsBefore);
  });

  // The spec's worst path.
  test('the target window closed mid-carry: nothing opens anywhere, no page error, the session unchanged', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const before = await stored(page);

    await pickUp(page, tabHandle(page, 's2'));
    const slot = await topOf(liveRow(page, live.idOf('B')));
    await carryTo(page, slot);
    await expect(page.locator(BADGE)).toBeVisible();
    await worker.evaluate(
      (id: number) => chrome.windows.remove(id),
      live.windowId
    );
    const tabsAfterClose = await tabCount(worker);
    const windowsAfterClose = await windowIds(worker);
    await page.mouse.move(slot.x, slot.y + 2, { steps: 2 });
    await page.mouse.up();

    await page.waitForTimeout(1000);
    expect(await tabCount(worker)).toBe(tabsAfterClose);
    expect(await windowIds(worker)).toEqual(windowsAfterClose);
    expect(errors).toEqual([]);
    expect(await stored(page)).toEqual(before);
  });

  test('Esc mid-carry opens nothing', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await setUp(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const tabsBefore = await tabCount(worker);

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await expect(page.locator(BADGE)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await page.waitForTimeout(800);
    expect(await tabCount(worker)).toBe(tabsBefore);
  });
});

// Review Focus 2.
test('in, out to the saved side and back in: it opens at the slot under the pointer', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B', 'C']);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('C'))).toBeVisible();

  const at = await pickUp(page, tabHandle(page, 's2'));
  await carryTo(page, await topOf(liveRow(page, live.idOf('C'))));
  await expect(page.locator(BADGE)).toBeVisible();
  await carryTo(page, at);
  await expect(page.locator(BADGE)).toHaveCount(0);
  await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
  await expect(page.locator(BADGE)).toBeVisible();
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, live.windowId)).map((t) => t.url))
    .toEqual([dataUrl('A'), 'https://s2.test/', dataUrl('B'), dataUrl('C')]);
});

// Narrow (N2 A): the drawer is for live carries that start in it. A press
// on the saved side dismisses it, so a saved drag there stays the saved
// side's and opens nothing in Chrome.
test('narrow: a saved drag sends the drawer away and opens nothing in Chrome', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId, [SAVED()], {
    width: 1024,
    height: 700,
  });
  const rail = page.locator(
    'button[aria-expanded][aria-label^="Currently open"]'
  );
  await rail.click();
  const drawer = page.getByRole('dialog');
  await elementLanded(drawer, 'subtree');
  await expect(liveRow(page, live.idOf('B'))).toBeVisible();
  const where = await topOf(liveRow(page, live.idOf('B')));
  const tabsBefore = await tabCount(worker);

  await pickUp(page, tabHandle(page, 's2'));
  await carryTo(page, where);
  await expect(page.locator(BADGE)).toHaveCount(0);
  await page.mouse.up();

  await page.waitForTimeout(800);
  expect(await tabCount(worker)).toBe(tabsBefore);
});

// Review Focus 5.
test('held just inside the top of a scrolled Currently open list, the adopted carry scrolls it up', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const titles = Array.from({ length: 40 }, (_, i) => `Live ${i}`);
  const live = await openLiveWindow(worker, titles);
  const page = await setUp(context, extensionId);
  await expect(liveRow(page, live.idOf('Live 39'))).toBeAttached();
  const scroller = page.locator(`${OPEN_NOW} [data-open-now-scroller]`);
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const start = await scroller.evaluate((el) => el.scrollTop);
  expect(start).toBeGreaterThan(200);

  await pickUp(page, tabHandle(page, 's2'));
  const b = await boxOf(scroller);
  await carryTo(page, { x: b.x + 80, y: b.y + 40 });
  await expect(page.locator(BADGE)).toBeVisible();
  await carryTo(page, { x: b.x + 80, y: b.y + 6 });
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 3000 })
    .toBeLessThan(start - 100);
  await page.keyboard.press('Escape');
});
