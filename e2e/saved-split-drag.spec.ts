import type { Locator, Page, Worker } from '@playwright/test';

import { test as ungrantedTest } from './fixtures/extension';
import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  adoptPhantom,
  aimAt,
  carryOutLeft,
  layout,
  onto,
  openTabView,
  selected,
  session,
  settled,
  TAB_VIEW,
  tab,
  toasts,
  win,
  type SeedTab,
} from './fixtures/betweenSessions';
import { elementLanded } from './fixtures/landed';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  strip,
  topOf,
} from './fixtures/liveWindows';
import {
  boxOf,
  groupHandle,
  pickUp,
  saveRowAim,
  stored,
  tabHandle,
} from './fixtures/sessionDrag';

// KAN-942 on the real artifact: a saved split pair is one row. What the unit tests cannot show:
// the engine's geometry with a two-tab row, the slot, the card, and Chrome's answer to the copies.

const HELD = '[data-drag-held]';
const SLOT = '[data-drag-landing-slot]';
const CARD_NAMES = '[data-carry-card-name]';
const OPEN_NOW = '[data-pane="open-now"]';

const half = (
  id: string,
  g?: string,
  splitId = 'sp'
): SeedTab & { splitId: string } => ({
  ...tab(id, g),
  splitId,
});
const pinned = <T extends SeedTab>(t: T): T & { pinned: true } => ({
  ...t,
  pinned: true,
});

const DAY = { groupId: 'day', title: 'Day trips', color: 'green' };

const TRIP = () =>
  session('S1', 'Trip', [
    win(
      'w1',
      [
        tab('a0'),
        half('h1'),
        half('h2'),
        tab('a1'),
        tab('a2'),
        tab('g0', 'day'),
        tab('g1', 'day'),
      ],
      [DAY]
    ),
    win('w2', [tab('b0'), tab('b1')]),
  ]);
const TARGET = () =>
  session('S2', 'Target', [win('d1', [tab('c0'), tab('c1')])]);

const START = ['a0 h1 h2 a1 a2 g0* g1*', 'b0 b1'];

const open = (
  context: Parameters<typeof openTabView>[0],
  extensionId: string,
  sessions = [TRIP(), TARGET()],
  settings: Record<string, unknown> = {}
) => openTabView(context, extensionId, false, sessions, TAB_VIEW, settings);

const halfRow = (page: Page, id: string) =>
  page.locator(`[data-saved-tab-row="${id}"]`);

async function lift(page: Page, handle: Locator) {
  await elementLanded(handle, 'ancestors');
  const at = await pickUp(page, handle);
  await expect(page.locator(HELD)).toHaveCount(1);
  return at;
}

async function drop(page: Page, handle: Locator, rowId: string, frac: number) {
  await lift(page, handle);
  await aimAt(page, rowId, frac);
  await page.mouse.up();
}

const undoPress = (page: Page) => page.keyboard.press('ControlOrMeta+z');
const redoPress = (page: Page) => page.keyboard.press('ControlOrMeta+Shift+z');

const tabsOf = async (page: Page, windowId: string) => {
  const { tabGroups } = await stored(page);
  return (
    tabGroups.flatMap((g) => g.windows).find((w) => w.windowId === windowId)
      ?.tabs ?? []
  );
};

async function expectPair(page: Page, windowId: string) {
  const tabs = await tabsOf(page, windowId);
  const at = tabs.findIndex((t) => t.tabId === 'h1');
  expect(tabs[at + 1]?.tabId).toBe('h2');
  expect(tabs[at]?.splitId).toBeDefined();
  expect(tabs[at]?.splitId).toBe(tabs[at + 1]?.splitId);
  expect(tabs[at]?.pinned).toBe(tabs[at + 1]?.pinned);
  expect(tabs[at]?.chromeGroupId).toBe(tabs[at + 1]?.chromeGroupId);
}

// The drawn space between the halves stays shut wherever the held row rests.
async function expectNoSlotInside(page: Page, x: number) {
  const first = halfRow(page, 'h1');
  const second = halfRow(page, 'h2');
  const a = await boxOf(first);
  const b = await boxOf(second);
  for (const y of [a.y + 4, a.y + a.height - 4, b.y + 4, b.y + b.height - 4]) {
    await page.mouse.move(x, y, { steps: 6 });
    await settled(page);
    const top = await boxOf(first);
    const bottom = await boxOf(second);
    expect(bottom.y - (top.y + top.height)).toBeLessThan(2);
  }
}

