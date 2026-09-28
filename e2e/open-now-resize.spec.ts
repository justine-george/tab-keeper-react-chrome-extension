import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession } from './fixtures/seed';
import { rgbToHex } from './fixtures/pixels';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-321 (spec O1, O1a, O1b) on the real artifact: resizing Open now in the
// tab view (`index.html?view=tab`). jsdom has no layout, so the widths, the
// grip sitting on the line, a real pointer drag and its cursor, the first
// paint, and the two drag systems staying out of each other's way are only
// provable here.
//
// Widths (openNowWidth.ts): the default is 622 at 1600, 444 at 1280 and 340
// at 1100; the max is 764 at 1600, 444 at 1280 and 340 at 1100; the min is
// 300. The saved session keeps the rest after the 356px list.

const WIDE = { width: 1600, height: 900 };
const MEDIUM = { width: 1280, height: 900 };
const NARROWEST_SIDE_BY_SIDE = { width: 1100, height: 900 };
const RAIL = { width: 1024, height: 768 };
const POPUP = { width: 790, height: 550 };

const VIEW_TAB = 'index.html?view=tab';

const OPEN_NOW = '[data-pane="open-now"]';
const DETAIL = '[data-pane="detail"]';
const GRIP = '[data-resize-grip]';

// Marks a profile as seeded, so the seed below runs once and never again.
const SEEDED_MARK = 'e2eOpenNowResizeSeeded';

// ---- Pages and seeds ---------------------------------------------------------

async function openPage(
  context: BrowserContext,
  extensionId: string,
  path: string,
  viewport: { width: number; height: number }
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  // Barrier: goto resolves before React mounts. "Sort sessions" is in the
  // header of both the popup and the tab view.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  // The same barrier as openPage: reload resolves before React mounts too.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
}

// The saved session: one window of eight tabs, selected, so its rows sit
// side by side with Open now. Ids are the rows' drag ids.
const SAVED_IDS = [
  'saved-0',
  'saved-1',
  'saved-2',
  'saved-3',
  'saved-4',
  'saved-5',
  'saved-6',
  'saved-7',
];
const SAVED = buildSession({
  tabGroupId: 'resize',
  title: 'Resize session',
  isSelected: true,
  tabCount: SAVED_IDS.length,
  windows: [
    {
      windowId: 'w0',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: SAVED_IDS.length,
      title: 'Saved window',
      tabs: SAVED_IDS.map((tabId, i) => ({
        tabId,
        favicon: '',
        title: `Saved tab ${i}`,
        url: `https://saved-${i}.test/`,
      })),
    },
  ],
});
const SEEDED_CONTAINER = {
  ...buildContainer([SAVED]),
  selectedTabGroupId: SAVED.tabGroupId,
};

// Seeds the session and settings ONCE per profile. seed.ts's seeds are init
// scripts that re-run on every navigation and reload, so they would put back
// the width a drag saved (test 3 would pass a reload that lost it), and
// rewrite the session (making "unchanged" vacuous). The settings are merged
// over what the fixture's cloud-consent seed already wrote.
async function seedOnce(
  context: BrowserContext,
  settings: Record<string, unknown>
): Promise<void> {
  await context.addInitScript(
    ({ sessions, settings, mark }) => {
      try {
        if (window.localStorage.getItem(mark) !== null) return;
        const prior = window.localStorage.getItem('settingsData');
        const parsed: unknown = prior === null ? {} : JSON.parse(prior);
        const base =
          typeof parsed === 'object' && parsed !== null ? parsed : {};
        const wanted: unknown = JSON.parse(settings);
        const extra =
          typeof wanted === 'object' && wanted !== null ? wanted : {};
        window.localStorage.setItem(
          'settingsData',
          JSON.stringify({ ...base, ...extra })
        );
        window.localStorage.setItem('tabContainerData', sessions);
        window.localStorage.setItem(mark, '1');
      } catch {
        // Storage blocked; the assertions say so more clearly.
      }
    },
    {
      sessions: JSON.stringify(SEEDED_CONTAINER),
      settings: JSON.stringify({
        foldSavedSessionInTabView: false,
        ...settings,
      }),
      mark: SEEDED_MARK,
    }
  );
}

