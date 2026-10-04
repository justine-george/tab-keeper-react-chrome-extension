// KAN-394 on the real artifact: a saved window with no name is drawn as a
// muted "Window N", N its place among the windows drawn; a name is drawn as
// text. Driven as the popup and as the tab view (side by side).

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
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
  windowGroupData,
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
  windows: windowGroupData[]
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

// Presses a row's handle and drags it past the activation distance.
async function pickUpRow(page: Page, handle: Locator) {
  const b = await boxOf(handle);
  const x = b.x + Math.min(60, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 2 });
  return { x, y: y + 8 };
}

const pickUp = (page: Page, windowId: string) =>
  pickUpRow(page, header(page, windowId));

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

// ---- KAN-394 L4: every new window is saved unnamed --------------------------

// A legacy session: k1 is named after its first tab, as every window was
// before L4; k2 has a name of its own. Neither is ever rewritten (L5).
const LEGACY = 'Page k1.0';
const groupedK1 = (): windowGroupData => {
  const w = win('k1', LEGACY, 3);
  return {
    ...w,
    chromeTabGroups: [{ groupId: 'gk', title: 'Kept', color: 'blue' }],
    tabs: w.tabs.map((t, i) => (i < 2 ? { ...t, chromeGroupId: 'gk' } : t)),
  };
};
const LEGACY_S1 = () =>
  session('S1', 'Legacy', [groupedK1(), win('k2', NAMED)]);

// The same session with named windows above k1, so its rows sit below the fold.
const FILLERS = Array.from({ length: 8 }, (_, i) => `f${i + 1}`);
const SCROLLED_LEGACY_S1 = () =>
  session('S1', 'Legacy', [
    ...FILLERS.map((id, i) => win(id, `Filler ${i + 1}`, 3)),
    groupedK1(),
    win('k2', NAMED),
  ]);
const fillerLabels = (scrolled: boolean) =>
  scrolled ? FILLERS.map((id, i) => `${id}=Filler ${i + 1}`) : [];

// Scrolls `grab` to the middle of the saved detail, after checking it is clear
// of both auto-scroll bands (KAN-200).
async function scrollToMiddle(page: Page, grab: Locator) {
  await grab.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const pane = await detailPane(page);
  expect(pane.scrollTop).toBeGreaterThan(0);
  const b = await boxOf(grab);
  expect(b.y).toBeGreaterThan(pane.top + AUTO_SCROLL_BAND);
  expect(b.y + b.height).toBeLessThan(pane.bottom - AUTO_SCROLL_BAND);
}

// The list did not move between the aim and the read (KAN-200). The pick-up
// folds the windows, so the reference is read at the aim, not before it.
async function expectScrollHeld(page: Page) {
  const at = (await detailPane(page)).scrollTop;
  // PREMISE: the list is still scrolled at the aim.
  expect(at).toBeGreaterThan(0);
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  );
  expect((await detailPane(page)).scrollTop).toBe(at);
}

const sessionIn = async (page: Page, id: string) => {
  const found = (await stored(page)).tabGroups.find((g) => g.tabGroupId === id);
  if (found === undefined) throw new Error(`no session ${id}`);
  return found;
};

// CONTROL (L5): the legacy titles are still stored.
async function expectLegacyKept(page: Page) {
  const s1 = await sessionIn(page, 'S1');
  expect(
    s1.windows.flatMap((w) => (w.windowId.startsWith('k') ? [w.title] : []))
  ).toEqual([LEGACY, NAMED]);
}

// The new windows' stored titles, with each one's first tab beside it.
const titledBy = (windows: windowGroupData[]) =>
  windows.map((w) => ({ title: w.title, firstTab: w.tabs[0]?.title }));