test.describe('a saved pair is one row (KAN-942)', () => {
  test('1. pressing either half lifts both; the card names both, and the spot is two rows tall', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await expect(page.locator('[data-drag-row-id="h2"]')).toHaveCount(0);
    const row = (await boxOf(halfRow(page, 'h1'))).height;

    for (const press of ['h1', 'h2']) {
      const at = await lift(page, halfRow(page, press));
      await aimAt(page, 'a2', 0.75);
      const slot = await boxOf(page.locator(SLOT));
      expect(Math.abs(slot.height - 2 * row)).toBeLessThan(3);
      await carryOutLeft(page, at);
      await expect(page.locator(CARD_NAMES)).toHaveText(['Tab h1', 'Tab h2']);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(page.locator(HELD)).toHaveCount(0);
      await settled(page);
    }
    expect(await layout(page, 'S1')).toEqual(START);
  });

  test('2. reorders inside a window, with undo and redo', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await drop(page, halfRow(page, 'h2'), 'tab:a2', 0.75);
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a1 a2 h1 h2 g0* g1*', 'b0 b1']);
    await expectPair(page, 'w1');

    await undoPress(page);
    await expect.poll(() => layout(page, 'S1')).toEqual(START);
    await redoPress(page);
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a1 a2 h1 h2 g0* g1*', 'b0 b1']);
  });

  test('3. a plain tab lands by rows around a pair', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await drop(page, tabHandle(page, 'a0'), 'tab:a1', 0.75);
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['h1 h2 a1 a0 a2 g0* g1*', 'b0 b1']);
    await expectPair(page, 'w1');
  });

  test('4. to another window, with undo', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    await drop(page, halfRow(page, 'h1'), 'tab:b0', 0.75);
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a1 a2 g0* g1*', 'b0 h1 h2 b1']);
    await expectPair(page, 'w2');
    await undoPress(page);
    await expect.poll(() => layout(page, 'S1')).toEqual(START);
  });

  test('5. into a band, and out again, where a group left empty goes', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, [
      session('S1', 'Trip', [
        win('w1', [tab('a0'), half('h1'), half('h2'), tab('g0', 'day')], [DAY]),
        win(
          'w2',
          [
            tab('b0'),
            half('i1', 'day', 'other'),
            half('i2', 'day', 'other'),
            tab('b1'),
          ],
          [{ ...DAY, groupId: 'day2' }]
        ),
      ]),
      TARGET(),
    ]);
    await drop(page, halfRow(page, 'h1'), 'g0', 0.25);
    await expect
      .poll(() => layout(page, 'S1').then((l) => l[0]))
      .toBe('a0 h1* h2* g0*');
    await expectPair(page, 'w1');
    await expect(page.locator('[data-band-id="day"]')).toHaveCount(1);

    await drop(page, halfRow(page, 'h1'), 'tab:a0', 0.25);
    await expect
      .poll(() => layout(page, 'S1').then((l) => l[0]))
      .toBe('h1 h2 a0 g0*');
    await expectPair(page, 'w1');
  });

  test('6. a band holding only the pair goes when the pair leaves, and stays through a put-back', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, [
      session('S1', 'Trip', [
        win(
          'w1',
          [tab('a0'), half('h1', 'day'), half('h2', 'day'), tab('a1')],
          [DAY]
        ),
      ]),
      TARGET(),
    ]);
    // Out to the session list and back: the band is still there to land in.
    const at = await lift(page, halfRow(page, 'h1'));
    await carryOutLeft(page, at);
    await expect(page.locator('[data-band-id="day"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator(HELD)).toHaveCount(0);

    await drop(page, halfRow(page, 'h1'), 'tab:a1', 0.75);
    await expect.poll(() => layout(page, 'S1')).toEqual(['a0 a1 h1 h2']);
    await expect(page.locator('[data-band-id="day"]')).toHaveCount(0);
    await expectPair(page, 'w1');
  });

  test('7. into the pinned run and out of it, said once', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, [
      session('S1', 'Trip', [
        win('w1', [
          pinned(tab('p0')),
          pinned(tab('p1')),
          half('h1'),
          half('h2'),
          tab('a0'),
        ]),
      ]),
      TARGET(),
    ]);
    await drop(page, halfRow(page, 'h1'), 'tab:p1', 0.25);
    await expect.poll(() => layout(page, 'S1')).toEqual(['p0 h1 h2 p1 a0']);
    await expectPair(page, 'w1');
    expect((await tabsOf(page, 'w1'))[1]?.pinned).toBe(true);
    await expect
      .poll(() => toasts(page).then((all) => all.map((t) => t.text)))
      .toEqual(['Tab pinned.']);

    await drop(page, halfRow(page, 'h2'), 'tab:a0', 0.75);
    await expect.poll(() => layout(page, 'S1')).toEqual(['p0 p1 a0 h1 h2']);
    await expectPair(page, 'w1');
    expect((await tabsOf(page, 'w1'))[3]?.pinned).toBeUndefined();
  });

  test('8. to another session, at a spot, with undo', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const at = await lift(page, halfRow(page, 'h1'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await expect.poll(() => selected(page), { timeout: 3000 }).toBe('S2');
    await adoptPhantom(page, 'carried:h1');
    await aimAt(page, 'tab:c1', 0.25);
    await page.mouse.up();

    await expect.poll(() => layout(page, 'S2')).toEqual(['c0 h1 h2 c1']);
    await expectPair(page, 'd1');
    expect(await layout(page, 'S1')).toEqual(['a0 a1 a2 g0* g1*', 'b0 b1']);
    await undoPress(page);
    await expect.poll(() => layout(page, 'S1')).toEqual(START);
    expect(await layout(page, 'S2')).toEqual(['c0 c1']);
  });

  test('9. on another session’s row: its first window', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const at = await lift(page, halfRow(page, 'h2'));
    await carryOutLeft(page, at);
    await onto(page, 'S2');
    await page.mouse.up();
    await expect.poll(() => layout(page, 'S2')).toEqual(['h1 h2', 'c0 c1']);
  });

  test('10. the New window targets and the New session row', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const header = await boxOf(
      page.getByRole('button', { name: 'Open session' })
    );
    const save = await saveRowAim(page);

    await lift(page, halfRow(page, 'h1'));
    await page.mouse.move(header.x + 10, header.y + 10, { steps: 8 });
    await expect(
      page.locator('[data-new-window-target="first"]')
    ).toHaveAttribute('data-landing', '');
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['h1 h2', 'a0 a1 a2 g0* g1*', 'b0 b1']);

    await undoPress(page);
    await expect.poll(() => layout(page, 'S1')).toEqual(START);

    const at = await lift(page, halfRow(page, 'h1'));
    await carryOutLeft(page, at);
    await page.mouse.move(save.x, save.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await stored(page)).tabGroups[0]?.title)
      .toBe('Tab h1');
    const { tabGroups } = await stored(page);
    expect(tabGroups[0]?.windows[0]?.tabs.map((t) => t.tabId)).toEqual([
      'h1',
      'h2',
    ]);
  });

  test('11. no slot opens between the halves for a tab or a group', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const { x } = await lift(page, tabHandle(page, 'a1'));
    await expectNoSlotInside(page, x);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator(HELD)).toHaveCount(0);

    const group = await lift(page, groupHandle(page, 'day'));
    await expectNoSlotInside(page, group.x);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await layout(page, 'S1')).toEqual(START);
  });

  test('12. no slot opens between the halves for a carried live tab, group or pair', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const w = await openLiveWindow(worker, ['L', 'M', 'N', 'O']);
    await splitTabs(worker, [w.idOf('N'), w.idOf('O')]);
    await worker.evaluate(
      async ({ windowId, id }) => {
        const groupId = await chrome.tabs.group({
          tabIds: id,
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(groupId, {
          title: 'Live',
          color: 'blue',
        });
      },
      { windowId: w.windowId, id: w.idOf('M') }
    );
    const page = await open(context, extensionId);
    await expect(liveRow(page, w.idOf('O'))).toBeVisible();

    const groupRow = page
      .locator(`[data-open-window-id="${w.windowId}"]`)
      .getByText('Live', { exact: true });
    for (const handle of [
      liveRow(page, w.idOf('L')),
      groupRow,
      liveRow(page, w.idOf('N')),
    ]) {
      await lift(page, handle);
      const pane = await boxOf(page.locator(OPEN_NOW));
      const y = (await boxOf(halfRow(page, 'h1'))).y;
      await page.mouse.move(pane.x - 40, y, { steps: 6 });
      await expect(page.locator('[data-carry-card]')).toHaveCount(1);
      const target = await boxOf(halfRow(page, 'h1'));
      await expectNoSlotInside(page, target.x + 60);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(page.locator(HELD)).toHaveCount(0);
    }
    expect(await layout(page, 'S1')).toEqual(START);
  });

  test('13. Skip duplicate tabs: one half repeated lands whole, both repeated say so', async ({
    context,
    extensionId,
  }) => {
    const repeat = (id: string, of: string) => ({
      ...tab(id),
      url: tab(of).url,
    });
    const page = await open(
      context,
      extensionId,
      [
        session('S1', 'Trip', [
          win('w1', [
            tab('a0'),
            half('h1'),
            half('h2'),
            half('k1', undefined, 'k'),
            half('k2', undefined, 'k'),
          ]),
        ]),
        session('S2', 'Target', [
          win('d1', [
            repeat('r1', 'h1'),
            repeat('r2', 'k1'),
            repeat('r3', 'k2'),
          ]),
        ]),
      ],
      { skipDuplicateTabs: true }
    );
    const into = async (row: string) => {
      const at = await lift(page, halfRow(page, row));
      await carryOutLeft(page, at);
      await onto(page, 'S2');
      await page.mouse.up();
    };
    await into('h1');
    await expect.poll(() => layout(page, 'S2')).toEqual(['h1 h2', 'r1 r2 r3']);

    await into('k1');
    await expect(
      page.locator('[data-toast]', { hasText: '2 duplicate tabs left out.' })
    ).toHaveCount(1);
    await expect.poll(() => layout(page, 'S1')).toEqual(['a0']);
    expect(await layout(page, 'S2')).toEqual(['h1 h2', 'r1 r2 r3']);
  });

  test('14. a folded window takes the pair', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await page
      .locator('[data-drag-row-id="w2"]')
      .getByRole('button', { name: /collapse|fold/i })
      .first()
      .click();
    await lift(page, halfRow(page, 'h1'));
    const title = await boxOf(page.locator('[data-drag-row-id="w2"]'));
    await page.mouse.move(title.x + 80, title.y + 10, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => layout(page, 'S1'))
      .toEqual(['a0 a1 a2 g0* g1*', 'h1 h2 b0 b1']);
    await expectPair(page, 'w2');
  });

  test('15. worst path: the pair ends during the hold, and the drop moves nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await lift(page, halfRow(page, 'h1'));
    await aimAt(page, 'tab:a2', 0.75);
    // Another page's write, as dropOnTop re-reads it at the drop.
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('tabContainerData');
      if (raw === null) throw new Error('nothing stored');
      const data = JSON.parse(raw);
      for (const group of data.tabGroups) {
        for (const w of group.windows) {
          for (const t of w.tabs) {
            if (t.tabId === 'h2') delete t.splitId;
          }
        }
        group.lastModified = Date.now() + 1000;
      }
      data.lastModified = Date.now() + 1000;
      window.localStorage.setItem('tabContainerData', JSON.stringify(data));
    });
    await page.mouse.up();
    await expect(page.locator(HELD)).toHaveCount(0);
    await expect.poll(() => layout(page, 'S1')).toEqual(START);
    expect((await tabsOf(page, 'w1'))[2]?.splitId).toBeUndefined();
  });

  test('16. a half deleted while held ends the drag', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await lift(page, halfRow(page, 'h1'));
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('tabContainerData');
      if (raw === null) throw new Error('nothing stored');
      const data = JSON.parse(raw);
      for (const group of data.tabGroups) {
        for (const w of group.windows) {
          w.tabs = w.tabs.filter((t: { tabId: string }) => t.tabId !== 'h2');
          w.tabCount = w.tabs.length;
        }
      }
      data.lastModified = Date.now() + 1000;
      window.localStorage.setItem('tabContainerData', JSON.stringify(data));
    });
    await aimAt(page, 'tab:a2', 0.75);
    await page.mouse.up();
    await expect(page.locator(HELD)).toHaveCount(0);
    expect((await tabsOf(page, 'w1')).map((t) => t.tabId).slice(0, 3)).toEqual([
      'a0',
      'h1',
      'a1',
    ]);
  });

  test('17. a drop in place is no undo step', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const before = await stored(page);
    const at = await lift(page, halfRow(page, 'h1'));
    await page.mouse.move(at.x, at.y - 8, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator(HELD)).toHaveCount(0);
    expect((await stored(page)).lastModified).toBe(before.lastModified);
  });
});

