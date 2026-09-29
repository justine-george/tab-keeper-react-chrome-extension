import type {
  BrowserContext,
  CDPSession,
  Page,
  Worker,
} from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-330 on the real artifact: the search row pinned at the top of Open
// now's list box. What jsdom cannot show: the row's real geometry against the
// list's columns (P2a E), a real `/` from the keyboard, a real Enter
// switching a real Chrome tab, a real pointer drag refused while a search is
// held, the drawer, and thirteen locales' real text widths.

const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';
const DETAIL = '[data-pane="detail"]';
const SESSIONS = '[data-pane="sessions"]';

// The helpers below are copied from open-now.spec.ts, where they are
// file-local, as every Open now spec keeps its own.

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

// A tab the browser opens, not the extension's UI: a data: page is enough
// for a title. Not active, so the tab view stays the tab being looked at.
async function openTab(worker: Worker, title: string): Promise<number> {
  const id = await worker.evaluate(
    (url: string) =>
      chrome.tabs.create({ url, active: false }).then((t) => t.id ?? null),
    // utf-8, or a title outside Latin-1 (the IME cases) arrives garbled.
    `data:text/html;charset=utf-8,<title>${title}</title>`
  );
  if (id === null) throw new Error(`Chrome gave the ${title} tab no id`);
  return id;
}

// A window the browser opens, unfocused so the tab view stays in front, with
// one tab per title, in order (open-now-drag.spec.ts's openWindow, less the
// title-typed lookup): the drag cases need a window of their own, so the
// rows they drag are the only ones in it.
async function openWindow(worker: Worker, titles: string[]): Promise<number[]> {
  const tabIds = await worker.evaluate(
    async (urls: string[]) => {
      const win = await chrome.windows.create({ focused: false, url: urls });
      return (win?.tabs ?? []).flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id]
      );
    },
    titles.map((title) => `data:text/html,<title>${title}</title>`)
  );
  if (tabIds.length !== titles.length) {
    throw new Error(`Chrome gave ${tabIds.length} tab ids for ${titles}`);
  }
  return tabIds;
}

const chromeIndexOf = (worker: Worker, tabId: number) =>
  worker.evaluate(
    async (id: number) => (await chrome.tabs.get(id)).index,
    tabId
  );

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

// Side by side from the first render. The show button writes this setting,
// so pressing it once would leave every later page in the same context side
// by side with no show button to press.
const seedSideBySide = (context: BrowserContext) =>
  seedSettings(context, { foldSavedSessionInTabView: false });

const railButton = (page: Page) =>
  page.getByRole('button', { name: /^Open now/ });

const field = (page: Page) =>
  page
    .locator(OPEN_NOW)
    .getByRole('textbox', { name: 'Search open tabs', exact: true });

const liveRow = (page: Page, title: string) =>
  page
    .locator(OPEN_NOW)
    .getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const boxOf = async (page: Page, selector: string): Promise<Box> => {
  const box = await page.evaluate((sel: string) => {
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
  if (box === null) throw new Error(`nothing matches ${selector}`);
  return box;
};

const isHeld = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-drag-held]') !== null);

// Whether a row is held at any point within `ms`: for a drag that may be
// refused, where a poll that must pass cannot say "never".
async function heldWithin(page: Page, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isHeld(page)) return true;
    await page.waitForTimeout(50);
  }
  return isHeld(page);
}

