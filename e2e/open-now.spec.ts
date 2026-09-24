import { deflateSync } from 'node:zlib';

import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';
import { TYPE } from '../src/styles/scale';

// KAN-280 Part A on the real artifact: the Open now pane in the tab view
// (`index.html?view=tab`). What jsdom cannot show: the grid's real widths at
// each breakpoint (O1, O2, O4), Chrome's own tab events reaching the pane
// (live rows), a click switching the real tab (O6), the fold surviving a
// reload (O5), live rows measuring like saved ones, and the pinned caption
// under a real scroll and drag (O3a).

const TAB_VIEWPORT = { width: 1280, height: 800 };
const WIDE_VIEWPORT = { width: 1920, height: 1080 };
const NARROW_VIEWPORT = { width: 1024, height: 768 };
const POPUP_VIEWPORT = { width: 790, height: 550 };

const VIEW_TAB = 'index.html?view=tab';

const OPEN_NOW = '[data-pane="open-now"]';
const SESSIONS = '[data-pane="sessions"]';
const DETAIL = '[data-pane="detail"]';
const CAPTION = '[data-caption="saved-sessions"]';

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

const innerWidth = (page: Page) => page.evaluate(() => window.innerWidth);

// A live tab row in the Open now pane, by the title Chrome reports.
const liveRow = (page: Page, title: string): Locator =>
  page
    .locator(OPEN_NOW)
    .getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

// A tab the browser opens, not the extension's UI: a data: page is enough
// for a title. Not active, so the tab view stays the tab being looked at.
async function openTab(worker: Worker, title: string): Promise<number> {
  const id = await worker.evaluate(
    (url: string) =>
      chrome.tabs.create({ url, active: false }).then((t) => t.id ?? null),
    `data:text/html,<title>${title}</title>`
  );
  if (id === null) throw new Error(`Chrome gave the ${title} tab no id`);
  return id;
}

// A session with one window and one tab, selected, so the saved detail has
// something to show when it is side by side.
const SELECTED = buildSession({
  tabGroupId: 'selected',
  title: 'Selected session',
  isSelected: true,
});
const OTHER = buildSession({ tabGroupId: 'other', title: 'Other session' });

async function seedTwoSessions(context: BrowserContext): Promise<void> {
  await seedSessions(context, {
    ...buildContainer([SELECTED, OTHER]),
    selectedTabGroupId: SELECTED.tabGroupId,
  });
}

// Side by side: the detail sits between the sessions pane and Open now, and
// Open now is `width` wide at the right edge.
async function expectSideBySide(page: Page, width: number): Promise<void> {
  await expect
    .poll(async () => Math.round((await need(page, OPEN_NOW)).width), {
      message: 'Open now is not its side-by-side width',
    })
    .toBe(width);
  const sessions = await need(page, SESSIONS);
  const detail = await need(page, DETAIL);
  const openNow = await need(page, OPEN_NOW);
  const viewport = await innerWidth(page);
  expect(Math.abs(detail.left - sessions.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(detail.right - openNow.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(openNow.right - viewport)).toBeLessThanOrEqual(1);
}

// Folded: no detail pane, and Open now fills from the sessions pane's right
// edge to the window's, give or take the borders.
async function expectFolded(page: Page): Promise<void> {
  await expect(page.locator(DETAIL)).toHaveCount(0);
  const viewport = await innerWidth(page);
  await expect
    .poll(async () => {
      const sessions = await need(page, SESSIONS);
      const openNow = await need(page, OPEN_NOW);
      return {
        leftGap: Math.round(Math.abs(openNow.left - sessions.right)),
        widthGap:
          Math.abs(openNow.width - (viewport - sessions.right)) <= 2
            ? 'within 2px'
            : `${openNow.width} vs ${viewport - sessions.right}`,
      };
    })
    .toEqual({ leftGap: 0, widthGap: 'within 2px' });
}

const showButton = (page: Page) =>
  page.getByRole('button', { name: 'Show the saved session', exact: true });
const foldButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Fold the saved session away',
    exact: true,
  });

// ---- 7. live rows measure like saved rows ----

// A 16x16 opaque PNG, built here so the spec carries no binary fixture.
function solidPng(size: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  // Each scanline: filter byte 0, then one blue RGB pixel per column.
  const row = Buffer.concat([
    Buffer.from([0]),
    ...Array.from({ length: size }, () => Buffer.from([0x1a, 0x73, 0xe8])),
  ]);
  const pixels = deflateSync(
    Buffer.concat(Array.from({ length: size }, () => row))
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FAVICON_ORIGIN = 'https://favicon.test';
const FAVICON_URL = `${FAVICON_ORIGIN}/icon.png`;
const FAVICON_PNG = solidPng(16);

// One selected session with one tab, shown side by side, so its tab row is
// on screen next to Open now.
async function seedSavedTab(
  context: BrowserContext,
  tab: { favicon: string; url: string }
): Promise<void> {
  const saved = buildSession({
    tabGroupId: 'saved',
    title: 'Saved session',
    isSelected: true,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 'w1',
        tabs: [{ tabId: 't1', title: 'Saved tab', ...tab }],
      },
    ],
  });
  await seedSessions(context, {
    ...buildContainer([saved]),
    selectedTabGroupId: saved.tabGroupId,
  });
  await seedSettings(context, { foldSavedSessionInTabView: false });
}