// The window's split ids by address: a pair shows one positive id twice.
const splitOf = (worker: Worker, windowId: number) =>
  worker.evaluate(async (id: number) => {
    const tabs = await chrome.tabs.query({ windowId: id });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => ({
        url: t.pendingUrl || t.url || '',
        split: Reflect.get(t, 'splitViewId') as number,
        groupId: t.groupId,
        pinned: t.pinned,
        active: t.active,
      }));
  }, windowId);

const newestWindow = (worker: Worker, known: readonly number[]) =>
  worker.evaluate(
    async (ids: number[]) => {
      const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
      return all.find((w) => !ids.includes(w.id ?? -1))?.id ?? null;
    },
    [...known]
  );

const windowIdsNow = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({ windowTypes: ['normal'] })).map(
      (w) => w.id ?? -1
    )
  );

const H1 = 'https://h1.test/';
const H2 = 'https://h2.test/';

test.describe('a saved pair into Currently open (KAN-942)', () => {
  test('19. at a slot: a live split there, the front tab and the session as they were', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C']);
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    const before = await stored(page);
    const front = (await splitOf(worker, live.windowId)).find((t) => t.active);

    await lift(page, halfRow(page, 'h1'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();

    await expect
      .poll(async () => (await strip(worker, live.windowId)).map((t) => t.url))
      .toEqual([dataUrl('A'), H1, H2, dataUrl('B'), dataUrl('C')]);
    await expect
      .poll(async () => {
        const tabs = await splitOf(worker, live.windowId);
        return tabs[1]?.split === tabs[2]?.split && (tabs[1]?.split ?? 0) > 0;
      })
      .toBe(true);
    const after = await splitOf(worker, live.windowId);
    expect(after.find((t) => t.active)?.url).toBe(front?.url);
    expect(await stored(page)).toEqual(before);
  });

  test('20. into a live band and into the pinned run', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    await worker.evaluate(
      async ({ ids, pin, windowId }) => {
        await chrome.tabs.update(pin[0] ?? -1, { pinned: true });
        await chrome.tabs.update(pin[1] ?? -1, { pinned: true });
        await chrome.tabs.group({
          tabIds: ids as [number, ...number[]],
          createProperties: { windowId },
        });
      },
      {
        ids: [live.idOf('C'), live.idOf('D')],
        pin: [live.idOf('A'), live.idOf('B')],
        windowId: live.windowId,
      }
    );
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('D'))).toBeVisible();

    await lift(page, halfRow(page, 'h1'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('D'))));
    await page.mouse.up();
    await expect
      .poll(async () => (await strip(worker, live.windowId)).map((t) => t.url))
      .toEqual([
        dataUrl('A'),
        dataUrl('B'),
        dataUrl('C'),
        H1,
        H2,
        dataUrl('D'),
      ]);
    const banded = await splitOf(worker, live.windowId);
    expect(banded[3]?.groupId).toBe(banded[2]?.groupId);
    expect(banded[4]?.groupId).toBe(banded[2]?.groupId);
    await expect
      .poll(async () => {
        const t = await splitOf(worker, live.windowId);
        return t[3]?.split === t[4]?.split && (t[3]?.split ?? 0) > 0;
      })
      .toBe(true);

    await settled(page);
    await lift(page, halfRow(page, 'h2'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();
    await expect
      .poll(async () => (await strip(worker, live.windowId)).length)
      .toBe(8);
    // A tab just made reads no address until its load starts.
    await expect
      .poll(async () =>
        (await strip(worker, live.windowId)).slice(1, 3).map((t) => t.url)
      )
      .toEqual([H1, H2]);
    const pinnedNow = await splitOf(worker, live.windowId);
    expect(pinnedNow.slice(0, 4).map((t) => t.pinned)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    await expect
      .poll(async () => {
        const t = await splitOf(worker, live.windowId);
        return t[1]?.split === t[2]?.split && (t[1]?.split ?? 0) > 0;
      })
      .toBe(true);
  });

  test('21. on a New window target: a split in front, both real pages', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A']);
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('A'))).toBeVisible();
    const known = await windowIdsNow(worker);

    await lift(page, halfRow(page, 'h1'));
    const row = await boxOf(liveRow(page, live.idOf('A')));
    await carryTo(page, { x: row.x + 80, y: row.y + row.height + 90 });
    const target = page.locator('[data-new-window-target="open-now-last"]');
    await expect(target).toHaveAttribute('data-landing', /.*/);
    await page.mouse.up();

    await expect.poll(() => newestWindow(worker, known)).not.toBeNull();
    const made = (await newestWindow(worker, known)) ?? -1;
    await expect
      .poll(async () => (await strip(worker, made)).map((t) => t.url))
      .toEqual(expect.arrayContaining([H1, H2]));
    await expect
      .poll(async () => {
        const t = (await splitOf(worker, made)).filter(
          (x) => x.url === H1 || x.url === H2
        );
        return (
          t.length === 2 &&
          t[0]?.split === t[1]?.split &&
          (t[0]?.split ?? 0) > 0
        );
      })
      .toBe(true);
  });

  const groupOfPair = () =>
    session('S1', 'Trip', [
      win(
        'w1',
        [
          tab('a0'),
          tab('g0', 'day'),
          half('h1', 'day'),
          half('h2', 'day'),
          tab('g1', 'day'),
        ],
        [DAY]
      ),
    ]);

  test('22. a group holding a pair at a slot: the group, the split, both real pages', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await open(context, extensionId, [groupOfPair(), TARGET()]);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await lift(page, groupHandle(page, 'day'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();

    await expect
      .poll(async () => (await strip(worker, live.windowId)).length)
      .toBe(6);
    await expect
      .poll(async () => {
        const t = await splitOf(worker, live.windowId);
        const pair = t.filter((x) => x.url === H1 || x.url === H2);
        return (
          pair.length === 2 &&
          pair[0]?.split === pair[1]?.split &&
          (pair[0]?.split ?? 0) > 0 &&
          pair[0]?.groupId !== -1 &&
          pair[0]?.groupId === pair[1]?.groupId
        );
      })
      .toBe(true);
  });

  test('23. a group holding a pair on a New window target', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A']);
    const page = await open(context, extensionId, [groupOfPair(), TARGET()]);
    await expect(liveRow(page, live.idOf('A'))).toBeVisible();
    const known = await windowIdsNow(worker);

    await lift(page, groupHandle(page, 'day'));
    const row = await boxOf(liveRow(page, live.idOf('A')));
    await carryTo(page, { x: row.x + 80, y: row.y + row.height + 90 });
    await page.mouse.up();

    await expect.poll(() => newestWindow(worker, known)).not.toBeNull();
    const made = (await newestWindow(worker, known)) ?? -1;
    await expect
      .poll(async () => {
        const t = (await splitOf(worker, made)).filter(
          (x) => x.url === H1 || x.url === H2
        );
        return (
          t.length === 2 &&
          t[0]?.split === t[1]?.split &&
          (t[0]?.split ?? 0) > 0
        );
      })
      .toBe(true);
  });

  test('24. the spot over Currently open is two rows tall', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();
    const row = (await boxOf(liveRow(page, live.idOf('A')))).height;

    await lift(page, halfRow(page, 'h1'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.waitForTimeout(350);
    const slot = await boxOf(page.locator(`${OPEN_NOW} ${SLOT}`));
    expect(Math.abs(slot.height - 2 * row)).toBeLessThan(3);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('25. Skip tabs already open: both halves open, nothing opens', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A']);
    await worker.evaluate(
      async ({ windowId, urls }) => {
        for (const url of urls) await chrome.tabs.create({ windowId, url });
      },
      { windowId: live.windowId, urls: [H1, H2] }
    );
    const page = await open(context, extensionId, [TRIP(), TARGET()], {
      skipTabsAlreadyOpen: true,
    });
    await expect(liveRow(page, live.idOf('A'))).toBeVisible();

    await lift(page, halfRow(page, 'h1'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('A'))));
    await page.mouse.up();
    await expect(
      page.locator('[data-toast]', {
        hasText: 'This window already has these tabs.',
      })
    ).toHaveCount(1);
    // Each page once: CI can open the tab view in this same window, so its count isn't fixed.
    const urls = (await strip(worker, live.windowId)).map((t) => t.url);
    expect(urls.filter((url) => url === H1)).toHaveLength(1);
    expect(urls.filter((url) => url === H2)).toHaveLength(1);
  });
});