test.describe('Open now search (KAN-330)', () => {
  test('typing draws only the matching tabs, and a tab renamed to match appears', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    for (const title of ['Kyoto maps', 'Osaka flights', 'Rail pass']) {
      await openTab(serviceWorker, title);
    }
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    // PREMISE: before the search, all three are drawn.
    await expect(liveRow(page, 'Osaka flights')).toBeVisible();
    await expect(liveRow(page, 'Rail pass')).toBeVisible();

    await field(page).fill('kyoto');
    await expect(liveRow(page, 'Kyoto maps')).toBeVisible();
    await expect(liveRow(page, 'Osaka flights')).toHaveCount(0);
    await expect(liveRow(page, 'Rail pass')).toHaveCount(0);
    await expect(
      page.locator(OPEN_NOW).getByText(/· 1 of \d+ Tabs$/)
    ).toBeVisible();

    // Renamed by navigating it to a page titled Kyoto temples. Not another
    // data: URL: Chrome takes a tabs.update from one data: URL to another as
    // pending and never commits it (open-now.spec.ts test 2). A routed https
    // page is answered locally and does commit.
    const osaka = await serviceWorker.evaluate(
      async () =>
        (await chrome.tabs.query({ title: 'Osaka flights' }))[0]?.id ?? null
    );
    if (osaka === null) throw new Error('no Osaka tab');
    await context.route('https://kyoto.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Kyoto temples</title>',
      })
    );
    await serviceWorker.evaluate(
      (id: number) => chrome.tabs.update(id, { url: 'https://kyoto.test/' }),
      osaka
    );
    await expect(liveRow(page, 'Kyoto temples')).toBeVisible();
    await expect(
      page.locator(OPEN_NOW).getByText(/· 2 of \d+ Tabs$/)
    ).toBeVisible();
  });

  test("P2a E: the row is 40px, 4px above the first window row, on the list's columns; the list boxes stay level", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedTwoSessions(context);
    await seedSideBySide(context);
    await openTab(serviceWorker, 'Kyoto maps');
    for (const [width, height, drawer] of [
      [1317, 800, false],
      [1100, 800, false],
      [1024, 768, true],
    ] as const) {
      const page = await openPage(context, extensionId, VIEW_TAB, {
        width,
        height,
      });
      if (drawer) await railButton(page).click();
      const root = drawer ? page.getByRole('dialog') : page.locator(OPEN_NOW);
      await expect(root.locator('[data-open-now-search]')).toBeVisible();
      await expect(root.locator('[data-open-window-id]').first()).toBeVisible();
      const m = await root.evaluate((el) => {
        const r = (e: Element | null | undefined) => {
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            width: b.width,
            height: b.height,
          };
        };
        const row = el.querySelector('[data-open-now-search]');
        const input = row?.querySelector('input') ?? null;
        const glass = row?.querySelector('span') ?? null;
        const box = row?.parentElement ?? null;
        const win = el.querySelector('[data-open-window-id] > div');
        const winTitle =
          [...(win?.querySelectorAll('*') ?? [])].find(
            (e) =>
              /^Window \d+$/.test(e.textContent ?? '') &&
              e.children.length === 0
          ) ?? null;
        // The window row's second span is its web_asset glyph (the planning
        // probe measured it: 24x24 at +36px).
        const winGlyph = win?.querySelectorAll('span')[1] ?? null;
        return {
          row: r(row),
          input: r(input),
          glass: r(glass),
          box: r(box),
          win: r(win),
          winTitle: r(winTitle),
          winGlyph: r(winGlyph),
          border: row ? getComputedStyle(row).borderBottomWidth : '',
        };
      });
      console.log(`[P2a E ${width}x${height}] ${JSON.stringify(m)}`);
      if (
        !m.row ||
        !m.input ||
        !m.glass ||
        !m.box ||
        !m.win ||
        !m.winTitle ||
        !m.winGlyph
      ) {
        throw new Error(`missing a box at ${width}px: ${JSON.stringify(m)}`);
      }
      // 40px tall, its 1px divider included.
      expect(m.row.height).toBeCloseTo(40, 0);
      expect(m.border).toBe('1px');
      // 4px of space under the divider before the first window row (E).
      expect(m.win.top - m.row.bottom).toBeCloseTo(4, 0);
      // Inside the list box's 1px border, edge to edge, at its top.
      expect(m.row.top).toBeCloseTo(m.box.top + 1, 0);
      expect(m.row.left).toBeCloseTo(m.box.left + 1, 0);
      expect(m.row.right).toBeCloseTo(m.box.right - 1, 0);
      // On the list's columns: the glass centred on the window glyph's
      // column (centres, since one is an Icon's 32px box and the other its
      // 24px glyph), the text where the window title starts (input box + its
      // 8px padding).
      expect(m.glass.left + m.glass.width / 2).toBeCloseTo(
        m.winGlyph.left + m.winGlyph.width / 2,
        0
      );
      expect(m.input.left + 8).toBeCloseTo(m.winTitle.left, 0);

      // Side by side, the row sits INSIDE Open now's list box, so the three
      // list boxes still start level (O1b).
      if (!drawer) {
        const openNowList = await boxOf(
          page,
          `${OPEN_NOW} > div > div:last-child`
        );
        const detailList = await boxOf(
          page,
          `${DETAIL} > div > div:last-child`
        );
        const sessionsList = await boxOf(
          page,
          `${SESSIONS} > div > div:last-child`
        );
        expect(Math.abs(openNowList.top - detailList.top)).toBeLessThanOrEqual(
          1
        );
        expect(Math.abs(sessionsList.top - detailList.top)).toBeLessThanOrEqual(
          1
        );
      }
      await page.close();
    }
  });

  test('/ from the page focuses the field; / in the name box types a slash', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    await expect(field(page)).toBeVisible();
    // An empty spot of the sessions pane: nothing there takes focus.
    await page.locator('body').click({ position: { x: 5, y: 700 } });
    await expect(field(page)).not.toBeFocused();
    await page.keyboard.press('/');
    await expect(field(page)).toBeFocused();
    // The key moved focus; it was not typed.
    await expect(field(page)).toHaveValue('');

    const nameBox = page.getByPlaceholder('Save all open windows as a session');
    await nameBox.click();
    await page.keyboard.type('a/b');
    await expect(nameBox).toHaveValue(/a\/b$/);
    await expect(field(page)).not.toBeFocused();
    await expect(field(page)).toHaveValue('');
  });

  test('Enter in the field switches Chrome to the first tab drawn, and does nothing with the field empty', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const kyoto = await openTab(serviceWorker, 'Trip Kyoto');
    const osaka = await openTab(serviceWorker, 'Trip Osaka');
    await openTab(serviceWorker, 'Rail pass');
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    const isActive = (id: number) =>
      serviceWorker.evaluate(
        async (tabId: number) => (await chrome.tabs.get(tabId)).active,
        id
      );
    const activeTabs = () =>
      serviceWorker.evaluate(async () =>
        (await chrome.tabs.query({ active: true })).map((t) => t.id ?? -1)
      );
    const drawnTitles = () =>
      page
        .locator(`${OPEN_NOW} [data-open-tab-id] > button`)
        .evaluateAll((buttons) =>
          buttons.map((b) => b.getAttribute('aria-label'))
        );
    await expect(liveRow(page, 'Rail pass')).toBeVisible();
    // PREMISE: both opened in the background, so Enter has work to do.
    expect(await isActive(kyoto)).toBe(false);
    expect(await isActive(osaka)).toBe(false);

    // With the field empty, Enter never switches Chrome away from Tab Keeper.
    const before = await activeTabs();
    await field(page).focus();
    await expect(field(page)).toHaveValue('');
    await field(page).press('Enter');
    await page.waitForTimeout(500);
    expect(await activeTabs()).toEqual(before);

    // The CONTROL for the case above: with a search held, the same Enter
    // switches -- to the FIRST drawn match, not merely to a match.
    await field(page).fill('trip');
    await expect(liveRow(page, 'Rail pass')).toHaveCount(0);
    // PREMISE: two tabs are drawn, Kyoto first.
    expect(await drawnTitles()).toEqual([
      'Switch to tab: Trip Kyoto',
      'Switch to tab: Trip Osaka',
    ]);
    await field(page).press('Enter');
    await expect.poll(() => isActive(kyoto)).toBe(true);
    expect(await isActive(osaka)).toBe(false);
  });

  test('a real drag is refused while a search is held; the same drag after Esc moves the tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const [, , rowThree] = await openWindow(serviceWorker, [
      'Row one',
      'Row two',
      'Row three',
    ]);
    if (rowThree === undefined) throw new Error('no Row three');
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    const before = await chromeIndexOf(serviceWorker, rowThree);

    // Row three by its Switch button, dropped 2px above Row one's top: the
    // same gesture both times. Returns whether a row was ever held.
    const drag = async (): Promise<boolean> => {
      const from = await liveRow(page, 'Row three').boundingBox();
      if (from === null) throw new Error('Row three has no box');
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // Past the 5px activation distance.
      await page.mouse.move(x, y + 10, { steps: 3 });
      const held = await heldWithin(page, 1000);
      const to = await liveRow(page, 'Row one').boundingBox();
      if (to === null) throw new Error('Row one has no box');
      await page.mouse.move(x, to.y - 2, { steps: 10 });
      await page.waitForTimeout(350);
      await page.mouse.up();
      return held;
    };

    // `row` matches all three, so every row is drawn: only the search
    // differs from the control below.
    await field(page).fill('row');
    await expect(liveRow(page, 'Row one')).toBeVisible();
    await expect(liveRow(page, 'Row three')).toBeVisible();
    expect(await drag(), 'a row was picked up under a search').toBe(false);
    await page.waitForTimeout(300);
    expect(await chromeIndexOf(serviceWorker, rowThree)).toBe(before);

    // CONTROL: Esc in the field clears it, and the same drag moves the tab.
    await field(page).press('Escape');
    await expect(field(page)).toHaveValue('');
    expect(await drag(), 'the control drag never picked the row up').toBe(true);
    await expect
      .poll(() => chromeIndexOf(serviceWorker, rowThree))
      .toBeLessThan(before);
  });

  test('a window row offers no Save window or Close window while a search is held; Esc brings both back (O14e)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await openWindow(serviceWorker, ['Kyoto maps', 'Osaka flights']);
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    // The new window's block, found by the tab that matches the search below,
    // so it stays drawn under it: not "This
    // window", so it has a Close window.
    const block = page.locator(`${OPEN_NOW} [data-open-window-id]`).filter({
      has: page.getByRole('button', {
        name: 'Switch to tab: Kyoto maps',
        exact: true,
      }),
    });
    const saveWindow = block.getByRole('button', {
      name: /^Save window as a session: /,
    });
    const closeWindow = block.getByRole('button', {
      name: /^Close window: /,
    });
    const closeTab = block.getByRole('button', {
      name: 'Close tab: Kyoto maps',
      exact: true,
    });
    const hoverWindowRow = () =>
      block.getByRole('button', { name: /^Collapse: / }).hover();

    // PREMISE: before the search, hovering the window row shows both.
    await liveRow(page, 'Osaka flights').waitFor();
    await hoverWindowRow();
    await expect(saveWindow).toHaveCount(1);
    await expect(closeWindow).toHaveCount(1);
    await expect(saveWindow).toBeVisible();
    await expect(closeWindow).toBeVisible();

    await field(page).fill('kyoto');
    await expect(liveRow(page, 'Kyoto maps')).toBeVisible();
    await expect(liveRow(page, 'Osaka flights')).toHaveCount(0);
    await hoverWindowRow();
    await expect(saveWindow).toHaveCount(0);
    await expect(closeWindow).toHaveCount(0);
    // The tab row keeps its x.
    await liveRow(page, 'Kyoto maps').hover();
    await expect(closeTab).toBeVisible();

    // CONTROL: Esc clears the search and both are back.
    await field(page).press('Escape');
    await expect(field(page)).toHaveValue('');
    await hoverWindowRow();
    await expect(saveWindow).toBeVisible();
    await expect(closeWindow).toBeVisible();
  });

  test('Esc in the drawer clears the field, then closes the drawer', async ({
    context,
    extensionId,
  }) => {
    await seedTwoSessions(context);
    await seedSideBySide(context);
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1024,
      height: 768,
    });
    await railButton(page).click();
    const drawer = page.getByRole('dialog', { name: 'Open now' });
    await expect(drawer).toBeVisible();
    await field(page).click();
    await page.keyboard.type('x');
    await expect(field(page)).toHaveValue('x');

    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(railButton(page)).toBeFocused();
  });

  test('R1: / with the rail showing opens the drawer with the cursor in the field', async ({
    context,
    extensionId,
  }) => {
    await seedTwoSessions(context);
    await seedSideBySide(context);
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1024,
      height: 768,
    });
    await expect(railButton(page)).toBeVisible();
    const drawer = page.getByRole('dialog', { name: 'Open now' });
    // PREMISE: the drawer is closed, so the field is not on the page.
    await expect(drawer).toHaveCount(0);
    await expect(field(page)).toHaveCount(0);

    await page.keyboard.press('/');
    await expect(drawer).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('');
  });

  test('the row keeps its height with a long search', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await openTab(serviceWorker, 'Kyoto maps');
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    await expect(liveRow(page, 'Kyoto maps')).toBeVisible();
    const header = `${OPEN_NOW} [data-open-now-header]`;
    const row = `${OPEN_NOW} [data-open-now-search]`;
    const headerBefore = await boxOf(page, header);
    await field(page).fill('k'.repeat(300));
    await expect(
      page.locator(OPEN_NOW).getByText(/^No open tab matches/)
    ).toBeVisible();
    expect((await boxOf(page, row)).height).toBeCloseTo(40, 0);
    expect((await boxOf(page, header)).height).toBeCloseTo(
      headerBefore.height,
      0
    );
  });
});