// ---- Measuring ---------------------------------------------------------------

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

// The first element matching `selector`, measured; null when there is none.
const boxOf = (page: Page, selector: string): Promise<Box | null> =>
  page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  }, selector);

async function need(page: Page, selector: string): Promise<Box> {
  const box = await boxOf(page, selector);
  if (box === null) throw new Error(`nothing matches ${selector}`);
  return box;
}

const widthOf = async (page: Page, selector: string): Promise<number> =>
  Math.round((await need(page, selector)).width);

// Waits for Open now to be drawn `width` wide.
async function expectOpenNow(page: Page, width: number): Promise<void> {
  await expect
    .poll(() => widthOf(page, OPEN_NOW), {
      message: `Open now never became ${width}px wide`,
    })
    .toBe(width);
}

// The width this device stored: a number, or null for the default (an
// absent key is the default too). Anything else would be a garbage value.
const storedWidth = (page: Page): Promise<number | null | 'garbage'> =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('settingsData');
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return 'garbage';
    if (!('openNowWidth' in parsed)) return null;
    const width = parsed.openNowWidth;
    if (width === null || width === undefined) return null;
    return typeof width === 'number' ? width : 'garbage';
  });

const storedSessions = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.localStorage.getItem('tabContainerData'));

// The saved window's tab order as stored.
const storedTabOrder = (page: Page): Promise<string[]> =>
  page.evaluate((id) => {
    const raw = window.localStorage.getItem('tabContainerData');
    if (raw === null) return [];
    // Each step read as unknown and checked: the stored JSON is data.
    const field = (value: unknown, key: string): unknown =>
      typeof value === 'object' && value !== null && key in value
        ? Object.getOwnPropertyDescriptor(value, key)?.value
        : undefined;
    const list = (value: unknown): unknown[] =>
      Array.isArray(value) ? value : [];
    const session = list(field(JSON.parse(raw), 'tabGroups')).find(
      (group) => field(group, 'tabGroupId') === id
    );
    const firstWindow = list(field(session, 'windows'))[0];
    return list(field(firstWindow, 'tabs')).flatMap((tab) => {
      const tabId = field(tab, 'tabId');
      return typeof tabId === 'string' ? [tabId] : [];
    });
  }, SAVED.tabGroupId);

// The grip's centre: where a user presses it.
async function gripCentre(page: Page): Promise<{ x: number; y: number }> {
  const grip = await need(page, GRIP);
  return {
    x: (grip.left + grip.right) / 2,
    y: (grip.top + grip.bottom) / 2,
  };
}

// Presses the grip, moves by `dx` in steps (negative is left, which widens
// Open now), and releases unless told not to.
async function dragGrip(
  page: Page,
  dx: number,
  { release = true, dy = 0 }: { release?: boolean; dy?: number } = {}
): Promise<{ x: number; y: number }> {
  const from = await gripCentre(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 20 });
  if (release) await page.mouse.up();
  return { x: from.x + dx, y: from.y + dy };
}

const rootHas = (page: Page, name: string): Promise<boolean> =>
  page.evaluate((n) => document.documentElement.hasAttribute(n), name);

declare global {
  interface Window {
    __rootFlagLog?: string[];
    __openNowFirstWidths?: { at: string; width: number }[];
    __settingsWrites?: (number | null | 'garbage')[];
    __previewOf?: (pane: string, ids: string[]) => Preview;
    __previewAtRelease?: Preview | null;
    __releaseX?: number | null;
  }
}

