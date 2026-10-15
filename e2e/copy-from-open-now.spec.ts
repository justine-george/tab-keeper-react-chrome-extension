import type { BrowserContext, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  CARD,
  S1,
  S2,
  S3,
  S4,
  aimAt,
  carryTargets,
  chromeNow,
  onto,
  openTabView,
  seed,
  selected,
  session,
  sessionOf,
  sessionRow,
  settled,
  tab,
  toasts,
  win,
} from './fixtures/betweenSessions';
import { boxOf, saveRowAim, stored } from './fixtures/sessionDrag';
import { allowInIncognito } from './fixtures/incognito';
import { seedSettings } from './fixtures/seed';
import type { TabMasterContainer } from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-280 Part F (spec O12c) on the real artifact: a live tab, group or window dragged out of Open now and let go on
// a saved session saves a copy there. Chrome is never touched: every test reads Chrome's tabs before and after.
//
// Every live tab is a data: page in a window the worker opens unfocused, so the tab view stays the page under the
// pointer. The tab view is side by side (1280x800): the session list, the saved detail, then Open now.

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

// A live window of one tab per title; Chrome's tab ids by title.
async function openLiveWindow(worker: Worker, titles: string[]) {
  const made = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const ids = (win?.tabs ?? []).flatMap((t) =>
      t.id === undefined ? [] : [t.id]
    );
    if (win?.id === undefined || ids.length !== urls.length) return null;
    return { windowId: win.id, tabIds: ids };
  }, titles.map(dataUrl));
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  const idOf = (title: string) => {
    const id = made.tabIds[titles.indexOf(title)];
    if (id === undefined) throw new Error(`no tab ${title}`);
    return id;
  };
  return { windowId: made.windowId, idOf };
}

const liveRow = (page: Page, tabId: number) =>
  page.locator(`[data-open-tab-id="${tabId}"]`);