// ---- 13 locales: the placeholder fits ----

const LANGUAGES = [
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'sv',
  'zh',
  'zh-TW',
] as const;

interface Fit {
  text: string;
  width: number;
  room: number;
}

// The placeholder's drawn width in the field's own font, against the room
// the field gives it inside its padding.
const placeholderFit = (page: Page): Promise<Fit | null> =>
  page.locator(`${OPEN_NOW} [data-open-now-search] input`).evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) return null;
    const style = getComputedStyle(input);
    const canvas = document.createElement('canvas').getContext('2d');
    if (canvas === null) return null;
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const room =
      input.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    return {
      text: input.placeholder,
      width: canvas.measureText(input.placeholder).width,
      room,
    };
  });

test.describe('the placeholder fits in every locale (KAN-330)', () => {
  for (const language of LANGUAGES) {
    test(`${language}: side by side at 1317px and 1100px, and in the 1024px drawer`, async ({
      context,
      extensionId,
    }) => {
      const expected = localeStrings(language)['Search open tabs'];
      const english = localeStrings('en')['Search open tabs'];
      await seedTwoSessions(context);
      // i18n reads `language` out of settingsData at module load, so it is
      // seeded before the first render (i18n-layout.spec.ts).
      await seedSettings(context, {
        language,
        foldSavedSessionInTabView: false,
      });
      // 1100px is Open now's narrowest side-by-side layout (below it, the
      // rail): the least room the field gets outside the drawer.
      for (const [width, height, drawer] of [
        [1317, 800, false],
        [1100, 800, false],
        [1024, 768, true],
      ] as const) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height });
        await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
        if (drawer) {
          // The rail's button, named in the page's language; the only
          // button in the rail.
          await page.locator(`${OPEN_NOW} button`).first().click();
          await expect(page.getByRole('dialog')).toBeVisible();
        }
        const input = page.locator(`${OPEN_NOW} [data-open-now-search] input`);
        // Barrier and CONTROL: the page rendered this locale's string, not a
        // fallback -- for every non-en locale, not the English one.
        await expect(input).toHaveAttribute('placeholder', expected);
        if (language !== 'en') expect(expected).not.toBe(english);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const fits = await placeholderFit(page);
        console.log(`[fit ${language} ${width}] ${JSON.stringify(fits)}`);
        if (fits === null) throw new Error('no field or no canvas');
        expect(fits.text).toBe(expected);
        expect(
          fits.width,
          `"${fits.text}" is ${fits.width}px in ${fits.room}px`
        ).toBeLessThanOrEqual(fits.room);
        await page.close();
      }
    });
  }
});