const savedTabRow = (page: Page): Locator =>
  page
    .locator(DETAIL)
    .getByRole('button', { name: 'Open in new tab: Saved tab', exact: true });

interface HorizontalBox {
  left: number;
  width: number;
  height: number;
}

interface RowFacts {
  rowHeight: number;
  // The Icon's own box, and the <img> inside it when it drew one.
  icon: HorizontalBox;
  img: HorizontalBox | null;
}

// A tab row's height, and its favicon's box with `left` measured from the
// pane's content box (inside its border and padding): the two panes' own
// borders differ.
async function measureRow(row: Locator, pane: string): Promise<RowFacts> {
  await expect(row).toBeVisible();
  const facts = await row.evaluate((button: Element, paneSelector: string) => {
    const paneEl = document.querySelector(paneSelector);
    const icon = button.firstElementChild;
    const rowEl = button.parentElement;
    if (paneEl === null || icon === null || rowEl === null) return null;
    const style = getComputedStyle(paneEl);
    const contentLeft =
      paneEl.getBoundingClientRect().left +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft);
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - contentLeft, width: r.width, height: r.height };
    };
    const img = icon.querySelector('img');
    return {
      rowHeight: rowEl.getBoundingClientRect().height,
      icon: boxOf(icon),
      img: img === null ? null : boxOf(img),
    };
  }, pane);
  if (facts === null) throw new Error('a row is missing its pane, icon or row');
  return facts;
}

function expectWithinHalfPixel(
  live: number,
  saved: number,
  what: string
): void {
  expect(
    Math.abs(live - saved),
    `${what}: live ${live}, saved ${saved}`
  ).toBeLessThanOrEqual(0.5);
}