test.describe('every new window is saved unnamed (L4)', () => {
  for (const [name, save] of [
    [
      'Save all',
      (page: Page) =>
        page
          .getByRole('button', { name: 'Save all open windows as a session' })
          .click(),
    ],
    [
      'Save current window',
      async (page: Page) => {
        await page
          .locator('input#name')
          .locator('xpath=..')
          .getByRole('button', { name: 'More actions' })
          .click();
        await page
          .getByRole('menuitem', { name: 'Save current window as a session' })
          .click();
      },
    ],
  ] as const) {
    test(`popup: ${name}`, async ({ context, extensionId }) => {
      const page = await open(context, extensionId, 'popup', [
        LEGACY_S1(),
        S2(),
      ]);
      await page.locator('input#name').fill('Saved now');
      await save(page);

      await expect
        .poll(async () => (await stored(page)).tabGroups[0]?.title)
        .toBe('Saved now');
      const saved = (await stored(page)).tabGroups[0];
      // PREMISE: each window has a titled first tab it could be named by.
      expect(saved.windows.length).toBeGreaterThan(0);
      for (const w of titledBy(saved.windows)) expect(w.firstTab).toBeTruthy();
      expect(titledBy(saved.windows).map((w) => w.title)).toEqual(
        saved.windows.map(() => '')
      );
      await expect
        .poll(() => labels(page))
        .toEqual(saved.windows.map((w, i) => `${w.windowId}=Window ${i + 1}`));
      await expectLegacyKept(page);
    });
  }

  test('popup: Add current window', async ({ context, extensionId }) => {
    const page = await open(context, extensionId, 'popup', [LEGACY_S1(), S2()]);
    await page.getByRole('button', { name: 'Add current window' }).click();

    await expect
      .poll(async () => (await sessionIn(page, 'S1')).windows.length)
      .toBe(3);
    const [added] = (await sessionIn(page, 'S1')).windows;
    // PREMISE: a titled tab it could have been named by.
    expect(added.tabs[0]?.title).toBeTruthy();
    expect(added.title).toBe('');
    await expect
      .poll(() => labels(page))
      .toEqual([`${added.windowId}=Window 1`, `k1=${LEGACY}`, `k2=${NAMED}`]);
    await expectLegacyKept(page);
  });

  for (const scrolled of [false, true]) {
    test(`popup${
      scrolled ? ', scrolled' : ''
    }: a tab dropped on the header New window target`, async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, 'popup', [
        scrolled ? SCROLLED_LEGACY_S1() : LEGACY_S1(),
        S2(),
      ]);
      // Read at rest: the drag hides the controls the target stands over.
      const aim = await boxOf(
        page.getByRole('button', { name: 'Open session' })
      );
      const tab = page.locator('[data-drag-row-id="k1-t2"]');
      if (scrolled) await scrollToMiddle(page, tab);
      await pickUpRow(page, tab);
      await page.mouse.move(aim.x + aim.width / 2, aim.y + aim.height / 2, {
        steps: 8,
      });
      await expect(
        page.locator('[data-new-window-target="first"]')
      ).toHaveAttribute('data-landing', '');
      // The header is above the pane, so the aim sits in the top auto-scroll
      // band and the list scrolls under it (KAN-396): scrollTop is not held.
      await page.mouse.up();

      await expect
        .poll(async () => (await sessionIn(page, 'S1')).windows.length)
        .toBe(scrolled ? 11 : 3);
      const [made] = (await sessionIn(page, 'S1')).windows;
      expect(titledBy([made])).toEqual([{ title: '', firstTab: 'Page k1.2' }]);
      await expect
        .poll(() => labels(page))
        .toEqual([
          `${made.windowId}=Window 1`,
          ...fillerLabels(scrolled),
          `k1=${LEGACY}`,
          `k2=${NAMED}`,
        ]);
      await expectLegacyKept(page);
    });
  }

  test('tab view: Open now saves a window as a session', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await open(context, extensionId, 'tab view', [
      LEGACY_S1(),
      S2(),
    ]);
    const windowId = await serviceWorker.evaluate(async () => {
      const made = await chrome.windows.create({
        focused: false,
        url: 'data:text/html,<title>Named page</title>',
      });
      return made?.id ?? null;
    });
    if (windowId === null) throw new Error('Chrome gave no window id');
    const block = page.locator(
      `[data-pane="open-now"] [data-open-window-id="${windowId}"]`
    );
    await expect(
      block.getByRole('button', { name: 'Switch to tab: Named page' })
    ).toBeVisible();
    await block
      .getByRole('button', { name: /^Save window as a session: / })
      .click();

    await expect
      .poll(async () => (await stored(page)).tabGroups.length)
      .toBe(3);
    const saved = (await stored(page)).tabGroups[0];
    expect(titledBy(saved.windows)).toEqual([
      { title: '', firstTab: 'Named page' },
    ]);
    await expect
      .poll(() => labels(page))
      .toEqual([`${saved.windows[0].windowId}=Window 1`]);
    await expectLegacyKept(page);
  });
});

// Group bands need the tabGroups permission, granted only in this fixture.
for (const scrolled of [false, true]) {
  grantedTest(
    `popup${
      scrolled ? ', scrolled' : ''
    }: a group carried onto another session row is a new first window there, unnamed`,
    async ({ context, extensionId }) => {
      const page = await open(context, extensionId, 'popup', [
        scrolled ? SCROLLED_LEGACY_S1() : LEGACY_S1(),
        S2(),
      ]);
      const handle = page.locator(
        '[data-drag-row-id="group:gk"] [data-group-drag-handle]'
      );
      if (scrolled) await scrollToMiddle(page, handle);
      const from = await pickUpRow(page, handle);
      // Out of the detail onto the session list, where the drag is carried.
      const pane = await detailPane(page);
      await page.mouse.move(pane.left - 40, from.y, { steps: 6 });
      await expect(page.locator('[data-carry-card]')).toHaveCount(1);
      const row = await boxOf(
        page.locator('[data-pane="sessions"] [data-drag-row-id="S2"]')
      );
      await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, {
        steps: 5,
      });
      await expect
        .poll(() =>
          page.evaluate(() =>
            [...document.querySelectorAll('[data-carry-target]')].map(
              (el) =>
                el.closest<HTMLElement>('[data-drag-row-id]')?.dataset.dragRowId
            )
          )
        )
        .toEqual(['S2']);
      if (scrolled) await expectScrollHeld(page);
      await page.mouse.up();

      await expect
        .poll(async () => (await sessionIn(page, 'S2')).windows.length)
        .toBe(2);
      const [made] = (await sessionIn(page, 'S2')).windows;
      expect(titledBy([made])).toEqual([{ title: '', firstTab: LEGACY }]);
      // L5: k1 keeps its title, though the tab it was named after has left.
      await expectLegacyKept(page);

      // Show, on the Moved toast, puts S2 on screen.
      await page
        .getByRole('status')
        .getByRole('button', { name: 'Show', exact: true })
        .click();
      await expect
        .poll(() => labels(page))
        .toEqual([`${made.windowId}=Window 1`, 'd1=Elsewhere']);
    }
  );
}