// ---- a search typed while a row is held ----

// Measured 2026-09-28 (headless Chromium, this build), the reachability probe
// for Task 7's jsdom finding:
// - A press on a row moves focus from the field to the row's Switch button,
//   so typing, Backspace and `/` while the row is held leave the field alone
//   (value stayed '', activeElement stayed the button, `/` is refused).
// - But Shift+Tab still walks focus while the mouse holds the row: 10-12
//   presses reach the field, the row is still held, and typing then changes
//   the search mid-drag.
// - Typing `one` with Row three held: only Row one is drawn, the held row is
//   unmounted ([data-drag-held] gone), and the release still moves Row three
//   in Chrome: indices [0,1,2] -> [1,2,0] (Row three to the front).
//   {"indicesBefore":[0,1,2],"held":true,"shiftTabPresses":12,
//    "activeAfterShiftTab":"INPUT[Search open tabs]","value":"one",
//    "heldAfterTyping":false,"drawn":["Switch to tab: Row one"],
//    "heldBeforeUp":false,"indicesAfter":[1,2,0],"heldAfterUp":false}
// KAN-335: a live drag now cancels when a search starts, the way Esc
// cancels one, so the release that follows moves nothing.
test.describe('a search typed while a row is held (KAN-330)', () => {
  test('a search that starts mid-drag cancels the drag: Chrome keeps its order', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const ids = await openWindow(serviceWorker, [
      'Row one',
      'Row two',
      'Row three',
    ]);
    const [rowOne, , rowThree] = ids;
    if (rowOne === undefined || rowThree === undefined)
      throw new Error('no Row one or Row three');
    // Row three active in its window, so a click that reaches Row one's
    // Switch button has something to change.
    await serviceWorker.evaluate(
      (id: number) => chrome.tabs.update(id, { active: true }),
      rowThree
    );
    const isActive = (id: number) =>
      serviceWorker.evaluate(
        async (tabId: number) => (await chrome.tabs.get(tabId)).active,
        id
      );
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    const indices = () =>
      serviceWorker.evaluate(
        async (tabIds: number[]) =>
          Promise.all(
            tabIds.map(async (id) => (await chrome.tabs.get(id)).index)
          ),
        ids
      );
    const fieldFocused = () =>
      field(page).evaluate((input) => input === document.activeElement);
    await expect(liveRow(page, 'Row three')).toBeVisible();
    const before = await indices();
    const one = await liveRow(page, 'Row one').boundingBox();
    const from = await liveRow(page, 'Row three').boundingBox();
    if (one === null || from === null) throw new Error('a row has no box');
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 10, { steps: 3 });
    // PREMISE: the row is held, so a release now would move it.
    await expect.poll(() => isHeld(page)).toBe(true);

    // Keyboard focus walks back to the field with the row still held.
    for (let i = 0; i < 30 && !(await fieldFocused()); i++) {
      await page.keyboard.press('Shift+Tab');
    }
    expect(await fieldFocused(), 'Shift+Tab never reached the field').toBe(
      true
    );
    await page.keyboard.type('one');
    await expect(field(page)).toHaveValue('one');
    // The search hides the held row.
    await expect(liveRow(page, 'Row three')).toHaveCount(0);
    // And cancels the drag there, not at the release: the document stops
    // being flagged as dragging while the mouse is still down (KAN-335).
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.hasAttribute('data-dragging')
        )
      )
      .toBe(false);

    // Released late, 800ms after the cancel, on Row one's Switch button.
    // Measured 2026-09-28, before the late-release fix (d63ef50): no click
    // event reached the page at all -- the press's row was unmounted by the
    // search, so the press and the release share no element and Chrome
    // dispatches none -- Row one stayed inactive, and a plain click on it
    // afterwards switched.
    // {"rowOneActive":false,"rowThreeActive":true,"indices":[0,1,2]}
    // Since that fix a click for this release would be swallowed anyway (the
    // suppression waits for the cancelled press's pointerup, then lasts
    // 400ms), so two things now keep Row one shut. The case where Chrome
    // does dispatch the click is the pair of tests below.
    expect(await isActive(rowOne)).toBe(false);
    await page.waitForTimeout(800);
    const target = await liveRow(page, 'Row one').boundingBox();
    if (target === null) throw new Error('Row one has no box');
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 10 }
    );
    await page.mouse.up();
    await page.waitForTimeout(800);
    expect(await indices()).toEqual(before);
    expect(await isActive(rowOne)).toBe(false);
    // CONTROL: an ordinary click on the same button switches, so the check
    // above can see a switch.
    await liveRow(page, 'Row one').click();
    await expect.poll(() => isActive(rowOne)).toBe(true);
  });

  // KAN-335's worst path. When the row stays drawn after the cancel, the
  // press and a release back on it share the row, so Chrome dispatches a
  // click for them however late the release comes. Measured 2026-09-28
  // before the fix, both ways: the click reached the row's DIV 800ms after
  // the cancel and Chrome switched to Row three.
  // {"before":{"rowOne":true,"rowThree":false},"clicks":["DIV[]"],
  //  "after":{"rowOne":false,"rowThree":true}}
  const cancels: Array<'a search that keeps the row' | 'Esc'> = [
    'a search that keeps the row',
    'Esc',
  ];
  for (const cancel of cancels) {
    test(`${cancel} cancels the drag, and a late release on the held row opens nothing`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const [rowOne, , rowThree] = await openWindow(serviceWorker, [
        'Row one',
        'Row two',
        'Row three',
      ]);
      if (rowOne === undefined || rowThree === undefined)
        throw new Error('no Row one or Row three');
      await serviceWorker.evaluate(
        (id: number) => chrome.tabs.update(id, { active: true }),
        rowOne
      );
      const isActive = (id: number) =>
        serviceWorker.evaluate(
          async (tabId: number) => (await chrome.tabs.get(tabId)).active,
          id
        );
      const page = await openPage(context, extensionId, VIEW_TAB, {
        width: 1600,
        height: 800,
      });
      await expect(liveRow(page, 'Row three')).toBeVisible();
      const from = await liveRow(page, 'Row three').boundingBox();
      if (from === null) throw new Error('Row three has no box');
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 10, { steps: 3 });
      await expect.poll(() => isHeld(page)).toBe(true);

      if (cancel === 'Esc') {
        await page.keyboard.press('Escape');
      } else {
        const fieldFocused = () =>
          field(page).evaluate((input) => input === document.activeElement);
        for (let i = 0; i < 30 && !(await fieldFocused()); i++) {
          await page.keyboard.press('Shift+Tab');
        }
        await page.keyboard.type('row');
        await expect(field(page)).toHaveValue('row');
      }
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.documentElement.hasAttribute('data-dragging')
          )
        )
        .toBe(false);

      // Twice the 400ms a release's suppression lasts, then back onto the
      // row that was held and released there.
      await page.waitForTimeout(800);
      const back = await liveRow(page, 'Row three').boundingBox();
      if (back === null) throw new Error('Row three has no box');
      await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2, {
        steps: 10,
      });
      // PREMISE: Row three is not the active tab, so a switch would show.
      expect(await isActive(rowThree)).toBe(false);
      await page.mouse.up();
      await page.waitForTimeout(800);
      expect(await isActive(rowThree)).toBe(false);
      expect(await isActive(rowOne)).toBe(true);

      // CONTROL: the next ordinary click on the same row switches -- the
      // suppression ate only the cancelled press's own click.
      await liveRow(page, 'Row three').click();
      await expect.poll(() => isActive(rowThree)).toBe(true);
    });
  }
});