test.describe('Open now in the tab view (KAN-280)', () => {
  test('1. folded by default: Open now fills the detail column', async ({
    context,
    extensionId,
  }, testInfo) => {
    // No fold setting in the seed: the profile's settingsData carries only
    // the cloud answer, so this is what a first open looks like.
    await seedTwoSessions(context);
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await expect(showButton(page)).toBeVisible();
    await expectFolded(page);
    await page.screenshot({ path: testInfo.outputPath('folded.png') });
  });

  test('2. a tab Chrome opens, renames and closes appears, changes and goes', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    // Two tabs: Keep is the control that the pane still lists the window
    // once Alpha has gone, so Alpha's absence is not an empty pane's.
    await openTab(serviceWorker, 'Keep');
    const alpha = await openTab(serviceWorker, 'Alpha');
    await expect(liveRow(page, 'Alpha')).toBeVisible();
    await expect(liveRow(page, 'Keep')).toBeVisible();

    // Renamed by navigating it to a page titled Beta. Not another data: URL:
    // measured, Chrome takes a tabs.update from one data: URL to another as
    // pending and never commits it, so the tab stays Alpha. A routed https
    // page is answered locally and does commit.
    await context.route('https://beta.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Beta</title>' })
    );
    await serviceWorker.evaluate(
      (id: number) => chrome.tabs.update(id, { url: 'https://beta.test/' }),
      alpha
    );
    await expect(liveRow(page, 'Beta')).toBeVisible();
    await expect(liveRow(page, 'Alpha')).toHaveCount(0);

    await serviceWorker.evaluate((id: number) => chrome.tabs.remove(id), alpha);
    await expect(liveRow(page, 'Beta')).toHaveCount(0);
    await expect(liveRow(page, 'Keep')).toBeVisible();
  });

  test('3. clicking a live tab makes it the active tab in its window', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const alpha = await openTab(serviceWorker, 'Alpha');
    await expect(liveRow(page, 'Alpha')).toBeVisible();

    const activeIn = () =>
      serviceWorker.evaluate(async (id: number) => {
        const tab = await chrome.tabs.get(id);
        const active = await chrome.tabs.query({
          active: true,
          windowId: tab.windowId,
        });
        return active.map((t) => t.id);
      }, alpha);
    // PREMISE: Alpha opened in the background, so the click has work to do.
    expect(await activeIn()).not.toEqual([alpha]);
    await expect(liveRow(page, 'Alpha')).not.toHaveAttribute(
      'aria-current',
      'true'
    );

    await liveRow(page, 'Alpha').click();
    await expect.poll(activeIn).toEqual([alpha]);
    // The pane follows: the row Chrome now shows is marked current.
    await expect(liveRow(page, 'Alpha')).toHaveAttribute(
      'aria-current',
      'true'
    );
    // O6: Tab Keeper stays open in its own tab.
    expect(page.isClosed()).toBe(false);
  });

  test('4. side by side it is 340px, 420px from 1600px; the fold persists across a reload', async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedTwoSessions(context);
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await expect(showButton(page)).toBeVisible();

    await showButton(page).click();
    await expect(page.locator(DETAIL)).toBeVisible();
    await expectSideBySide(page, 340);

    await page.setViewportSize(WIDE_VIEWPORT);
    await expectSideBySide(page, 420);
    await page.screenshot({ path: testInfo.outputPath('side-by-side.png') });

    await foldButton(page).click();
    await expectFolded(page);

    // The button wrote the choice: a new page opens folded.
    await reload(page);
    await expect(showButton(page)).toBeVisible();
    await expectFolded(page);

    await showButton(page).click();
    await expect(page.locator(DETAIL)).toBeVisible();
    await reload(page);
    await expect(foldButton(page)).toBeVisible();
    await expect(page.locator(DETAIL)).toBeVisible();
    await expectSideBySide(page, 420);
  });

  test('5. folded, clicking a saved session shows it for now; a reload is folded again', async ({
    context,
    extensionId,
  }) => {
    await seedTwoSessions(context);
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await expect(showButton(page)).toBeVisible();
    await expect(page.locator(DETAIL)).toHaveCount(0);

    await page
      .locator(SESSIONS)
      .getByRole('button', { name: OTHER.title, exact: true })
      .click();
    await expect(page.locator(DETAIL)).toBeVisible();
    await expectSideBySide(page, 340);

    // A peek changes no setting, so the next page opens as stored: folded.
    await reload(page);
    await expect(showButton(page)).toBeVisible();
    await expectFolded(page);
  });

  test('6. below 1100px, side by side, a 44px rail opens a 380px drawer that Esc closes', async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedTwoSessions(context);
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await openPage(
      context,
      extensionId,
      VIEW_TAB,
      NARROW_VIEWPORT
    );
    const rail = page.getByRole('button', { name: /^Open now/ });
    await expect(rail).toBeVisible();
    await expect
      .poll(async () => Math.round((await need(page, OPEN_NOW)).width))
      .toBe(44);

    await rail.click();
    const drawer = page.getByRole('dialog', { name: 'Open now' });
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    if (box === null) throw new Error('the drawer has no box');
    expect(Math.round(box.width)).toBe(380);
    expect(Math.round(box.x + box.width)).toBe(NARROW_VIEWPORT.width);

    // Over the panes: at a point inside the drawer and over the detail
    // column, the drawer is what is hit.
    const hit = await page.evaluate(
      ({ x, y }: { x: number; y: number }) => {
        const el = document.elementFromPoint(x, y);
        return {
          inDrawer: el !== null && el.closest('[role="dialog"]') !== null,
          detailUnder:
            document
              .querySelector('[data-pane="detail"]')
              ?.getBoundingClientRect().right ?? 0,
        };
      },
      { x: box.x + 20, y: box.y + box.height / 2 }
    );
    // PREMISE: the point is over the detail column.
    expect(hit.detailUnder).toBeGreaterThan(box.x + 20);
    expect(hit.inDrawer, 'the drawer is under the panes').toBe(true);
    await page.screenshot({ path: testInfo.outputPath('drawer.png') });

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(rail).toBeFocused();
  });

  test('6a. the drawer sits under the toast', async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedTwoSessions(context);
    await seedSettings(context, { foldSavedSessionInTabView: false });
    // Narrow enough that the drawer (the right 380px) reaches the toast
    // (fixed 20px from the left, 300px wide), so the two overlap.
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 680,
      height: 768,
    });
    await page
      .locator(`${DETAIL} [aria-label="More actions"][aria-haspopup="menu"]`)
      .click();
    await page.getByRole('menuitem', { name: 'Copy all links' }).click();
    const toast = page.getByText('Links copied', { exact: true });
    await expect(toast).toBeVisible();

    await page.getByRole('button', { name: /^Open now/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Open now' });
    await expect(drawer).toBeVisible();
    await expect(toast).toBeVisible();

    const drawerBox = await drawer.boundingBox();
    const toastBox = await toast.boundingBox();
    if (drawerBox === null || toastBox === null) {
      throw new Error('the drawer or the toast has no box');
    }
    // PREMISE: they overlap.
    expect(toastBox.x + toastBox.width).toBeGreaterThan(drawerBox.x + 2);
    const x = (drawerBox.x + toastBox.x + toastBox.width) / 2;
    const hits = await page.evaluate(
      ({
        x,
        toastY,
        drawerY,
      }: {
        x: number;
        toastY: number;
        drawerY: number;
      }) => {
        const at = (y: number) => {
          const el = document.elementFromPoint(x, y);
          if (el === null) return 'nothing';
          if (el.closest('[role="dialog"]') !== null) return 'drawer';
          if (el.textContent === 'Links copied') return 'toast';
          return el.tagName;
        };
        return { onToast: at(toastY), aboveToast: at(drawerY) };
      },
      {
        x,
        toastY: toastBox.y + toastBox.height / 2,
        drawerY: toastBox.y - 40,
      }
    );
    await page.screenshot({ path: testInfo.outputPath('drawer-toast.png') });
    expect(hits).toEqual({ onToast: 'toast', aboveToast: 'drawer' });
  });

  test('7. a live tab row measures like a saved tab row: the globe glyph', async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    // The saved tab has no favicon and a URL Chrome has no favicon service
    // for, so it draws the globe glyph, as a data: tab does.
    await seedSavedTab(context, { favicon: '', url: 'chrome://version/' });
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await openTab(serviceWorker, 'Alpha');

    const saved = await measureRow(savedTabRow(page), DETAIL);
    const live = await measureRow(liveRow(page, 'Alpha'), OPEN_NOW);
    console.log(`[row match, glyph] ${JSON.stringify({ saved, live })}`);
    await page.screenshot({ path: testInfo.outputPath('rows.png') });
    // PREMISE: both draw the glyph, so this compares rows, not an image
    // against a glyph.
    expect(saved.img, 'the saved row drew an image').toBeNull();
    expect(live.img, 'the live row drew an image').toBeNull();
    expectWithinHalfPixel(live.rowHeight, saved.rowHeight, 'row height');
    expectWithinHalfPixel(live.icon.left, saved.icon.left, 'favicon offset');
  });

  test('7b. a live tab row measures like a saved tab row: an image favicon', async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    // A page answered locally, whose <link rel="icon"> Chrome loads, so the
    // live tab gets a favIconUrl. The saved tab carries the same URL, so both
    // rows draw an <img> of the same picture.
    await context.route(`${FAVICON_ORIGIN}/**`, (route) =>
      route.request().url() === FAVICON_URL
        ? route.fulfill({ contentType: 'image/png', body: FAVICON_PNG })
        : route.fulfill({
            contentType: 'text/html',
            body: `<link rel="icon" href="${FAVICON_URL}"><title>Iconic</title>`,
          })
    );
    await seedSavedTab(context, {
      favicon: FAVICON_URL,
      url: `${FAVICON_ORIGIN}/`,
    });
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    // Opened active: measured, a background tab created this way never
    // requests its https page in this harness, so it never gets an icon.
    // The tab view is brought back to the front once the icon is read.
    const id = await serviceWorker.evaluate(
      (url: string) =>
        chrome.tabs.create({ url, active: true }).then((t) => t.id ?? null),
      `${FAVICON_ORIGIN}/`
    );
    if (id === null) throw new Error('Chrome gave the Iconic tab no id');
    // PREMISE: Chrome read the page's icon, so the live row has one to draw.
    await expect
      .poll(() =>
        serviceWorker.evaluate(
          (tabId: number) => chrome.tabs.get(tabId).then((t) => t.favIconUrl),
          id
        )
      )
      .toBe(FAVICON_URL);
    await page.bringToFront();

    // PREMISE: both rows draw the decoded image, not the globe fallback.
    const imageOf = (row: Locator) =>
      row.locator('img').evaluate((img: HTMLImageElement) => ({
        src: img.currentSrc,
        decoded: img.complete && img.naturalWidth > 0,
      }));
    await expect
      .poll(() => imageOf(savedTabRow(page)))
      .toEqual({ src: FAVICON_URL, decoded: true });
    await expect
      .poll(() => imageOf(liveRow(page, 'Iconic')))
      .toEqual({ src: FAVICON_URL, decoded: true });

    const saved = await measureRow(savedTabRow(page), DETAIL);
    const live = await measureRow(liveRow(page, 'Iconic'), OPEN_NOW);
    console.log(`[row match, image] ${JSON.stringify({ saved, live })}`);
    await page.screenshot({ path: testInfo.outputPath('rows-image.png') });
    if (saved.img === null || live.img === null) {
      throw new Error(
        'a row lost its <img> between the premise and the measure'
      );
    }
    expectWithinHalfPixel(live.rowHeight, saved.rowHeight, 'row height');
    expectWithinHalfPixel(live.img.left, saved.img.left, 'img left offset');
    expectWithinHalfPixel(live.img.width, saved.img.width, 'img width');
    expectWithinHalfPixel(live.img.height, saved.img.height, 'img height');
  });

  test('8. the popup is unchanged: no Open now, no caption', async ({
    context,
    extensionId,
  }) => {
    await seedTwoSessions(context);
    const popup = await openPage(
      context,
      extensionId,
      'index.html',
      POPUP_VIEWPORT
    );
    const tab = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    // CONTROL: the same locators find both in the tab view, so their absence
    // in the popup is the popup's, not a selector that never matches.
    await expect(tab.locator(OPEN_NOW)).toHaveCount(1);
    await expect(tab.locator(CAPTION)).toHaveText('Saved sessions');

    await expect(popup.locator(OPEN_NOW)).toHaveCount(0);
    await expect(popup.locator(CAPTION)).toHaveCount(0);
    await expect(popup.getByText('Saved sessions')).toHaveCount(0);
  });
});

