import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
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

  test('7. a live tab row measures like a saved tab row', async ({
    context,
    extensionId,
    serviceWorker,
  }, testInfo) => {
    // The saved session's one tab has no favicon and a URL Chrome has no
    // favicon service for, so it draws the globe glyph, as a data: tab does.
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
              favicon: '',
              title: 'Saved tab',
              url: 'chrome://version/',
            },
          ],
        },
      ],
    });
    await seedSessions(context, {
      ...buildContainer([saved]),
      selectedTabGroupId: saved.tabGroupId,
    });
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    await openTab(serviceWorker, 'Alpha');

    const savedRow = page
      .locator(DETAIL)
      .getByRole('button', { name: 'Open in new tab: Saved tab', exact: true });
    await expect(savedRow).toBeVisible();
    await expect(liveRow(page, 'Alpha')).toBeVisible();

    // The row's height, and its favicon's left edge from the pane's content
    // box (inside its border and padding): the panes' own borders differ.
    const measure = (row: Locator, pane: string) =>
      row.evaluate((button: Element, paneSelector: string) => {
        const paneEl = document.querySelector(paneSelector);
        const icon = button.firstElementChild;
        const rowEl = button.parentElement;
        if (paneEl === null || icon === null || rowEl === null) return null;
        const style = getComputedStyle(paneEl);
        const contentLeft =
          paneEl.getBoundingClientRect().left +
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.paddingLeft);
        return {
          rowHeight: rowEl.getBoundingClientRect().height,
          faviconLeft: icon.getBoundingClientRect().left - contentLeft,
          faviconIsImage: icon.querySelector('img') !== null,
        };
      }, pane);

    const savedFacts = await measure(savedRow, DETAIL);
    const liveFacts = await measure(liveRow(page, 'Alpha'), OPEN_NOW);
    console.log(`[row match] ${JSON.stringify({ savedFacts, liveFacts })}`);
    await page.screenshot({ path: testInfo.outputPath('rows.png') });
    if (savedFacts === null || liveFacts === null) {
      throw new Error('a row is missing its pane, icon or row box');
    }
    // PREMISE: both draw the same kind of icon, so the heights compare rows,
    // not an image against a glyph.
    expect(liveFacts.faviconIsImage).toBe(savedFacts.faviconIsImage);
    expect(
      Math.abs(liveFacts.rowHeight - savedFacts.rowHeight),
      'row height'
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(liveFacts.faviconLeft - savedFacts.faviconLeft),
      'favicon offset'
    ).toBeLessThanOrEqual(0.5);
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

// ---- evidence the task reviews asked the real browser for ----

test.describe('Open now layout details (KAN-280)', () => {
  test('the Open now heading has no heading margin and keeps the section size', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, TAB_VIEWPORT);
    const heading = page.locator(`${OPEN_NOW} h2`);
    await expect(heading).toHaveText('Open now');
    const facts = await heading.evaluate((h2: Element) => {
      const s = getComputedStyle(h2);
      const label = h2.firstElementChild;
      const parent = h2.parentElement;
      if (label === null || parent === null) return null;
      return {
        margins: [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft],
        h2FontSize: s.fontSize,
        parentFontSize: getComputedStyle(parent).fontSize,
        h2FontWeight: s.fontWeight,
        parentFontWeight: getComputedStyle(parent).fontWeight,
        labelFontSize: parseFloat(getComputedStyle(label).fontSize),
        rootFontSize: parseFloat(
          getComputedStyle(document.documentElement).fontSize
        ),
        h2Height: h2.getBoundingClientRect().height,
        labelHeight: label.getBoundingClientRect().height,
      };
    });
    console.log(`[h2] ${JSON.stringify(facts)}`);
    if (facts === null) throw new Error('the heading has no label or parent');
    expect(facts.margins).toEqual(['0px', '0px', '0px', '0px']);
    expect(facts.h2FontSize).toBe(facts.parentFontSize);
    expect(facts.h2FontWeight).toBe(facts.parentFontWeight);
    expect(facts.labelFontSize).toBeCloseTo(
      facts.rootFontSize * parseFloat(TYPE.SECTION),
      2
    );
    expect(facts.h2Height).toBe(facts.labelHeight);
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