// Records every change to the two root drag flags from now on, in order, as
// "name=value" ("name=null" when removed). A poll can miss a flag that came
// and went between two reads; this cannot.
async function watchRootFlags(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = [];
    window.__rootFlagLog = log;
    new MutationObserver((records) => {
      for (const record of records) {
        const name = record.attributeName;
        if (name === null) continue;
        log.push(`${name}=${document.documentElement.getAttribute(name)}`);
      }
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-dragging', 'data-resizing'],
    });
  });
}

const rootFlagLog = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__rootFlagLog ?? []);

// Records every settingsData write's openNowWidth from now on, so "saved
// once" can be counted rather than inferred from the final value.
async function watchSettingsWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const writes: (number | null | 'garbage')[] = [];
    window.__settingsWrites = writes;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'settingsData') {
        const parsed: unknown = JSON.parse(value);
        const width =
          typeof parsed === 'object' &&
          parsed !== null &&
          'openNowWidth' in parsed
            ? parsed.openNowWidth
            : null;
        writes.push(
          width === null || typeof width === 'number' ? width : 'garbage'
        );
      }
      original.call(this, key, value);
    };
  });
}

const settingsWrites = (page: Page): Promise<(number | null | 'garbage')[]> =>
  page.evaluate(() => window.__settingsWrites ?? []);

// The computed cursor of whatever is at a point: what the user sees there.
const cursorAt = (page: Page, x: number, y: number): Promise<string | null> =>
  page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el === null ? null : getComputedStyle(el).cursor;
    },
    { x, y }
  );

const centreOf = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) throw new Error('the target has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

const savedRow = (page: Page, id: string): Locator =>
  page.locator(`${DETAIL} [data-drag-row-id="${id}"]`);

const foldButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Fold the saved session away',
    exact: true,
  });

// ---- Row drags: where the user pointed -------------------------------------

// The drag as the user sees it: the held row, and how many of the list's
// other rows sit above the landing slot once every row has reached its
// commanded place. The list is `ids`, in order, inside `pane`.
interface Preview {
  held: string | null;
  index: number | null;
}

// Installs, in the page, the one reading of the preview every assertion uses.
// Positions are COMMANDED ones: a row's box, minus the part of its transform
// still easing, plus the transform it was told to take (open-now-drag.spec).
async function installPreviewReader(page: Page): Promise<void> {
  await page.evaluate(() => {
    const commanded = (el: HTMLElement) =>
      Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);
    const current = (el: HTMLElement) =>
      new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top - current(el) + commanded(el) + r.height / 2;
    };
    window.__previewOf = (pane, ids) => {
      const rows = ids.flatMap((id) => {
        const el = document.querySelector<HTMLElement>(
          `${pane} [data-drag-row-id="${id}"]`
        );
        return el === null ? [] : [el];
      });
      const held = rows.find((row) => row.hasAttribute('data-drag-held'));
      if (held === undefined) return { held: null, index: null };
      const heldId = held.getAttribute('data-drag-row-id');
      const slot = held.querySelector('[data-drag-landing-slot]');
      if (slot === null) return { held: heldId, index: null };
      const box = slot.getBoundingClientRect();
      const c = (box.top + box.bottom) / 2;
      const index = rows.filter(
        (row) => row !== held && centre(row) < c
      ).length;
      return { held: heldId, index };
    };
  });
}

const previewNow = (page: Page, pane: string, ids: string[]) =>
  page.evaluate(({ pane, ids }) => window.__previewOf?.(pane, ids) ?? null, {
    pane,
    ids,
  });

// Releases, reading the preview at the instant of release in a capture-phase
// pointerup, before the engine's own handler (window-drag.spec's recipe).
async function releaseReadingPreview(
  page: Page,
  pane: string,
  ids: string[]
): Promise<Preview> {
  await page.evaluate(
    ({ pane, ids }) => {
      window.__previewAtRelease = null;
      window.addEventListener(
        'pointerup',
        () => {
          window.__previewAtRelease = window.__previewOf?.(pane, ids) ?? null;
        },
        { capture: true, once: true }
      );
    },
    { pane, ids }
  );
  await page.mouse.up();
  const preview = await page.evaluate(() => window.__previewAtRelease ?? null);
  if (preview === null) throw new Error('nothing recorded at release');
  return preview;
}