// ---- 9. the caption stays pinned, and a session drag works under it ----

const MANY = Array.from({ length: 20 }, (_, i) =>
  buildSession({
    tabGroupId: `s${String(i + 1).padStart(2, '0')}`,
    title: `Session ${String(i + 1).padStart(2, '0')}`,
  })
);
const TITLE_OF = new Map(MANY.map((s) => [s.tabGroupId, s.title]));

// The drag engine scrolls the list while the pointer is within this of the
// scroller's top or bottom (RowDragArea's EDGE_ZONE_PX). An aim inside it
// moves the list under the pointer, so the drag stays clear of it.
const EDGE_ZONE_PX = 48;

const SESSION_ROWS = `${SESSIONS} [data-drag-row-id]`;

// Session titles in DOM order: what the store holds, whatever is painted.
const shownTitles = (page: Page) =>
  page
    .locator(SESSION_ROWS)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-drag-row-id')))
    .then((ids) =>
      ids.flatMap((id) => {
        const title = id === null ? undefined : TITLE_OF.get(id);
        return title === undefined ? [] : [title];
      })
    );

// Session titles top to bottom as painted, transforms included.
const paintedTitles = (page: Page) =>
  page
    .locator(SESSION_ROWS)
    .evaluateAll((els) =>
      els
        .map((el) => ({
          id: el.getAttribute('data-drag-row-id'),
          top: el.getBoundingClientRect().top,
        }))
        .sort((p, q) => p.top - q.top)
        .map((r) => r.id)
    )
    .then((ids) =>
      ids.flatMap((id) => {
        const title = id === null ? undefined : TITLE_OF.get(id);
        return title === undefined ? [] : [title];
      })
    );

