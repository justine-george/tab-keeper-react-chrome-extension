// KAN-394 on the real artifact: a saved window with no name is drawn as a
// muted "Window N", N its place among the windows drawn; a name is drawn as
// text. Driven as the popup and as the tab view (side by side).

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { contrast, rgbToHex } from './fixtures/pixels';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../src/redux/slices/tabContainerDataStateSlice';
import { isValidTabMasterContainer } from '../src/utils/functions/local';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../src/hooks/useThemeColors';

const POPUP = { width: 790, height: 550 };
const TAB_VIEW = { width: 1280, height: 800 };
const VIEWS = ['popup', 'tab view'] as const;
type View = (typeof VIEWS)[number];

const THEMES: [string, ThemeColors][] = [
  ['Light', LIGHT_THEME],
  ['WarmLight', WARM_LIGHT_THEME],
  ['BBPink', BB_PINK_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
  ['Blue', BLUE_THEME],
];

const NAMED = 'Reading list';

const win = (id: string, title: string, tabs = 1) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs,
  title,
  tabs: Array.from({ length: tabs }, (_, i) => ({
    tabId: `${id}-t${i}`,
    favicon: '',
    title: `Page ${id}.${i}`,
    url: `https://${id}-${i}.test/`,
  })),
});

const session = (
  id: string,
  title: string,
  windows: ReturnType<typeof win>[]
): tabContainerData =>
  buildSession({
    tabGroupId: id,
    title,
    windowCount: windows.length,
    tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
    windows,
  });

// Unnamed w1, w2, w3 and a named w4; S2 is somewhere for a carry to go.
const S1 = () =>
  session('S1', 'Source', [
    win('w1', ''),
    win('w2', ''),
    win('w3', ''),
    win('w4', NAMED),
  ]);
const S2 = () => session('S2', 'Target', [win('d1', 'Elsewhere')]);