// Presses a row and moves past the activation distance, then requires that
// a row is held.
async function pickUp(page: Page, row: Locator) {
  const { box } = await centreOf(row);
  const x = box.x + 60;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect
    .poll(
      () => page.evaluate(() => !!document.querySelector('[data-drag-held]')),
      {
        message: 'the row was never picked up',
        timeout: 3000,
      }
    )
    .toBe(true);
  return { x, y: y + 10 };
}

// Moves with the row held, then rests past DURATION.MOVE (200ms) so the rows
// have eased to their commanded places, as a user pausing to aim sees them.
async function moveHeld(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(350);
}

// Where the saved list's scrolling pane is, and whether it scrolls.
const detailScroll = (page: Page) =>
  page.evaluate((first) => {
    let el =
      document.querySelector(
        `[data-pane="detail"] [data-drag-row-id="${first}"]`
      )?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (el === null) return null;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  }, SAVED_IDS[0]);

// What a row drag passing over the grip observed there, and how it ended.
interface OverTheGrip {
  gripHovered: boolean;
  dotColour: string;
  chipColour: string;
  gripCursor: string;
  openNowWidth: number;
  resizingMidDrag: boolean;
  preview: Preview;
}

// Test 8 and test 10's gesture: pick up saved-5, carry it across the grip
// (resting there, pointer over the chip), then back into the list to aim
// just inside saved-1's top edge, and release.
async function dragSavedRowOverTheGrip(page: Page): Promise<OverTheGrip> {
  await installPreviewReader(page);
  const start = await pickUp(page, savedRow(page, 'saved-5'));
  const grip = await gripCentre(page);

  // Over the grip's chip: its centre, where the dots are.
  await moveHeld(page, grip.x, grip.y);
  const over = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const dot = el?.querySelector(':scope > span > span') ?? null;
    const chip = el?.querySelector(':scope > span') ?? null;
    return {
      gripHovered: el?.matches(':hover') ?? false,
      dotColour: dot === null ? '' : getComputedStyle(dot).backgroundColor,
      chipColour: chip === null ? '' : getComputedStyle(chip).backgroundColor,
      gripCursor: el === null ? '' : getComputedStyle(el).cursor,
      resizingMidDrag: document.documentElement.hasAttribute('data-resizing'),
    };
  }, GRIP);
  const openNowWidth = await widthOf(page, OPEN_NOW);

  // Back into the list, aimed just inside saved-1's top edge.
  const target = (await centreOf(savedRow(page, 'saved-1'))).box;
  await moveHeld(page, start.x, target.y + 6);
  const preview = await releaseReadingPreview(page, DETAIL, SAVED_IDS);
  return { ...over, openNowWidth, preview };
}

// ---- Open now rows (test 9) --------------------------------------------------

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

// A window the browser opens, unfocused so the tab view stays in front, with
// one tab per title, in order.
async function openWindow(
  worker: Worker,
  titles: string[]
): Promise<{ windowId: number; tabIds: number[] }> {
  const opened = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const tabIds = (win?.tabs ?? []).flatMap((tab) =>
      tab.id === undefined ? [] : [tab.id]
    );
    if (win?.id === undefined || tabIds.length !== urls.length) return null;
    return { windowId: win.id, tabIds };
  }, titles.map(dataUrl));
  if (opened === null) throw new Error('Chrome gave no window or tab ids');
  return opened;
}

const chromeOrder = (worker: Worker, windowId: number): Promise<number[]> =>
  worker.evaluate(
    async (windowId) =>
      (await chrome.tabs.query({ windowId })).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      ),
    windowId
  );