const above = (titles: string[], title: string): string | null => {
  const i = titles.indexOf(title);
  return i > 0 ? titles[i - 1] : null;
};

test.describe('the Saved sessions caption (KAN-280 O3a)', () => {
  test('9. stays put while the list scrolls, and a session dragged under it lands where aimed', async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedSessions(context, buildContainer(MANY));
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await expect(page.locator(SESSION_ROWS)).toHaveCount(MANY.length);
    const captionBefore = await need(page, CAPTION);

    // The scroller is the caption's sibling, inside the same bordered box.
    const scrolled = await page.evaluate((sel: string) => {
      const scroller = document.querySelector(sel)?.nextElementSibling;
      if (!(scroller instanceof HTMLElement)) return null;
      scroller.scrollTop = scroller.scrollHeight;
      return { scrollTop: scroller.scrollTop };
    }, CAPTION);
    if (scrolled === null) throw new Error('no scroller after the caption');
    // PREMISE: the list overflowed, so there was a scroll for the caption to
    // ride along with.
    expect(scrolled.scrollTop).toBeGreaterThan(0);

    const captionAfter = await need(page, CAPTION);
    expect(Math.abs(captionAfter.top - captionBefore.top)).toBeLessThanOrEqual(
      0.5
    );
    // Visible: nothing is painted over it, and it is inside the viewport.
    const captionHit = await page.evaluate((sel: string) => {
      const caption = document.querySelector(sel);
      if (caption === null) return false;
      const r = caption.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + 12, (r.top + r.bottom) / 2);
      return el !== null && caption.contains(el);
    }, CAPTION);
    expect(captionHit, 'the caption is covered or off screen').toBe(true);
    await page.screenshot({ path: testInfo.outputPath('scrolled.png') });

    // The first row whose centre is clear of the top edge zone, and the aim
    // two rows below it, clear of the bottom one.
    const scroller = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel)?.nextElementSibling;
      if (el === null || el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }, CAPTION);
    if (scroller === null) throw new Error('no scroller after the caption');
    const rows = await page.locator(SESSION_ROWS).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute('data-drag-row-id') ?? '',
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
        };
      })
    );
    const first = rows.findIndex(
      (r) => (r.top + r.bottom) / 2 > scroller.top + EDGE_ZONE_PX
    );
    if (first < 0 || first + 3 >= rows.length) {
      throw new Error(`no row to drag: ${JSON.stringify({ first, scroller })}`);
    }
    const held = rows[first];
    const target = rows[first + 2];
    // PREMISE: the aim is clear of the bottom zone.
    expect(target.bottom).toBeLessThan(scroller.bottom - EDGE_ZONE_PX);
    const heldTitle = TITLE_OF.get(held.id) ?? '';
    const targetTitle = TITLE_OF.get(target.id) ?? '';
    const scrollTopBefore = scrolled.scrollTop;

    // Pressed at the row's centre, then its centre carried to the target's
    // bottom edge: below the target's midpoint, above the next row's.
    const x = (held.left + held.right) / 2;
    const startY = (held.top + held.bottom) / 2;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, startY + 8, { steps: 4 });
    await page.mouse.move(x, target.bottom, { steps: 10 });
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-dragging')
      ),
      'the drag never started'
    ).toBe('session');
    await page.screenshot({ path: testInfo.outputPath('mid-drag.png') });
    await page.mouse.up();

    await expect
      .poll(async () => above(await shownTitles(page), heldTitle), {
        message: 'the row did not land below the row it was aimed at',
      })
      .toBe(targetTitle);
    await expect
      .poll(async () => above(await paintedTitles(page), heldTitle), {
        message: 'the row is not painted below the row it was aimed at',
      })
      .toBe(targetTitle);
    // The caption never moved, and the list did not scroll under the drag.
    expect(
      Math.abs((await need(page, CAPTION)).top - captionBefore.top)
    ).toBeLessThanOrEqual(0.5);
    const scrollTopAfter = await page.evaluate(
      (sel: string) =>
        document.querySelector(sel)?.nextElementSibling?.scrollTop ?? -1,
      CAPTION
    );
    expect(scrollTopAfter).toBe(scrollTopBefore);
    await page.screenshot({ path: testInfo.outputPath('after-drop.png') });
  });
});