// ---- an IME composing a word in the field ----

// Measured 2026-09-28 (headless Chromium, this build before the fix), with
// CDP's Input.imeSetComposition('きょう') then Input.dispatchKeyEvent: every
// key reached the field's handler with isComposing true, and acted on it.
// {"mode":"enter13","log":[{"type":"compositionstart"},{"type":"keydown",
//  "key":"Enter","keyCode":13,"isComposing":true,"value":"きょう"},
//  {"type":"compositionend"}],"value":"きょう","targetActive":true}
// The same with keyCode 229 switched too; ↓ left the field
// (fieldFocused false); Esc emptied it (value ""). The control, the same
// Enter with the text typed and no composition, arrived with isComposing
// false and switched.
test.describe('an IME composing a word in the field (KAN-330)', () => {
  // The tab the word matches, and the only one drawn while it is composed.
  async function composing(
    page: Page,
    context: BrowserContext
  ): Promise<CDPSession> {
    await expect(liveRow(page, 'きょうの予定')).toBeVisible();
    await field(page).focus();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', {
      text: 'きょう',
      selectionStart: 3,
      selectionEnd: 3,
    });
    await expect(field(page)).toHaveValue('きょう');
    // PREMISE: the composed text is already the search.
    await expect(liveRow(page, 'Other tab')).toHaveCount(0);
    return cdp;
  }

  const keys = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    'Enter (229)': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 },
    ArrowDown: {
      key: 'ArrowDown',
      code: 'ArrowDown',
      windowsVirtualKeyCode: 40,
    },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  };

  for (const [name, key] of Object.entries(keys)) {
    test(`${name} while composing leaves the tab, the focus and the text alone`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const target = await openTab(serviceWorker, 'きょうの予定');
      await openTab(serviceWorker, 'Other tab');
      const page = await openPage(context, extensionId, VIEW_TAB, {
        width: 1600,
        height: 800,
      });
      const cdp = await composing(page, context);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      await page.waitForTimeout(500);
      const tabActive = () =>
        serviceWorker.evaluate(
          async (id: number) => (await chrome.tabs.get(id)).active,
          target
        );
      expect(await tabActive()).toBe(false);
      await expect(field(page)).toBeFocused();
      await expect(field(page)).toHaveValue('きょう');

      // CONTROL: the same text typed rather than composed, and Enter
      // switches to the same tab.
      await field(page).fill('きょう');
      await field(page).press('Enter');
      await expect.poll(tabActive).toBe(true);
    });
  }

  test('Esc while composing in the drawer leaves the drawer open', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await openTab(serviceWorker, 'きょうの予定');
    await openTab(serviceWorker, 'Other tab');
    await seedTwoSessions(context);
    await seedSideBySide(context);
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1024,
      height: 768,
    });
    await railButton(page).click();
    const drawer = page.getByRole('dialog', { name: 'Open now' });
    await expect(drawer).toBeVisible();
    const cdp = await composing(page, context);
    const esc = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...esc });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...esc });
    await page.waitForTimeout(300);
    await expect(drawer).toBeVisible();
    await expect(field(page)).toHaveValue('きょう');

    // CONTROL: the same text typed rather than composed, Esc clears it, and
    // Esc again closes the drawer.
    await field(page).fill('きょう');
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });
});