// Every tab of H1's or H2's address, wherever it is.
const pairTabs = (worker: Worker) =>
  worker.evaluate(
    async (urls) => {
      const all = await chrome.tabs.query({});
      return all
        .filter((t) => urls.includes(t.pendingUrl || t.url || ''))
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          id: t.id ?? -1,
          url: t.pendingUrl || t.url || '',
          windowId: t.windowId,
          index: t.index,
          split: Reflect.get(t, 'splitViewId') as number,
          active: t.active,
        }));
    },
    [H1, H2]
  );

const halfButton = (page: Page, id: string) =>
  halfRow(page, id).getByRole('button', { name: new RegExp(`Tab ${id}$`) });

// True once the two tabs read as one split, side by side.
const splitTogether = async (worker: Worker) => {
  const [a, b] = await pairTabs(worker);
  return (
    a !== undefined &&
    b !== undefined &&
    a.windowId === b.windowId &&
    b.index === a.index + 1 &&
    a.split > 0 &&
    a.split === b.split
  );
};

const openApart = (worker: Worker, windowId: number, urls: string[]) =>
  worker.evaluate(
    async ({ windowId, urls }) => {
      for (const url of urls) {
        await chrome.tabs.create({ windowId, url, active: false });
      }
    },
    { windowId, urls }
  );