// ---- the Open now heading, and the empty session list ----

// A theme colour as getComputedStyle reports it.
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test.describe('Open now heading and empty-list layout (KAN-280)', () => {
  test('the Open now heading holds only phrasing content, and draws as the label it replaced', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const heading = page.locator(`${OPEN_NOW} h2`);
    await expect(heading).toHaveText('Open now');
    const facts = await heading.evaluate((h2: Element) => {
      const header = h2.parentElement;
      const text = h2.querySelector('span');
      if (header === null || text === null) return null;
      const outer = header.getBoundingClientRect();
      const box = h2.getBoundingClientRect();
      const inner = text.getBoundingClientRect();
      const h2Style = getComputedStyle(h2);
      const textStyle = getComputedStyle(text);
      return {
        // What the parser kept inside the h2, as shipped.
        descendants: Array.from(h2.querySelectorAll('*'), (el) => el.tagName),
        margins: [
          h2Style.marginTop,
          h2Style.marginRight,
          h2Style.marginBottom,
          h2Style.marginLeft,
        ],
        box: {
          left: box.left - outer.left,
          top: box.top - outer.top,
          width: box.width,
          height: box.height,
        },
        headerWidth: outer.width,
        text: {
          left: inner.left - box.left,
          top: inner.top - box.top,
          height: inner.height,
        },
        fontSize: parseFloat(textStyle.fontSize),
        rootFontSize: parseFloat(
          getComputedStyle(document.documentElement).fontSize
        ),
        fontFamily: textStyle.fontFamily,
        headerFontFamily: getComputedStyle(header).fontFamily,
        fontWeight: textStyle.fontWeight,
        headerFontWeight: getComputedStyle(header).fontWeight,
        color: textStyle.color,
        textOverflow: textStyle.textOverflow,
      };
    });
    console.log(`[h2] ${JSON.stringify(facts)}`);
    if (facts === null) throw new Error('the heading has no text or header');
    // An h2 allows only phrasing content: the text's span, nothing else.
    expect(facts.descendants).toEqual(['SPAN']);
    // Drawn as the NormalLabel inside it was: no heading margin, the header's
    // full width, 32px tall, the text 8px in and centred on the line.
    expect(facts.margins).toEqual(['0px', '0px', '0px', '0px']);
    expect(facts.box).toEqual({
      left: 0,
      top: 0,
      width: facts.headerWidth,
      height: 32,
    });
    expect(facts.text.left).toBe(8);
    expect(facts.text.top).toBe((facts.box.height - facts.text.height) / 2);
    // The section size and the header's face and weight, in TEXT_COLOR (the
    // profile opens in Light), cut with an ellipsis when it cannot fit.
    expect(facts.fontSize).toBeCloseTo(
      facts.rootFontSize * parseFloat(TYPE.SECTION),
      2
    );
    expect(facts.fontFamily).toBe(facts.headerFontFamily);
    expect(facts.fontWeight).toBe(facts.headerFontWeight);
    expect(facts.color).toBe(rgb(LIGHT_THEME.TEXT_COLOR));
    expect(facts.textOverflow).toBe('ellipsis');
  });

  test('"Empty" stays centred in an empty session list under the caption', async ({
    context,
    extensionId,
  }, testInfo) => {
    await seedSessions(context, buildContainer([]));
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const empty = page.locator(SESSIONS).getByText('Empty', { exact: true });
    await expect(empty).toBeVisible();
    await expect(page.locator(CAPTION)).toBeVisible();
    const facts = await page.evaluate((sel: string) => {
      const scroller = document.querySelector(sel)?.nextElementSibling;
      const box = scroller?.parentElement;
      const label = Array.from(scroller?.querySelectorAll('*') ?? []).find(
        (el) => el.textContent === 'Empty' && el.children.length === 0
      );
      if (!scroller || !box || !label) return null;
      const centre = (r: DOMRect) => ({
        x: (r.left + r.right) / 2,
        y: (r.top + r.bottom) / 2,
      });
      return {
        label: centre(label.getBoundingClientRect()),
        scroller: centre(scroller.getBoundingClientRect()),
        scrollerTop: scroller.getBoundingClientRect().top,
        captionBottom:
          document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0,
      };
    }, CAPTION);
    console.log(`[empty] ${JSON.stringify(facts)}`);
    await page.screenshot({ path: testInfo.outputPath('empty.png') });
    if (facts === null) throw new Error('no scroller or Empty label');
    // The scroller starts under the caption, and Empty is centred in it.
    expect(facts.scrollerTop).toBeGreaterThanOrEqual(facts.captionBottom - 0.5);
    expect(Math.abs(facts.label.x - facts.scroller.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(facts.label.y - facts.scroller.y)).toBeLessThanOrEqual(1);
  });
});