// Open now's scrolling pane, and whether it scrolls.
const openNowScroll = (page: Page) =>
  page.evaluate(() => {
    let el =
      document.querySelector('[data-open-window-id]')?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (el === null) return null;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });

// ---- The tests ---------------------------------------------------------------

test.describe('resizing Open now (KAN-321 O1, O1a)', () => {
  test('1. a drag on the grip widens the real column, and saves only on release', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    // The first frames Open now is drawn in, recorded from before the app's
    // own scripts run: the width must be right on first paint, never a 0px
    // (or unresolved) track that snaps a frame later.
    await context.addInitScript(() => {
      const widths: { at: string; width: number }[] = [];
      window.__openNowFirstWidths = widths;
      const read = () => {
        const el = document.querySelector('[data-pane="open-now"]');
        return el === null ? null : el.getBoundingClientRect().width;
      };
      const observer = new MutationObserver(() => {
        const width = read();
        if (width === null) return;
        widths.push({ at: 'inserted', width });
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
      const frame = () => {
        const width = read();
        if (width !== null) widths.push({ at: 'frame', width });
        if (widths.filter((w) => w.at === 'frame').length < 3)
          requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);

    // PREMISES. The default at 1600, nothing stored, and the grip centred on
    // the line (Open now's left edge).
    await expectOpenNow(page, 622);
    expect(await storedWidth(page)).toBeNull();
    const firstWidths = await page.evaluate(
      () => window.__openNowFirstWidths ?? []
    );
    expect(firstWidths.length).toBeGreaterThan(0);
    expect(firstWidths.map((w) => Math.round(w.width))).toEqual(
      firstWidths.map(() => 622)
    );
    const line = await need(page, OPEN_NOW);
    const grip = await gripCentre(page);
    expect(Math.abs(grip.x - line.left)).toBeLessThanOrEqual(1);

    // At rest a saved row shows its own cursor; mid-drag it must not.
    const row = await centreOf(savedRow(page, 'saved-2'));
    expect(await cursorAt(page, row.x, row.y)).toBe('pointer');

    const end = await dragGrip(page, -100, { release: false });
    await expectOpenNow(page, 722);
    // Mid-drag: nothing saved yet (O1a: saved on release), the root flag is
    // set, and a row under a straying pointer shows the resize cursor.
    expect(await storedWidth(page)).toBeNull();
    expect(await rootHas(page, 'data-resizing')).toBe(true);
    expect(await cursorAt(page, row.x, row.y)).toBe('col-resize');
    await page.mouse.up();

    await expect.poll(() => storedWidth(page)).toBe(722);
    await expectOpenNow(page, 722);
    expect(await rootHas(page, 'data-resizing')).toBe(false);
    const detail = await need(page, DETAIL);
    const openNow = await need(page, OPEN_NOW);
    expect(Math.abs(detail.right - openNow.left)).toBeLessThanOrEqual(1);
    // The grip followed the line.
    expect(
      Math.abs((await gripCentre(page)).x - openNow.left)
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(end.x - openNow.left)).toBeLessThanOrEqual(1);
  });

  test('2. the drag stops at its limits, and a release outside the window still ends it', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 622);

    // 400px left at 1600: the max, 764, leaves the saved session its 480.
    await dragGrip(page, -400);
    await expectOpenNow(page, 764);
    expect(await widthOf(page, DETAIL)).toBe(480);
    await expect.poll(() => storedWidth(page)).toBe(764);

    // Far right (500px from 764 would be 264): stops at the min, 300.
    await dragGrip(page, 500);
    await expectOpenNow(page, 300);
    await expect.poll(() => storedWidth(page)).toBe(300);

    // At 1100 the range is 300..340. Dragged far left, past the window's
    // own left edge, and released out there.
    await page.setViewportSize(NARROWEST_SIDE_BY_SIDE);
    await expectOpenNow(page, 300);
    await watchSettingsWrites(page);
    await watchRootFlags(page);
    await page.evaluate(() => {
      window.__releaseX = null;
      window.addEventListener(
        'pointerup',
        (event) => {
          window.__releaseX = event.clientX;
        },
        { capture: true, once: true }
      );
    });
    const from = await gripCentre(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(-40, from.y, { steps: 30 });
    await expectOpenNow(page, 340);
    expect(await rootHas(page, 'data-resizing')).toBe(true);
    await page.mouse.up();

    // PREMISE: the release really happened outside the window.
    expect(await page.evaluate(() => window.__releaseX ?? null)).toBe(-40);
    await expect.poll(() => storedWidth(page)).toBe(340);
    expect(await widthOf(page, DETAIL)).toBe(404);
    expect(await rootHas(page, 'data-resizing')).toBe(false);
    // Saved once, and the flag came and went once.
    expect(await settingsWrites(page)).toEqual([340]);
    expect(await rootFlagLog(page)).toEqual([
      'data-resizing=',
      'data-resizing=null',
    ]);
  });

  test('3. the width survives a reload, and lives on this device only', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 622);
    const sessionsBefore = await storedSessions(page);
    // PREMISE: the session is the one seeded, so "unchanged" means something.
    expect(sessionsBefore).toBe(JSON.stringify(SEEDED_CONTAINER));

    await dragGrip(page, -100);
    await expect.poll(() => storedWidth(page)).toBe(722);

    await reload(page);
    await expectOpenNow(page, 722);
    expect(await storedWidth(page)).toBe(722);
    // Device-local: never in the synced sessions, which are byte for byte
    // what they were.
    const sessionsAfter = await storedSessions(page);
    expect(sessionsAfter).not.toContain('openNowWidth');
    expect(sessionsAfter).toBe(sessionsBefore);
  });

  test('4. a window that narrows clamps the shown width, and widening gives it back', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, { openNowWidth: 700 });
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 700);
    expect(await storedWidth(page)).toBe(700);

    await page.setViewportSize(MEDIUM);
    await expectOpenNow(page, 444);
    expect(await widthOf(page, DETAIL)).toBe(480);
    // Only the SHOWN width is clamped; the user's choice is kept.
    expect(await storedWidth(page)).toBe(700);

    await page.setViewportSize(WIDE);
    await expectOpenNow(page, 700);
    expect(await storedWidth(page)).toBe(700);
  });

  test('5. the grip is reached by Tab, steps with the arrow keys, and resets on a double-click', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 622);

    // A real Tab walk from a known control: Open now's fold button.
    await foldButton(page).focus();
    const walk: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const at = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null) return 'nothing';
        if (el.hasAttribute('data-resize-grip')) return 'GRIP';
        return el.getAttribute('aria-label') ?? el.tagName;
      });
      walk.push(at);
      if (at === 'GRIP') break;
    }
    expect(walk[walk.length - 1], `Tab walk: ${walk.join(' > ')}`).toBe('GRIP');
    const grip = page.getByRole('separator', { name: 'Resize Open now' });
    await expect(grip).toBeFocused();
    // Keyboard focus, so the ring shows.
    expect(await grip.evaluate((el) => el.matches(':focus-visible'))).toBe(
      true
    );
    await expect(grip).toHaveAttribute('aria-valuenow', '622');

    await page.keyboard.press('ArrowLeft');
    await expectOpenNow(page, 638);
    await expect.poll(() => storedWidth(page)).toBe(638);
    await expect(grip).toHaveAttribute('aria-valuenow', '638');

    // The double-click's own presses start and end a drag that moves
    // nothing, so they save nothing; the dblclick itself resets.
    const centre = await gripCentre(page);
    await page.mouse.dblclick(centre.x, centre.y);
    await expectOpenNow(page, 622);
    await expect.poll(() => storedWidth(page)).toBeNull();
    // The key is written as null, not left at 638 and read around.
    expect(
      await page.evaluate(() => {
        const raw = window.localStorage.getItem('settingsData') ?? '{}';
        return raw.includes('"openNowWidth":null');
      })
    ).toBe(true);
  });

  test('6. there is no grip folded, on the rail, in the popup, or on Settings', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    const grip = page.locator(GRIP);

    // CONTROL: side by side, the same selector finds the grip. Without this
    // every absence below passes on a build with no grip anywhere.
    await expect(grip).toHaveCount(1);
    await expectOpenNow(page, 622);

    // The rail, below 1100px: Open now is its 44px column and has no line.
    await page.setViewportSize(RAIL);
    await expectOpenNow(page, 44);
    await expect(grip).toHaveCount(0);

    // Folded: the saved session is not shown, so there is no line either.
    await page.setViewportSize(WIDE);
    await expect(grip).toHaveCount(1);
    await foldButton(page).click();
    await expect(page.locator(DETAIL)).toHaveCount(0);
    await expect(page.locator(OPEN_NOW)).toHaveCount(1);
    await expect(grip).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Show the saved session', exact: true })
      .click();
    await expect(grip).toHaveCount(1);

    // Settings.
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();
    await expect(page.locator(OPEN_NOW)).toHaveCount(0);
    await expect(grip).toHaveCount(0);

    // The popup.
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    await expect(popup.locator('[data-pane="sessions"]')).toBeVisible();
    await expect(popup.locator(GRIP)).toHaveCount(0);
  });

  test('7. a drag that starts on the grip never starts a row drag', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 622);
    await expect(savedRow(page, 'saved-7')).toBeVisible();
    const sessionsBefore = await storedSessions(page);
    await watchRootFlags(page);

    // Pressed on the grip, then carried left and down across the saved rows,
    // polling the root on the way.
    const from = await gripCentre(page);
    const over = await centreOf(savedRow(page, 'saved-6'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        from.x + ((over.x - from.x) * i) / steps,
        from.y + ((over.y - from.y) * i) / steps,
        { steps: 3 }
      );
      expect(await rootHas(page, 'data-dragging')).toBe(false);
    }
    // PREMISE: this press did start the resize.
    expect(await rootHas(page, 'data-resizing')).toBe(true);
    expect(await page.locator('[data-drag-held]').count()).toBe(0);
    await page.mouse.up();

    await expect.poll(() => storedWidth(page)).not.toBeNull();
    const log = await rootFlagLog(page);
    expect(log).toContain('data-resizing=');
    expect(log.filter((entry) => entry.startsWith('data-dragging'))).toEqual(
      []
    );
    expect(await storedSessions(page)).toBe(sessionsBefore);
    expect(await storedTabOrder(page)).toEqual(SAVED_IDS);
  });

  test('8. a row drag passing over the grip neither resizes nor misses its landing', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 622);
    await expect(page.locator(GRIP)).toHaveCount(1);
    await expect(savedRow(page, 'saved-7')).toBeVisible();
    // PREMISE: the saved list does not scroll, so rects measured at pick-up
    // stay true for the whole drag.
    const scroll = await detailScroll(page);
    expect(scroll).not.toBeNull();
    expect(scroll?.scrollHeight ?? 1).toBeLessThanOrEqual(
      scroll?.clientHeight ?? 0
    );
    await watchRootFlags(page);

    const seen = await dragSavedRowOverTheGrip(page);

    // PREMISE: the pointer really was over the grip, with a row held.
    expect(seen.gripHovered).toBe(true);
    const log = await rootFlagLog(page);
    expect(log).toContain('data-dragging=tab');
    // No resize, at any point.
    expect(seen.resizingMidDrag).toBe(false);
    expect(log.filter((entry) => entry.startsWith('data-resizing'))).toEqual(
      []
    );
    expect(seen.openNowWidth).toBe(622);
    await expectOpenNow(page, 622);
    expect(await storedWidth(page)).toBeNull();

    // The drop lands where the preview showed at release: a real move.
    expect(seen.preview).toEqual({ held: 'saved-5', index: 1 });
    await expect
      .poll(() => storedTabOrder(page))
      .toEqual([
        'saved-0',
        'saved-5',
        'saved-1',
        'saved-2',
        'saved-3',
        'saved-4',
        'saved-6',
        'saved-7',
      ]);
  });

  test('9. after a resize, an Open now row drag lands where its preview showed', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 622);
    const a = await openWindow(worker, ['a0', 'a1', 'a2', 'a3']);
    const [a0, a1, a2, a3] = a.tabIds;
    if (a3 === undefined) throw new Error('Chrome opened too few tabs');
    const ids = a.tabIds.map(String);
    const openRow = (id: number) =>
      page.locator(`${OPEN_NOW} [data-open-tab-id="${id}"]`);
    await expect(openRow(a3)).toBeVisible();

    await dragGrip(page, -100);
    await expectOpenNow(page, 722);
    await expect.poll(() => storedWidth(page)).toBe(722);

    // PREMISE: the list does not scroll, so the pick-up's rects hold.
    const scroll = await openNowScroll(page);
    expect(scroll).not.toBeNull();
    expect(scroll?.scrollHeight ?? 1).toBeLessThanOrEqual(
      scroll?.clientHeight ?? 0
    );

    await installPreviewReader(page);
    const start = await pickUp(page, openRow(a3));
    const target = (await centreOf(openRow(a1))).box;
    await moveHeld(page, start.x, target.y + 6);
    expect(await previewNow(page, OPEN_NOW, ids)).toEqual({
      held: String(a3),
      index: 1,
    });
    const preview = await releaseReadingPreview(page, OPEN_NOW, ids);
    expect(preview).toEqual({ held: String(a3), index: 1 });

    await expect
      .poll(() => chromeOrder(worker, a.windowId))
      .toEqual([a0, a3, a1, a2]);
    await expect
      .poll(() =>
        page.evaluate(
          (windowId) =>
            [
              ...document.querySelectorAll(
                `[data-open-window-id="${windowId}"] [data-open-tab-id]`
              ),
            ].map((row) => Number(row.getAttribute('data-open-tab-id'))),
          a.windowId
        )
      )
      .toEqual([a0, a3, a1, a2]);
    await expectOpenNow(page, 722);
  });

  test('10. a row drag over the grip does not light it', async ({
    context,
    extensionId,
  }) => {
    await seedOnce(context, {});
    const page = await openPage(context, extensionId, VIEW_TAB, WIDE);
    await expectOpenNow(page, 622);
    await expect(savedRow(page, 'saved-7')).toBeVisible();

    // CONTROL: plain hover lights it, so the rest colour below is not just
    // a hover rule that never applies.
    const grip = await gripCentre(page);
    await page.mouse.move(grip.x, grip.y);
    await expect
      .poll(() =>
        page.evaluate((sel) => {
          const dot = document.querySelector(`${sel} > span > span`);
          return dot === null ? '' : getComputedStyle(dot).backgroundColor;
        }, GRIP)
      )
      .toBe(hexToRgb(LIGHT_THEME.TEXT_COLOR));
    await page.mouse.move(grip.x - 300, grip.y);

    const seen = await dragSavedRowOverTheGrip(page);
    expect(seen.gripHovered).toBe(true);
    expect(rgbToHex(seen.dotColour)).toBe(LIGHT_THEME.LABEL_L2_COLOR);
    expect(rgbToHex(seen.chipColour)).toBe(LIGHT_THEME.PRIMARY_COLOR);
    // And no resize cursor: the row drag's own grabbing hand.
    expect(seen.gripCursor).toBe('grabbing');
  });
});

// '#RRGGBB' as the computed 'rgb(r, g, b)' form.
function hexToRgb(hex: string): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}