// ---- measured: the two × columns with a classic scrollbar ----

// Headless hides scrollbars by default, and a classic bar takes its width
// from the scroller only: the tab rows' × moves left by it, the search row's
// (outside the scroller) does not. KAN-336: known offset under a classic
// scrollbar; update when KAN-336 lands.
test.describe('with a classic scrollbar (KAN-330)', () => {
  test.use({ showScrollbars: true });

  test("a tab row's × sits one scrollbar width left of the search row's × (KAN-336)", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedTwoSessions(context);
    await seedSideBySide(context);
    const titles = Array.from(
      { length: 30 },
      (_, i) => `Tab ${String(i + 1).padStart(2, '0')}`
    );
    await openWindow(serviceWorker, titles);
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1317,
      height: 800,
    });
    await expect(liveRow(page, 'Tab 01')).toBeVisible();
    const measure = () =>
      page.evaluate(() => {
        const centre = (el: Element | null | undefined) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: (r.left + r.right) / 2, width: r.width };
        };
        const row = document.querySelector(
          '[data-pane="open-now"] [data-open-now-search]'
        );
        const slot = row?.lastElementChild;
        const scroller = document.querySelector(
          '[data-pane="open-now"] [data-open-window-id]'
        )?.parentElement;
        let s: Element | null | undefined = scroller;
        while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowY))
          s = s.parentElement;
        const strip = document.querySelector(
          '[data-pane="open-now"] [data-open-tab-id] [data-close-tab]'
        );
        return {
          searchSlot: centre(slot),
          searchX: centre(slot?.querySelector('[role="button"]')),
          tabStrip: centre(strip),
          tabX: centre(strip?.querySelector('[role="button"]')),
          scrollbar:
            s instanceof HTMLElement ? s.offsetWidth - s.clientWidth : null,
          overflows:
            s instanceof HTMLElement ? s.scrollHeight > s.clientHeight : null,
        };
      });
    await field(page).fill('tab');
    await expect(liveRow(page, 'Tab 30')).toHaveCount(1);
    const m = await measure();
    console.log(`[scrollbar ×] ${JSON.stringify(m)}`);
    // PREMISES: the list scrolls, and the bar takes room from it.
    expect(m.overflows).toBe(true);
    if (m.searchX === null || m.tabX === null || m.scrollbar === null) {
      throw new Error(`a box is missing: ${JSON.stringify(m)}`);
    }
    expect(m.scrollbar).toBeGreaterThan(0);
    // KAN-336: known offset under a classic scrollbar; update when KAN-336
    // lands. Exactly the bar's measured width (10px here).
    expect(m.searchX.x - m.tabX.x).toBeCloseTo(m.scrollbar, 0);
  });
});