// ---- names in the accessibility tree ----

// jsdom computes no accessible names by ARIA's rules, so the names are read
// from the real browser here.
test.describe('Open now names its region and its drawer (KAN-280)', () => {
  test('side by side, Open now is a region named by its heading, which tells its "Collapse all windows" from the saved pane\'s', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedTwoSessions(context);
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await openTab(serviceWorker, 'Alpha');
    await expect(liveRow(page, 'Alpha')).toBeVisible();
    const collapseAll = { name: 'Collapse all windows', exact: true };
    // PREMISE: both panes offer the control under the same name.
    await expect(page.getByRole('button', collapseAll)).toHaveCount(2);

    const region = page.getByRole('region', { name: 'Open now', exact: true });
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAccessibleName('Open now');
    const scoped = region.getByRole('button', collapseAll);
    await expect(scoped).toHaveCount(1);
    // The one the region scopes is Open now's own, not the saved pane's.
    expect(
      await scoped.evaluate(
        (el: Element, pane: string) => el.closest(pane) !== null,
        OPEN_NOW
      )
    ).toBe(true);
  });

  test('below 1100px, the drawer is named by its heading, not by a label of its own', async ({
    context,
    extensionId,
  }) => {
    await seedTwoSessions(context);
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await openPage(
      context,
      extensionId,
      VIEW_TAB,
      NARROW_VIEWPORT
    );
    await page.getByRole('button', { name: /^Open now/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Open now', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAccessibleName('Open now');
    await expect(drawer).not.toHaveAttribute('aria-label');
    // The name's source is the drawer's own h2.
    expect(
      await drawer.evaluate((el) => {
        const id = el.getAttribute('aria-labelledby');
        const source = id === null ? null : document.getElementById(id);
        return source === null
          ? null
          : { tag: source.tagName, inDrawer: el.contains(source) };
      })
    ).toEqual({ tag: 'H2', inDrawer: true });
    // Inside it, Open now is still the region its heading names.
    await expect(
      drawer.getByRole('region', { name: 'Open now', exact: true })
    ).toHaveCount(1);
  });
});

// ---- 7c. a grouped live row measures like a grouped saved row ----

interface GroupedRowFacts {
  // `left` from the pane's content box, `rightInset` from its right edge,
  // `top` from the top of its window's block (title row, band and all).
  row: { left: number; rightInset: number; top: number; height: number };
  icon: { left: number; width: number };
  // The band's colour strip; `top` and `bottom` from the band's own box.
  strip: {
    left: number;
    width: number;
    height: number;
    top: number;
    bottom: number;
  };
  bandHeight: number;
}

// What marks a pane's colour strip and its window block: the two panes
// draw the same shapes under different attributes.
interface PaneMarks {
  strip: string;
  windowBlock: string;
}

// A grouped tab row, its favicon, and the colour strip of the band it sits
// in, measured from the pane's content box as measureRow does.
async function measureGroupedRow(
  row: Locator,
  pane: string,
  marks: PaneMarks
): Promise<GroupedRowFacts> {
  await expect(row).toBeVisible();
  const facts = await row.evaluate(
    (
      button: Element,
      { paneSelector, strip, windowBlock }: PaneMarks & { paneSelector: string }
    ) => {
      const paneEl = document.querySelector(paneSelector);
      const icon = button.firstElementChild;
      const rowEl = button.parentElement;
      const band = rowEl?.closest('[role="group"]') ?? null;
      const stripEl = band?.querySelector(strip) ?? null;
      const windowEl = rowEl?.closest(windowBlock) ?? null;
      if (
        paneEl === null ||
        icon === null ||
        rowEl === null ||
        band === null ||
        stripEl === null ||
        windowEl === null
      ) {
        return null;
      }
      const style = getComputedStyle(paneEl);
      const paneBox = paneEl.getBoundingClientRect();
      const contentLeft =
        paneBox.left +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft);
      const contentRight =
        paneBox.right -
        parseFloat(style.borderRightWidth) -
        parseFloat(style.paddingRight);
      const r = rowEl.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      const s = stripEl.getBoundingClientRect();
      const b = band.getBoundingClientRect();
      const w = windowEl.getBoundingClientRect();
      return {
        row: {
          left: r.left - contentLeft,
          rightInset: contentRight - r.right,
          top: r.top - w.top,
          height: r.height,
        },
        icon: { left: i.left - contentLeft, width: i.width },
        strip: {
          left: s.left - contentLeft,
          width: s.width,
          height: s.height,
          top: s.top - b.top,
          bottom: b.bottom - s.bottom,
        },
        bandHeight: b.height,
      };
    },
    { paneSelector: pane, ...marks }
  );
  if (facts === null) {
    throw new Error(
      'a grouped row is missing its pane, icon, band, strip or window block'
    );
  }
  return facts;
}