// Presses a live row and moves past the activation distance: held in Open now, shown by its card (KAN-611), no carry
// yet. Under the saved search there is no card: the drag can't leave Open now (KAN-610).
async function pickUpLive(page: Page, tabId: number, card = true) {
  const b = await boxOf(liveRow(page, tabId));
  const x = b.x + Math.min(60, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect(page.locator('[data-drag-held]')).toHaveCount(1);
  await expect(page.locator('[data-drag-card]')).toHaveCount(card ? 1 : 0);
  await expect(page.locator(CARD)).toHaveCount(0);
  return { x, y: y + 10 };
}

// Out of Open now's pane to the left (P1): the card shows, with its + badge.
async function carryOutOfOpenNow(page: Page, y: number) {
  const pane = await boxOf(page.locator('[data-pane="open-now"]'));
  await page.mouse.move(pane.x - 40, y, { steps: 6 });
  await expect(page.locator(CARD)).toHaveCount(1);
  await expect(page.locator(`${CARD} [data-carry-card-badge]`)).toHaveCount(1);
}

// The urls of each window of a stored session, in order.
const urlsOf = async (page: Page, id: string) =>
  sessionOf(await stored(page), id).windows.map((w) =>
    w.tabs.map((t) => t.url)
  );

// One undo takes the copy back: every session as before, but the stamps the undo moves on, and the selection,
// which a spring-open changed as navigation (an undo never navigates).
async function expectUndoRestores(page: Page, before: TabMasterContainer) {
  const os = await page.evaluate(
    async () => (await chrome.runtime.getPlatformInfo()).os
  );
  await page.keyboard.press(os === 'mac' ? 'Meta+z' : 'Control+z');
  const unstamped = (c: TabMasterContainer) =>
    c.tabGroups.map((g) => ({
      ...g,
      lastModified: undefined,
      contentModified: undefined,
      isSelected: undefined,
    }));
  await expect
    .poll(async () => unstamped(await stored(page)))
    .toEqual(unstamped(before));
}

const SPRING_OPEN_MS = 600;

// The live group of a window, titled and coloured as given.
const groupLive = (
  worker: Worker,
  windowId: number,
  tabIds: number[],
  title: string,
  color: `${chrome.tabGroups.Color}`
) =>
  worker.evaluate(
    async ({ windowId, tabIds, title, color }) => {
      const [first, ...rest] = tabIds;
      if (first === undefined) throw new Error('no tabs to group');
      // In their own window: with no windowId Chrome moves them into the focused one.
      const groupId = await chrome.tabs.group({
        tabIds: [first, ...rest],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, { title, color });
      return groupId;
    },
    { windowId, tabIds, title, color }
  );

const openNowWindowHandle = (page: Page, windowId: number) =>
  page.locator(
    `[data-open-window-id="${windowId}"] [data-open-window-drag-handle]`
  );
const openNowGroupHandle = (page: Page, windowId: number) =>
  page.locator(`[data-open-window-id="${windowId}"] [data-group-drag-handle]`);

// Presses a handle and moves past the activation distance, without asking what picked up.
async function press(page: Page, handle: ReturnType<Page['locator']>) {
  const b = await boxOf(handle);
  const x = b.x + Math.min(40, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  return { x, y: y + 10 };
}

async function openTabViewFolded(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seed(context, [S1(), S2(), S3(), S4()], 'S1');
  await seedSettings(context, { foldSavedSessionInTabView: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await expect(sessionRow(page, 'S1')).toBeVisible();
  // PREMISE: folded, no saved detail is drawn (O4).
  await expect(page.locator('[data-pane="detail"]')).toHaveCount(0);
  return page;
}

test.describe('a copy from Open now (KAN-280 Part F)', () => {
  test('1. a tab onto a session row: a new first window there, "Copied to" with Show; Chrome untouched', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false, [
      S1(),
      S2(),
      S3(),
      S4(),
    ]);
    const live = await openLiveWindow(serviceWorker, ['Live A', 'Live B']);
    await expect(liveRow(page, live.idOf('Live B'))).toBeVisible();
    const chromeBefore = await chromeNow(serviceWorker);

    const at = await pickUpLive(page, live.idOf('Live B'));
    await carryOutOfOpenNow(page, at.y);
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(async () =>
        sessionOf(await stored(page), 'S2').windows[0]?.tabs.map((t) => t.url)
      )
      .toEqual([dataUrl('Live B')]);
    expect(sessionOf(await stored(page), 'S2').windows).toHaveLength(3);
    expect(await selected(page)).toBe('S1');
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Copied to “Target”.', show: true }]);
    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await carryTargets(page)).toEqual([]);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
  });

  test('1b. Show selects the target; one undo takes the copy back', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    const before = await stored(page);

    const at = await pickUpLive(page, live.idOf('Live A'));
    await carryOutOfOpenNow(page, at.y);
    await onto(page, 'S2');
    await page.mouse.up();
    await expect.poll(() => toasts(page)).toHaveLength(1);
    await page
      .getByRole('status')
      .getByRole('button', { name: 'Show', exact: true })
      .click();
    await expect.poll(() => selected(page)).toBe('S2');

    await expectUndoRestores(page, before);
  });

  test('2. a tab straight into the session on screen, at an exact spot (P1): no detour, no toast', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    const before = await stored(page);
    const chromeBefore = await chromeNow(serviceWorker);

    const at = await pickUpLive(page, live.idOf('Live A'));
    await carryOutOfOpenNow(page, at.y);
    // Never over the session list: straight into S1's w1, above a1's middle.
    await aimAt(page, 'a1', 0.25);
    expect(await carryTargets(page)).toEqual([]);
    await page.mouse.up();

    await expect
      .poll(async () => (await urlsOf(page, 'S1'))[0])
      .toEqual([
        'https://a0.test/',
        dataUrl('Live A'),
        'https://a1.test/',
        'https://a2.test/',
        'https://al0.test/',
        'https://al1.test/',
      ]);
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Copied to “Source”.', show: false }]);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
    await expectUndoRestores(page, before);
  });

  test('3. a group: rest on a row to open it, then a slot between items; its name, colour and fold kept', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['G1', 'G2', 'Loose']);
    await groupLive(
      serviceWorker,
      live.windowId,
      [live.idOf('G1'), live.idOf('G2')],
      'Reading',
      'purple'
    );
    await expect(openNowGroupHandle(page, live.windowId)).toBeVisible();
    const before = await stored(page);

    const at = await press(page, openNowGroupHandle(page, live.windowId));
    await carryOutOfOpenNow(page, at.y);
    await onto(page, 'S2');
    await page.waitForTimeout(SPRING_OPEN_MS + 200);
    await expect.poll(() => selected(page)).toBe('S2');
    await expect(page.locator('[data-drag-row-id="d2"]')).toBeVisible();
    // Between d2's two tabs.
    await aimAt(page, 'e1', 0.25);
    await page.mouse.up();

    await expect
      .poll(async () => (await urlsOf(page, 'S2'))[1])
      .toEqual([
        'https://e0.test/',
        dataUrl('G1'),
        dataUrl('G2'),
        'https://e1.test/',
      ]);
    const d2 = sessionOf(await stored(page), 'S2').windows[1];
    expect(d2?.chromeTabGroups).toEqual([
      expect.objectContaining({ title: 'Reading', color: 'purple' }),
    ]);
    expect(d2?.chromeTabGroups?.[0]?.collapsed).toBeUndefined();
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Copied 2 tabs to “Target”.', show: false }]);
    await expectUndoRestores(page, before);
  });

  test('4. a window, between the shown windows, at the place Chrome has it at pick-up (P6)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['W A', 'W B']);
    await expect(openNowWindowHandle(page, live.windowId)).toBeVisible();
    // Moved after Open now listed it, with no tab event: the list's place is stale.
    const placed = await serviceWorker.evaluate(async (id) => {
      await chrome.windows.update(id, {
        left: 120,
        top: 90,
        width: 700,
        height: 520,
      });
      const w = await chrome.windows.get(id);
      return { left: w.left, top: w.top, width: w.width, height: w.height };
    }, live.windowId);
    const before = await stored(page);

    const at = await press(page, openNowWindowHandle(page, live.windowId));
    // D3 A: a carry from the first move, in the pane.
    await expect(page.locator(CARD)).toHaveCount(1);
    await page.mouse.move(at.x - 300, at.y, { steps: 6 });
    await aimAt(page, 'w2', 0.25);
    await page.mouse.up();

    await expect
      .poll(async () =>
        sessionOf(await stored(page), 'S1').windows.map((w) => w.tabs.length)
      )
      .toEqual([5, 2, 2]);
    const copied = sessionOf(await stored(page), 'S1').windows[1];
    expect(copied?.tabs.map((t) => t.url)).toEqual([
      dataUrl('W A'),
      dataUrl('W B'),
    ]);
    expect({
      left: copied?.windowOffsetLeft,
      top: copied?.windowOffsetTop,
      width: copied?.windowWidth,
      height: copied?.windowHeight,
    }).toEqual(placed);
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Copied 2 tabs to “Source”.', show: false }]);
    await expectUndoRestores(page, before);
  });

  test('5. the save row: a new session named by the tab, shown, no toast (N1 A)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['Recipe notes']);
    await expect(liveRow(page, live.idOf('Recipe notes'))).toBeVisible();
    const before = await stored(page);

    const at = await pickUpLive(page, live.idOf('Recipe notes'));
    await carryOutOfOpenNow(page, at.y);
    const aim = await saveRowAim(page);
    await page.mouse.move(aim.x, aim.y, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => (await stored(page)).tabGroups.length)
      .toBe(before.tabGroups.length + 1);
    const made = (await stored(page)).tabGroups[0];
    expect(made?.title).toBe('Recipe notes');
    expect(made?.windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      [dataUrl('Recipe notes')],
    ]);
    expect(await selected(page)).toBe(made?.tabGroupId);
    expect(await toasts(page)).toEqual([]);
    await expectUndoRestores(page, before);
  });

  // KAN-608: no duplicate check. A tab or window the session already holds is copied whole, and says so.
  test('6. duplicates land: a tab already there is copied again, a window lands whole', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const target = session('S2', 'Target', [
      win('d1', [
        { ...tab('k0'), url: dataUrl('Dup') },
        { ...tab('k1'), url: dataUrl('Dup two') },
      ]),
    ]);
    const page = await openTabView(context, extensionId, false, [
      S1(),
      target,
      S3(),
    ]);
    const live = await openLiveWindow(serviceWorker, [
      'Dup',
      'Dup two',
      'Fresh',
    ]);
    await expect(liveRow(page, live.idOf('Dup'))).toBeVisible();

    let at = await pickUpLive(page, live.idOf('Dup'));
    await carryOutOfOpenNow(page, at.y);
    await onto(page, 'S2');
    await page.mouse.up();
    await expect
      .poll(async () => (await urlsOf(page, 'S2'))[0])
      .toEqual([dataUrl('Dup')]);
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Copied to “Target”.', show: true }]);

    at = await press(page, openNowWindowHandle(page, live.windowId));
    await expect(page.locator(CARD)).toHaveCount(1);
    await page.mouse.move(at.x, at.y - 2, { steps: 2 });
    await onto(page, 'S2');
    await page.mouse.up();
    await expect
      .poll(async () => (await urlsOf(page, 'S2'))[0])
      .toEqual([dataUrl('Dup'), dataUrl('Dup two'), dataUrl('Fresh')]);
    expect(await urlsOf(page, 'S2')).toHaveLength(3);
    await expect
      .poll(async () => (await toasts(page)).map((t) => t.text))
      .toContain('Copied 3 tabs to “Target”.');
  });

  // KAN-607. Resting past the spring-open puts the session on screen: the copy still says so, with no Show.
  test('6b. rest on the row, then drop, twice: each copy lands and says "Copied to", with no Show', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['Rested']);
    await expect(liveRow(page, live.idOf('Rested'))).toBeVisible();

    for (const round of [1, 2]) {
      const at = await pickUpLive(page, live.idOf('Rested'));
      await carryOutOfOpenNow(page, at.y);
      await onto(page, 'S2');
      await expect.poll(() => selected(page)).toBe('S2');
      await page.mouse.up();
      await expect(page.locator(CARD)).toHaveCount(0);
      await expect
        .poll(async () =>
          (await urlsOf(page, 'S2'))
            .flat()
            .filter((u) => u === dataUrl('Rested'))
        )
        .toHaveLength(round);
    }
    await expect
      .poll(() => toasts(page))
      .toEqual([
        { text: 'Copied to “Target”.', show: false },
        { text: 'Copied to “Target”.', show: false },
      ]);
  });

  test('7. carried back over Open now and let go: cancelled, nothing saved (N4 A)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    const before = await stored(page);

    const at = await pickUpLive(page, live.idOf('Live A'));
    await carryOutOfOpenNow(page, at.y);
    await page.mouse.move(at.x, at.y + 30, { steps: 6 });
    // Justine's pick A: over Open now the card's contents fade and its + goes; the card itself stays opaque.
    await expect(page.locator(CARD)).toHaveCSS('opacity', '1');
    await expect(page.locator(`${CARD} [data-carry-card-name]`)).toHaveCSS(
      'opacity',
      '0.45'
    );
    await expect(page.locator(`${CARD} [data-carry-card-badge]`)).toBeHidden();
    await page.mouse.up();

    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
    expect(await toasts(page)).toEqual([]);
  });

  test('7b. adopted by the shown session, then let go over Open now level with its new-last-window block: cancelled (N4 A)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    const before = await stored(page);

    const at = await pickUpLive(page, live.idOf('Live A'));
    await carryOutOfOpenNow(page, at.y);
    // Into the shown session, onto its trailing block, where a release makes a new last window.
    const trailing = await boxOf(
      page.locator('[data-pane="detail"] [data-new-window-target="last"]')
    );
    const y = trailing.y + trailing.height / 2;
    await page.mouse.move(trailing.x + 60, y, { steps: 8 });
    await expect(page.locator('[data-carry-phantom]')).toHaveCount(1);
    // Then right, over Open now, at the same height.
    const openNow = await boxOf(page.locator('[data-pane="open-now"]'));
    // PREMISE: that height is inside Open now's pane.
    expect(y).toBeGreaterThan(openNow.y);
    expect(y).toBeLessThan(openNow.y + openNow.height);
    await page.mouse.move(openNow.x + openNow.width / 2, y, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
  });

  test("8. under Open now's search a tab row is carried out at once and copies; a group or window row does not pick up", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, [
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    await groupLive(
      serviceWorker,
      live.windowId,
      [live.idOf('Beta'), live.idOf('Gamma')],
      'Greek',
      'blue'
    );
    await expect(liveRow(page, live.idOf('Alpha'))).toBeVisible();
    await page.getByRole('textbox', { name: 'Search open tabs' }).fill('a');
    await expect(liveRow(page, live.idOf('Alpha'))).toBeVisible();

    const at = await press(page, liveRow(page, live.idOf('Alpha')));
    // Carried at once, the pointer still in Open now (O14c amended B).
    await expect(page.locator(CARD)).toHaveCount(1);
    await expect(page.locator('[data-drag-held]')).toHaveCount(0);
    await page.mouse.move(at.x - 300, at.y, { steps: 6 });
    await onto(page, 'S2');
    await page.mouse.up();
    await expect
      .poll(async () => (await urlsOf(page, 'S2'))[0])
      .toEqual([dataUrl('Alpha')]);

    for (const handle of [
      openNowWindowHandle(page, live.windowId),
      openNowGroupHandle(page, live.windowId),
    ]) {
      const p = await press(page, handle);
      await page.mouse.move(p.x - 300, p.y, { steps: 4 });
      await expect(page.locator(CARD)).toHaveCount(0);
      await expect(page.locator('[data-drag-held]')).toHaveCount(0);
      await page.mouse.up();
    }
  });

  test('9. folded: resting on the selected session opens it as a peek, an exact spot works, the fold setting stays (N3 A)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabViewFolded(context, extensionId);
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();

    const at = await pickUpLive(page, live.idOf('Live A'));
    const pane = await boxOf(page.locator('[data-pane="open-now"]'));
    await page.mouse.move(pane.x - 40, at.y, { steps: 6 });
    await expect(page.locator(CARD)).toHaveCount(1);
    await onto(page, 'S1');
    await page.waitForTimeout(SPRING_OPEN_MS + 200);
    await expect(page.locator('[data-drag-row-id="w1"]')).toBeVisible();
    await settled(page);
    await aimAt(page, 'a1', 0.25);
    await page.mouse.up();

    await expect
      .poll(async () => (await urlsOf(page, 'S1'))[0]?.[1])
      .toBe(dataUrl('Live A'));
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Copied to “Source”.', show: false }]);
    const fold = await page.evaluate(() => {
      const raw = localStorage.getItem('settingsData');
      return raw === null ? null : JSON.parse(raw).foldSavedSessionInTabView;
    });
    expect(fold).toBe(true);
  });

  test('10. narrow: the drawer slides away for the carry and comes back after the drop, and after Esc (N2 A)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(
      context,
      extensionId,
      false,
      [S1(), S2(), S3(), S4()],
      { width: 1024, height: 768 }
    );
    const live = await openLiveWindow(serviceWorker, ['Live A', 'Live B']);
    const rail = page.getByRole('button', { name: /^Open now/ });
    await rail.click();
    const drawer = page.getByRole('dialog');
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();

    for (const end of ['drop', 'esc'] as const) {
      // The drawer done sliding back in, as the user sees it stop.
      await settled(page);
      const id = end === 'drop' ? live.idOf('Live A') : live.idOf('Live B');
      const at = await pickUpLive(page, id);
      const box = await boxOf(drawer);
      await page.mouse.move(box.x - 60, at.y, { steps: 6 });
      await expect(page.locator(CARD)).toHaveCount(1);
      await expect(drawer).toHaveAttribute('data-carry-away', '');
      await expect(drawer).toBeHidden();
      if (end === 'drop') {
        await onto(page, 'S2');
        await page.mouse.up();
      } else {
        await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      await expect(page.locator(CARD)).toHaveCount(0);
      await expect(drawer).toBeVisible();
      await expect(rail).toHaveAttribute('aria-expanded', 'true');
    }
    expect((await urlsOf(page, 'S2'))[0]).toEqual([dataUrl('Live A')]);
  });

  test('10b. narrow: dropped in the saved detail where the drawer was, the copy lands; the shown session takes it once', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(
      context,
      extensionId,
      false,
      [S1(), S2(), S3(), S4()],
      { width: 1024, height: 768 }
    );
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await page.getByRole('button', { name: /^Open now/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    const box = await boxOf(drawer);
    // Every time a row becomes held, counted: an adoption marks the phantom held, a hand-back clears it.
    await page.evaluate(() => {
      const w = window as unknown as { __holds: number };
      w.__holds = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          // Set where it was absent: counted even if removed again before this runs.
          if (r.oldValue === null) {
            w.__holds += 1;
          }
        }
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-drag-held'],
        attributeOldValue: true,
      });
    });

    const at = await pickUpLive(page, live.idOf('Live A'));
    // Out of the drawer to the left, then back right over where it was, onto S1's a1.
    await page.mouse.move(box.x - 30, at.y, { steps: 6 });
    await expect(drawer).toHaveAttribute('data-carry-away', '');
    const a1 = await boxOf(page.locator('[data-drag-row-id="a1"]'));
    expect(a1.x + a1.width - 40).toBeGreaterThan(box.x);
    await page.mouse.move(a1.x + a1.width - 40, a1.y + a1.height * 0.25, {
      steps: 12,
    });
    await settled(page);
    await page.mouse.up();

    await expect
      .poll(async () => (await urlsOf(page, 'S1'))[0]?.[1])
      .toBe(dataUrl('Live A'));
    // The held Open now row, then the phantom adopted once: never handed back and forth.
    expect(
      await page.evaluate(
        () => (window as unknown as { __holds: number }).__holds
      )
    ).toBeLessThanOrEqual(2);
  });

  test('11. incognito: refused by a normal window, and a row drop makes a new window marked incognito (Q2 A)', async ({
    context,
    extensionId,
  }) => {
    await allowInIncognito(context, extensionId);
    const page = await openTabView(context, extensionId, false);
    expect(
      await page.evaluate(() => chrome.extension.isAllowedIncognitoAccess())
    ).toBe(true);
    const opened = await page.evaluate(async (url: string) => {
      const w = await chrome.windows.create({
        focused: false,
        incognito: true,
        url,
      });
      return w?.tabs?.[0]?.id ?? null;
    }, dataUrl('Private'));
    if (opened === null) throw new Error('no incognito tab');
    await expect(liveRow(page, opened)).toBeVisible();

    // Over S1's w1 a normal window refuses it: no row steps aside.
    let at = await pickUpLive(page, opened);
    await carryOutOfOpenNow(page, at.y);
    await aimAt(page, 'a1', 0.25);
    expect(
      await page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-drag-row-id="a1"]')?.style
            .transform ?? ''
      )
    ).not.toMatch(/translateY\((?!0px)/);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    at = await pickUpLive(page, opened);
    await carryOutOfOpenNow(page, at.y);
    await onto(page, 'S2');
    await page.mouse.up();
    await expect
      .poll(async () => sessionOf(await stored(page), 'S2').windows[0])
      .toMatchObject({
        incognito: true,
        tabs: [expect.objectContaining({ url: dataUrl('Private') })],
      });
  });

  // KAN-610 (reverses D5 A): while the saved search is active, nothing from Open now reaches the saved side.
  test('12. the saved search open: an Open now tab is never carried out, no row lights, nothing is saved', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openTabView(context, extensionId, false);
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Search saved tabs', exact: true })
      .fill('test');
    await expect(sessionRow(page, 'S2')).toBeVisible();
    const before = await stored(page);

    const at = await pickUpLive(page, live.idOf('Live A'), false);
    const pane = await boxOf(page.locator('[data-pane="open-now"]'));
    await page.mouse.move(pane.x - 40, at.y, { steps: 6 });
    const row = await boxOf(sessionRow(page, 'S2'));
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, {
      steps: 6,
    });
    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await carryTargets(page)).toEqual([]);
    await page.mouse.up();
    expect(await stored(page)).toEqual(before);
  });
});