// ---- the empty message in the new scroller ----

test.describe('Open now with no other tabs (KAN-330)', () => {
  test('"No other tabs are open" is centred in the scroller under the search row', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, VIEW_TAB, {
      width: 1600,
      height: 800,
    });
    // The launch window's about:blank is a tab Open now would list.
    for (const other of context.pages()) {
      if (other !== page) await other.close();
    }
    const message = page
      .locator(OPEN_NOW)
      .getByText('No other tabs are open', { exact: true });
    await expect(message).toBeVisible();
    const facts = await message.evaluate((label) => {
      let s: Element | null = label;
      while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowY))
        s = s.parentElement;
      const row = document.querySelector(
        '[data-pane="open-now"] [data-open-now-search]'
      );
      if (s === null || row === null) return null;
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          cx: (r.left + r.right) / 2,
          cy: (r.top + r.bottom) / 2,
        };
      };
      return { label: box(label), scroller: box(s), row: box(row) };
    });
    console.log(`[empty] ${JSON.stringify(facts)}`);
    if (facts === null) throw new Error('no scroller or search row');
    // The scroller starts under the search row (and its 4px gap).
    expect(facts.scroller.top).toBeGreaterThanOrEqual(facts.row.bottom);
    expect(Math.abs(facts.label.cx - facts.scroller.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(facts.label.cy - facts.scroller.cy)).toBeLessThanOrEqual(1);
  });
});