test.describe('a click on a saved pair (KAN-942)', () => {
  test('29. neither open: both open split, in front, the clicked half forward', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await open(context, extensionId);
    await halfButton(page, 'h2').click();
    await expect.poll(() => splitTogether(worker)).toBe(true);
    await expect
      .poll(async () => (await pairTabs(worker)).find((t) => t.active)?.url)
      .toBe(H2);
    // Polled: a loading tab can read a blank url for a moment (KAN-943).
    await expect
      .poll(async () => (await pairTabs(worker)).map((t) => t.url))
      .toEqual([H1, H2]);
  });

  test('30. ⌘-click: both open split, behind', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await open(context, extensionId);
    await halfButton(page, 'h1').click({ modifiers: ['ControlOrMeta'] });
    await expect.poll(() => splitTogether(worker)).toBe(true);
    expect((await pairTabs(worker)).some((t) => t.active)).toBe(false);
  });

  test('31. both open as a split: switches to it, opens nothing', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A']);
    await openApart(worker, live.windowId, [H1, H2]);
    await expect.poll(async () => (await pairTabs(worker)).length).toBe(2);
    const [a, b] = await pairTabs(worker);
    await splitTabs(worker, [a?.id ?? -1, b?.id ?? -1]);
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('A'))).toBeVisible();

    await halfButton(page, 'h2').click();
    await expect
      .poll(async () => (await pairTabs(worker)).find((t) => t.active)?.url)
      .toBe(H2);
    expect(await pairTabs(worker)).toHaveLength(2);
  });

  test('32. both open apart: switches to the clicked half, opens nothing', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A']);
    await openApart(worker, live.windowId, [H1, H2]);
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('A'))).toBeVisible();

    await halfButton(page, 'h1').click();
    await expect
      .poll(async () => (await pairTabs(worker)).find((t) => t.active)?.url)
      .toBe(H1);
    expect(await pairTabs(worker)).toHaveLength(2);
  });

  test('33. one half open: opens both, split', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A']);
    await openApart(worker, live.windowId, [H1]);
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('A'))).toBeVisible();

    await halfButton(page, 'h1').click();
    await expect.poll(async () => (await pairTabs(worker)).length).toBe(3);
    await expect
      .poll(async () => {
        const tabs = await pairTabs(worker);
        return tabs.filter((t) => t.split > 0).length;
      })
      .toBe(2);
  });

  test('34. the menu’s Open in new tab opens the one half', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await open(context, extensionId);
    await halfRow(page, 'h1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click();
    await expect.poll(async () => (await pairTabs(worker)).length).toBe(1);
  });
});