grantedTest.describe(
  'Open now grouped rows, tabGroups granted (KAN-280)',
  () => {
    grantedTest(
      '7c. a live tab in a group measures like a saved tab in a group',
      async ({ context, extensionId, serviceWorker }, testInfo) => {
        // One saved tab in a group, glyph favicon (as test 7), side by side.
        const saved = buildSession({
          tabGroupId: 'saved',
          title: 'Saved session',
          isSelected: true,
          windows: [
            {
              windowId: 'w1',
              windowHeight: 1080,
              windowWidth: 1920,
              windowOffsetTop: 0,
              windowOffsetLeft: 0,
              tabCount: 1,
              title: 'w1',
              tabs: [
                {
                  tabId: 't1',
                  title: 'Saved tab',
                  favicon: '',
                  url: 'chrome://version/',
                  chromeGroupId: 'g',
                },
              ],
              chromeTabGroups: [
                { groupId: 'g', title: 'Research', color: 'blue' },
              ],
            },
          ],
        });
        await seedSessions(context, {
          ...buildContainer([saved]),
          selectedTabGroupId: saved.tabGroupId,
        });
        await seedSettings(context, { foldSavedSessionInTabView: false });
        const page = await openPage(
          context,
          extensionId,
          VIEW_TAB,
          TAB_VIEWPORT
        );

        // One live tab, alone in a window of its own as the saved tab is
        // (the profile's first window also holds a blank tab), grouped by
        // Chrome under the same title and colour.
        const windowId = await serviceWorker.evaluate(async (url: string) => {
          const win = await chrome.windows.create({ url, focused: false });
          const tabId = win?.tabs?.[0]?.id;
          if (win?.id === undefined || tabId === undefined) return null;
          // In its own window: with no windowId, Chrome groups the tab in
          // the current window and moves it there.
          const groupId = await chrome.tabs.group({
            tabIds: [tabId],
            createProperties: { windowId: win.id },
          });
          await chrome.tabGroups.update(groupId, {
            title: 'Research',
            color: 'blue',
          });
          return win.id;
        }, 'data:text/html,<title>Alpha</title>');
        if (windowId === null) throw new Error('Chrome gave no window or tab');
        // PREMISE: that window lists exactly the one tab, so the row's y in
        // its window compares like with like.
        await expect(
          page
            .locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`)
            .getByRole('button', { name: /^Switch to tab: / })
        ).toHaveCount(1);

        // PREMISE: each row sits inside its pane's band, so this compares
        // grouped rows, not a grouped row against a loose one.
        const savedBand = page
          .locator(DETAIL)
          .getByRole('group', { name: 'Research', exact: true });
        const liveBand = page
          .locator(OPEN_NOW)
          .getByRole('group', { name: 'Research', exact: true });
        await expect(
          savedBand.getByRole('button', {
            name: 'Open in new tab: Saved tab',
            exact: true,
          })
        ).toBeVisible();
        await expect(
          liveBand.getByRole('button', {
            name: 'Switch to tab: Alpha',
            exact: true,
          })
        ).toBeVisible();

        const savedFacts = await measureGroupedRow(savedTabRow(page), DETAIL, {
          strip: '[data-group-color-strip]',
          windowBlock: '[data-drop-window-id]',
        });
        const liveFacts = await measureGroupedRow(
          liveRow(page, 'Alpha'),
          OPEN_NOW,
          {
            strip: '[data-open-now-group-strip]',
            windowBlock: '[data-open-window-id]',
          }
        );
        console.log(
          `[row match, grouped] ${JSON.stringify({ savedFacts, liveFacts })}`
        );
        await page.screenshot({
          path: testInfo.outputPath('grouped-rows.png'),
        });

        expectWithinHalfPixel(liveFacts.row.left, savedFacts.row.left, 'row x');
        expectWithinHalfPixel(
          liveFacts.row.rightInset,
          savedFacts.row.rightInset,
          'row right inset'
        );
        expectWithinHalfPixel(
          liveFacts.row.top,
          savedFacts.row.top,
          'row y in its window'
        );
        expectWithinHalfPixel(
          liveFacts.row.height,
          savedFacts.row.height,
          'row height'
        );
        expectWithinHalfPixel(
          liveFacts.icon.left,
          savedFacts.icon.left,
          'favicon offset'
        );
        expectWithinHalfPixel(
          liveFacts.strip.left,
          savedFacts.strip.left,
          'strip x'
        );
        expectWithinHalfPixel(
          liveFacts.strip.width,
          savedFacts.strip.width,
          'strip width'
        );
        expectWithinHalfPixel(
          liveFacts.strip.height,
          savedFacts.strip.height,
          'strip height'
        );
        expectWithinHalfPixel(
          liveFacts.strip.top,
          savedFacts.strip.top,
          'strip top in its band'
        );
        expectWithinHalfPixel(
          liveFacts.strip.bottom,
          savedFacts.strip.bottom,
          'strip bottom in its band'
        );
        expectWithinHalfPixel(
          liveFacts.bandHeight,
          savedFacts.bandHeight,
          'band height'
        );
      }
    );
  }
);