async function open(
  context: BrowserContext,
  extensionId: string,
  view: View,
  sessions: tabContainerData[] = [S1(), S2()]
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer(
      sessions.map((s) => ({ ...s, isSelected: s.tabGroupId === 'S1' }))
    ),
    selectedTabGroupId: 'S1',
  });
  if (view === 'tab view') {
    await seedSettings(context, { foldSavedSessionInTabView: false });
  }
  const page = await context.newPage();
  await page.setViewportSize(view === 'popup' ? POPUP : TAB_VIEW);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${
      view === 'tab view' ? '?view=tab' : ''
    }`
  );
  // goto resolves before React mounts (KAN-105): every test crosses this.
  const first = sessions[0]?.windows[0]?.windowId;
  if (view === 'tab view') {
    await page
      .locator('[data-pane="sessions"] [data-drag-row-id="S1"]')
      .click();
  }
  await expect(page.locator(`[data-drag-row-id="${first}"]`)).toBeVisible();
  return page;
}

const header = (page: Page, windowId: string): Locator =>
  page.locator(
    `[data-pane="detail"] [data-drag-row-id="${windowId}"] [data-window-drag-handle]`
  );

// The windows drawn, in order, as `id=label`: the label from the chevron's
// name ("Collapse: <label>"), and marked "(not drawn)" unless the header also
// shows it as text.
const labels = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-pane="detail"] [data-drag-row-id]'
      ),
    ].flatMap((r) => {
      const h = r.querySelector('[data-window-drag-handle]');
      if (h === null) return [];
      const label = (
        h.querySelector('[aria-expanded]')?.getAttribute('aria-label') ?? '?'
      ).replace(/^(Collapse|Expand): /, '');
      const drawn = [...h.querySelectorAll('*')].some((e) =>
        [...e.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent === label
        )
      );
      return [`${r.dataset.dragRowId}=${label}${drawn ? '' : ' (not drawn)'}`];
    })
  );

const labelOf = async (page: Page, windowId: string) =>
  (await labels(page))
    .find((l) => l.startsWith(`${windowId}=`))
    ?.slice(windowId.length + 1) ?? null;

// The computed colour of the element holding the label's text.
const labelColourOf = (page: Page, windowId: string, text: string) =>
  page.evaluate(
    ({ id, text }) => {
      const h = document.querySelector(
        `[data-pane="detail"] [data-drag-row-id="${id}"] [data-window-drag-handle]`
      );
      const el = [...(h?.querySelectorAll<HTMLElement>('*') ?? [])].find((e) =>
        [...e.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent === text
        )
      );
      if (el === undefined) throw new Error(`no "${text}" in ${id}`);
      return getComputedStyle(el).color;
    },
    { id: windowId, text }
  );

async function stored(page: Page): Promise<TabMasterContainer> {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  if (!isValidTabMasterContainer(parsed)) {
    throw new Error(`tabContainerData is not a container: ${raw}`);
  }
  return parsed;
}

const storedWindowIds = async (page: Page, id: string) =>
  (await stored(page)).tabGroups
    .find((g) => g.tabGroupId === id)
    ?.windows.map((w) => w.windowId) ?? [];

async function boxOf(loc: Locator) {
  const b = await loc.boundingBox();
  if (b === null) throw new Error(`no box for ${loc.toString()}`);
  return b;
}

// The saved detail's scrolling box: the window rows' nearest overflow ancestor.
const detailPane = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    const b = el.getBoundingClientRect();
    return {
      left: b.left,
      top: b.top,
      bottom: b.bottom,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });

const setDetailScroll = (page: Page, top: number) =>
  page.evaluate((top) => {
    let el = document.querySelector(
      '[data-pane="detail"] [data-drop-window-id]'
    )?.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    if (!el) throw new Error('no detail pane');
    el.scrollTop = top;
    return el.scrollTop;
  }, top);

// Presses a window's header and drags it past the activation distance.
async function pickUp(page: Page, windowId: string) {
  const b = await boxOf(header(page, windowId));
  const x = b.x + Math.min(60, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  return { x, y: y + 8 };
}

const AUTO_SCROLL_BAND = 48;

for (const view of VIEWS) {
  test.describe(`${view}`, () => {
    test('unnamed windows read Window 1-3, a named one its name', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      await expect
        .poll(() => labels(page))
        .toEqual(['w1=Window 1', 'w2=Window 2', 'w3=Window 3', `w4=${NAMED}`]);
      // The title button carries the label as its name.
      await expect(
        header(page, 'w2').getByRole('button', {
          name: 'Window 2',
          exact: true,
        })
      ).toBeVisible();
    });

    test('a window dragged to the top is Window 1, and the one it passed Window 2', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      const from = await pickUp(page, 'w3');
      // The windows fold for the drag; aim at w1's folded header, upper half.
      const w1 = await boxOf(header(page, 'w1'));
      const pane = await detailPane(page);
      const aimY = w1.y + w1.height / 4;
      await page.mouse.move(from.x, aimY, { steps: 12 });
      // The aim may be in the top band, so the premise is a pane that cannot scroll.
      const atAim = await detailPane(page);
      expect(atAim.scrollHeight).toBeLessThanOrEqual(atAim.clientHeight);
      expect(atAim.scrollTop).toBe(pane.scrollTop);
      await page.mouse.up();

      await expect
        .poll(() => storedWindowIds(page, 'S1'))
        .toEqual(['w3', 'w1', 'w2', 'w4']);
      await expect
        .poll(() => labels(page))
        .toEqual(['w3=Window 1', 'w1=Window 2', 'w2=Window 3', `w4=${NAMED}`]);
    });

    test('deleting window 1 makes window 2 Window 1', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      await header(page, 'w1').hover();
      await header(page, 'w1')
        .getByRole('button', { name: 'Delete window group', exact: true })
        .click();

      await expect
        .poll(() => storedWindowIds(page, 'S1'))
        .toEqual(['w2', 'w3', 'w4']);
      await expect
        .poll(() => labels(page))
        .toEqual(['w2=Window 1', 'w3=Window 2', `w4=${NAMED}`]);
    });

    // L6: the label is drawn, not stored, so a search does not find it.
    test('searching "Window 2" finds no window', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      await page.locator('[data-saved-search] input').fill('Window 2');

      await expect(page.locator('[data-no-match]')).toBeVisible();
      await expect(
        page.locator('[data-pane="detail"] [data-window-drag-handle]')
      ).toHaveCount(0);
    });

    test(`CONTROL: searching "${NAMED}" finds the named window`, async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      await page.locator('[data-saved-search] input').fill(NAMED);

      await expect(header(page, 'w4')).toBeVisible();
      await expect(page.locator('[data-no-match]')).toHaveCount(0);
      expect(await labels(page)).toEqual([`w4=${NAMED}`]);
    });

    test('while window 1 is carried, window 2 reads Window 1; Esc puts it back', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      // Onto the shown session's own row: a receiver that never opens.
      const row = await boxOf(
        page.locator('[data-pane="sessions"] [data-drag-row-id="S1"]')
      );
      await pickUp(page, 'w1');
      await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, {
        steps: 6,
      });
      await expect(page.locator('[data-carry-card]')).toHaveCount(1);

      // The card names it as its header did (D3).
      await expect(
        page.locator('[data-carry-card] [data-carry-card-name]')
      ).toHaveText('Window 1 · 1 Tab');
      await expect.poll(() => labelOf(page, 'w2')).toBe('Window 1');
      await expect.poll(() => labelOf(page, 'w3')).toBe('Window 2');

      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(page.locator('[data-carry-card]')).toHaveCount(0);
      await expect
        .poll(() => labels(page))
        .toEqual(['w1=Window 1', 'w2=Window 2', 'w3=Window 3', `w4=${NAMED}`]);
      expect(await storedWindowIds(page, 'S1')).toEqual([
        'w1',
        'w2',
        'w3',
        'w4',
      ]);
    });
  });
}

// From a scrolled list: wherever a window lands, every unnamed window reads
// its stored place.
test('popup, scrolled: after a window drag the labels follow the stored order', async ({
  context,
  extensionId,
}) => {
  const ids = Array.from({ length: 14 }, (_, i) => `w${i + 1}`);
  const page = await open(context, extensionId, 'popup', [
    session(
      'S1',
      'Long',
      ids.map((id) => win(id, '', 3))
    ),
    S2(),
  ]);
  expect(await setDetailScroll(page, 600)).toBe(600);
  const pane = await detailPane(page);
  // The topmost header wholly in the pane, clear of the top band.
  const grab = await page.evaluate(
    ({ top, bottom, band }) => {
      for (const h of document.querySelectorAll('[data-window-drag-handle]')) {
        const r = h.getBoundingClientRect();
        if (r.top >= top + band && r.bottom <= bottom - band) {
          return (
            h.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId ??
            null
          );
        }
      }
      return null;
    },
    { top: pane.top, bottom: pane.bottom, band: AUTO_SCROLL_BAND }
  );
  if (grab === null) throw new Error('no header clear of the bands');
  const before = await storedWindowIds(page, 'S1');

  const from = await pickUp(page, grab);
  const aimY = (pane.top + pane.bottom) / 2 + 40;
  await page.mouse.move(from.x, aimY, { steps: 12 });
  // Clear of both bands, so nothing scrolls under the held aim (KAN-200).
  expect(aimY).toBeGreaterThan(pane.top + AUTO_SCROLL_BAND);
  expect(aimY).toBeLessThan(pane.bottom - AUTO_SCROLL_BAND);
  const atAim = (await detailPane(page)).scrollTop;
  // PREMISE: the folded list is still scrolled at the aim.
  expect(atAim).toBeGreaterThan(0);
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  );
  expect((await detailPane(page)).scrollTop).toBe(atAim);
  await page.mouse.up();

  // CONTROL: the drop moved the window.
  await expect.poll(() => storedWindowIds(page, 'S1')).not.toEqual(before);
  const after = await storedWindowIds(page, 'S1');
  await expect
    .poll(() => labels(page))
    .toEqual(after.map((id, i) => `${id}=Window ${i + 1}`));
});

// Muted against text, in every theme; and LABEL_L2 on the hover fill logged (D7).
for (const [theme, colours] of THEMES) {
  test(`popup, ${theme}: unnamed in LABEL_L2, named in TEXT`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await open(context, extensionId, 'popup');

    for (const [id, n] of [
      ['w1', 1],
      ['w2', 2],
      ['w3', 3],
    ] as const) {
      expect(rgbToHex(await labelColourOf(page, id, `Window ${n}`))).toBe(
        colours.LABEL_L2_COLOR
      );
    }
    expect(rgbToHex(await labelColourOf(page, 'w4', NAMED))).toBe(
      colours.TEXT_COLOR
    );

    await header(page, 'w2').hover();
    // CONTROL: the header is on its hover fill.
    await expect
      .poll(async () =>
        rgbToHex(
          await header(page, 'w2').evaluate(
            (h) => getComputedStyle(h).backgroundColor
          )
        )
      )
      .toBe(colours.HOVER_COLOR);
    const label = rgbToHex(await labelColourOf(page, 'w2', 'Window 2'));
    console.log(
      `[${theme}] LABEL_L2 ${label} on HOVER ${colours.HOVER_COLOR}: ${contrast(
        label,
        colours.HOVER_COLOR
      ).toFixed(2)}:1`
    );
  });
}