const endSplitItem = (page: Page) =>
  page.getByRole('menuitem', { name: 'End split view' });

test.describe('End split view (KAN-942)', () => {
  test('26. saved: from either half, two plain rows, with undo and redo', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    for (const pressed of ['h1', 'h2']) {
      await halfRow(page, pressed).click({ button: 'right' });
      await endSplitItem(page).click();
      await expect(tabHandle(page, 'h2')).toHaveCount(1);
      expect(
        (await tabsOf(page, 'w1')).filter((t) => t.splitId !== undefined)
      ).toHaveLength(0);
      await undoPress(page);
      await expect(tabHandle(page, 'h2')).toHaveCount(0);
      await redoPress(page);
      await expect(tabHandle(page, 'h2')).toHaveCount(1);
      await undoPress(page);
      await expect(tabHandle(page, 'h2')).toHaveCount(0);
    }
    expect(await layout(page, 'S1')).toEqual(START);
  });

  test('27. live: from either half; order, pin, group and front tab stay; undo and redo', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B', 'C', 'D']);
    await splitTabs(worker, [live.idOf('B'), live.idOf('C')]);
    const page = await open(context, extensionId);
    await expect(liveRow(page, live.idOf('C'))).toBeVisible();
    const order = await strip(worker, live.windowId);
    const front = (await splitOf(worker, live.windowId)).find((t) => t.active);
    const inSplit = async () =>
      (await splitOf(worker, live.windowId)).filter((t) => t.split > 0).length;

    for (const title of ['B', 'C']) {
      await liveRow(page, live.idOf(title)).click({ button: 'right' });
      await endSplitItem(page).click();
      await expect.poll(inSplit).toBe(0);
      expect(await strip(worker, live.windowId)).toEqual(order);
      expect(
        (await splitOf(worker, live.windowId)).find((t) => t.active)?.url
      ).toBe(front?.url);
      await expect(
        liveRow(page, live.idOf('B')).locator('[data-split]')
      ).toHaveCount(0);

      await undoPress(page);
      await expect.poll(inSplit).toBe(2);
      await redoPress(page);
      await expect.poll(inSplit).toBe(0);
      await undoPress(page);
      await expect.poll(inSplit).toBe(2);
      await expect(
        liveRow(page, live.idOf('B')).locator('[data-split]')
      ).toHaveCount(1);
    }
    expect(await strip(worker, live.windowId)).toEqual(order);
  });

  test('28. the item is absent on a plain tab and a broken pair', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, [
      session('S1', 'Trip', [
        win('w1', [
          half('x1'),
          tab('m'),
          half('x2'),
          half('h1', undefined, 'k'),
          half('h2', undefined, 'k'),
        ]),
      ]),
      TARGET(),
    ]);
    for (const row of ['m', 'x1']) {
      await halfRow(page, row).click({ button: 'right' });
      await expect(page.getByRole('menuitem').first()).toBeVisible();
      await expect(endSplitItem(page)).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await halfRow(page, 'h1').click({ button: 'right' });
    await expect(endSplitItem(page)).toHaveCount(1);
  });
});

async function splitTabs(worker: Worker, ids: [number, number]) {
  await worker.evaluate(async (tabIds) => {
    const createSplit: unknown = Reflect.get(chrome.tabs, 'createSplit');
    if (typeof createSplit !== 'function') throw new Error('no createSplit');
    await Reflect.apply(createSplit, chrome.tabs, [tabIds]);
  }, ids);
}

ungrantedTest.describe('without the grant (KAN-942)', () => {
  ungrantedTest(
    '18. a pair still moves as one, and draws no band',
    async ({ context, extensionId }) => {
      const page = await open(context, extensionId);
      await expect(page.locator('[data-band-id]')).toHaveCount(0);
      await drop(page, halfRow(page, 'h1'), 'tab:a2', 0.75);
      await expect
        .poll(() => layout(page, 'S1'))
        .toEqual(['a0 a1 a2 h1 h2 g0* g1*', 'b0 b1']);
      await expectPair(page, 'w1');
    }
  );
});
