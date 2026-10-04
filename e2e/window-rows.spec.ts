// KAN-394 P2 on the real artifact: a click on a saved window's title renames
// it, and the Open button in its strip opens it. Popup and tab view.

import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { contrast, pixelsAt, rgbToHex } from './fixtures/pixels';
import {
  AUTO_SCROLL_BAND,
  NAMED,
  THEMES,
  VIEWS,
  boxOf,
  detailPane,
  header,
  openSaved,
  savedWindow,
  session,
  stored,
  storedWindowIds,
  type View,
} from './fixtures/savedWindows';
import type {
  tabContainerData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';
import { resolveTabUrl } from '../src/utils/functions/local';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';
import { TYPE } from '../src/styles/scale';

// Bounds a headless screen can hold, so Open's window is made at them.
const win = (id: string, title: string, tabs = 2): windowGroupData =>
  savedWindow(id, title, tabs, { width: 800, height: 600 });

// A named w1 on top, an unnamed w2 and w3.
const S1 = () =>
  session('S1', 'Source', [win('w1', NAMED), win('w2', ''), win('w3', '')]);

const open = (
  context: BrowserContext,
  extensionId: string,
  view: View,
  {
    sessions = [S1()],
    theme,
  }: { sessions?: tabContainerData[]; theme?: string } = {}
): Promise<Page> =>
  openSaved(context, extensionId, view, {
    sessions,
    settings: theme ? { theme } : {},
  });

// The title is the header's button that shows the label: found by its text, not
// its name, so on main's build it is the same button (which opened the window).
const title = (page: Page, windowId: string, label: string) =>
  header(page, windowId).locator('button', { hasText: label });

const openButton = (page: Page, windowId: string, label: string) =>
  header(page, windowId).getByRole('button', {
    name: `Open in new window: ${label}`,
    exact: true,
  });

const editor = (page: Page, windowId: string) =>
  header(page, windowId).getByRole('textbox');

// Opens the window's title editor. The one step that differs on main's build.
const startRename = (page: Page, windowId: string, label: string) =>
  title(page, windowId, label).click();

const storedWindow = async (page: Page, windowId: string) => {
  const found = (await stored(page)).tabGroups
    .flatMap((g) => g.windows)
    .find((w) => w.windowId === windowId);
  if (found === undefined) throw new Error(`no stored window ${windowId}`);
  return found;
};

const chromeWindowIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll()).flatMap((w) =>
      w.id === undefined ? [] : [w.id]
    )
  );

// Chrome's window count every 100ms for `ms`, polled in the service worker.
const windowCountsOver = (worker: Worker, ms: number) =>
  worker.evaluate(async (ms) => {
    const seen: number[] = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      seen.push((await chrome.windows.getAll()).length);
      await new Promise((done) => setTimeout(done, 100));
    }
    return seen;
  }, ms);

// The distinct stored containers seen every 50ms for `ms`, polled in the page.
const storedValuesOver = (page: Page, ms: number) =>
  page.evaluate(async (ms) => {
    const seen: string[] = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const raw = localStorage.getItem('tabContainerData') ?? '';
      if (seen[seen.length - 1] !== raw) seen.push(raw);
      await new Promise((done) => setTimeout(done, 50));
    }
    return seen;
  }, ms);

// The real URLs of the tabs in each window not in `before`.
const newWindowUrls = (worker: Worker, before: number[]) =>
  worker.evaluate(async (before) => {
    const windows = await chrome.windows.getAll({ populate: true });
    return windows
      .filter((w) => w.id !== undefined && !before.includes(w.id))
      .map((w) => (w.tabs ?? []).map((t) => t.pendingUrl || t.url || ''));
  }, before);

const savedUrls = (w: windowGroupData) => w.tabs.map((t) => t.url);

interface GestureSeen {
  dragging: boolean;
  editor: boolean;
}

declare global {
  interface Window {
    __kan394Seen?: GestureSeen;
    __kan394Stop?: () => void;
  }
}

// One observer over a whole gesture: did a drag start, was an editor drawn.
const watchGesture = (page: Page) =>
  page.evaluate(() => {
    const seen: GestureSeen = { dragging: false, editor: false };
    window.__kan394Seen = seen;
    const observer = new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-dragging'))
        seen.dragging = true;
      if (
        document.querySelector(
          '[data-pane="detail"] [data-window-drag-handle] input'
        )
      )
        seen.editor = true;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.__kan394Stop = () => observer.disconnect();
  });

const gestureSeen = (page: Page) =>
  page.evaluate(() => {
    window.__kan394Stop?.();
    return window.__kan394Seen ?? null;
  });

for (const view of VIEWS) {
  test.describe(`${view}`, () => {
    test('a title click renames, and opens no window', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await open(context, extensionId, view);
      const before = (await chromeWindowIds(serviceWorker)).length;

      const sampling = windowCountsOver(serviceWorker, 1000);
      await title(page, 'w1', NAMED).click();
      expect(new Set(await sampling)).toEqual(new Set([before]));
      await expect(editor(page, 'w1')).toBeVisible();
      await expect(editor(page, 'w1')).toHaveValue(NAMED);

      // CONTROL: the same poll sees Open's window appear.
      await page.keyboard.press('Escape');
      await header(page, 'w1').hover();
      const controlSampling = windowCountsOver(serviceWorker, 1000);
      await openButton(page, 'w1', NAMED).click();
      expect(await controlSampling).toContain(before + 1);
    });

    test('Open opens the window with its saved tabs', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await open(context, extensionId, view);
      const before = await chromeWindowIds(serviceWorker);

      await header(page, 'w1').hover();
      await expect(openButton(page, 'w1', NAMED)).toHaveCount(1);
      await openButton(page, 'w1', NAMED).click();

      await expect
        .poll(async () =>
          (await newWindowUrls(serviceWorker, before)).map((urls) =>
            urls.map(resolveTabUrl)
          )
        )
        .toEqual([savedUrls(win('w1', NAMED))]);
      // The editor did not open.
      await expect(editor(page, 'w1')).toHaveCount(0);
    });

    test('Tab from the title reaches Open, shown, and Enter opens', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await open(context, extensionId, view);
      const before = await chromeWindowIds(serviceWorker);
      const open1 = openButton(page, 'w1', NAMED);
      // PREMISE: hidden while the row is neither hovered nor focused.
      await expect(open1).toHaveCSS('opacity', '0');

      await title(page, 'w1', NAMED).focus();
      await page.keyboard.press('Tab');
      await expect(open1).toBeFocused();
      // Revealed by :focus-within; the pointer is at (0, 0), off the row.
      await expect(open1).toHaveCSS('opacity', '1');

      await page.keyboard.press('Enter');
      await expect
        .poll(async () => (await newWindowUrls(serviceWorker, before)).length)
        .toBe(1);
    });

    test('a blank rename leaves the window unnamed: "Window 1", muted', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view, { theme: 'Light' });

      await startRename(page, 'w1', NAMED);
      await editor(page, 'w1').fill('');
      await editor(page, 'w1').press('Enter');

      await expect
        .poll(async () => (await storedWindow(page, 'w1')).title)
        .toBe('');
      const label = header(page, 'w1')
        .locator('button', { hasText: 'Window 1' })
        .getByText('Window 1', { exact: true });
      await expect(label).toBeVisible();
      expect(
        rgbToHex(await label.evaluate((el) => getComputedStyle(el).color))
      ).toBe(LIGHT_THEME.LABEL_L2_COLOR);
      await expect(header(page, 'w1').getByText(NAMED)).toHaveCount(0);
    });

    test('Esc cancels: the title is unchanged and nothing is stored', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      const before = await stored(page);

      await startRename(page, 'w1', NAMED);
      await editor(page, 'w1').fill('Not this');
      const sampling = storedValuesOver(page, 1000);
      await editor(page, 'w1').press('Escape');

      await expect(editor(page, 'w1')).toHaveCount(0);
      await expect(title(page, 'w1', NAMED)).toBeVisible();
      expect(await sampling).toEqual([JSON.stringify(before)]);
      const after = await stored(page);
      expect(after).toEqual(before);
      expect(after.tabGroups[0]?.lastModified).toBe(
        before.tabGroups[0]?.lastModified
      );

      // CONTROL: the same sampler sees a commit.
      await startRename(page, 'w1', NAMED);
      await editor(page, 'w1').fill('This one');
      const control = storedValuesOver(page, 1000);
      await editor(page, 'w1').press('Enter');
      expect((await control).length).toBeGreaterThan(1);
      expect((await storedWindow(page, 'w1')).title).toBe('This one');
    });

    // The click after the tick's commit must not land on what replaced it.
    test('the tick commits once, and its click opens and deletes nothing', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await open(context, extensionId, view);
      const before = (await chromeWindowIds(serviceWorker)).length;

      await startRename(page, 'w1', NAMED);
      await editor(page, 'w1').fill('Ticked');
      const tick = header(page, 'w1').getByRole('button', {
        name: 'Save changes',
        exact: true,
      });
      const b = await boxOf(tick);
      const sampling = windowCountsOver(serviceWorker, 1000);
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);

      expect(new Set(await sampling)).toEqual(new Set([before]));
      await expect
        .poll(async () => (await storedWindow(page, 'w1')).title)
        .toBe('Ticked');
      await expect(editor(page, 'w1')).toHaveCount(0);
      expect(await storedWindowIds(page, 'S1')).toEqual(['w1', 'w2', 'w3']);
    });

    test('while searching: no Open, and the title still renames', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      // By attribute, not role: a role query skips aria-hidden nodes.
      const opens = page.locator(
        '[data-pane="detail"] [aria-label^="Open in new window"]'
      );
      // CONTROL: the same query finds each window's Open before the search.
      await expect(opens).toHaveCount(3);
      await page.locator('[data-saved-search] input').fill('Page w1');
      await expect(header(page, 'w2')).toHaveCount(0);
      await expect(header(page, 'w1')).toBeVisible();

      await header(page, 'w1').hover();
      await expect(opens).toHaveCount(0);
      // CONTROL: the strip is there, with Collapse beside the title.
      await expect(
        header(page, 'w1').getByRole('button', { name: `Collapse: ${NAMED}` })
      ).toBeVisible();

      await title(page, 'w1', NAMED).click();
      await editor(page, 'w1').fill('Found');
      await editor(page, 'w1').press('Enter');
      await expect
        .poll(async () => (await storedWindow(page, 'w1')).title)
        .toBe('Found');
    });

    test("a click on the row's empty middle does nothing (R4)", async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await open(context, extensionId, view);
      await header(page, 'w1').hover();
      // From the label's own text, so a title stretched over the gap is caught.
      const t = await boxOf(
        title(page, 'w1', NAMED).getByText(NAMED, { exact: true })
      );
      const strip = await boxOf(
        header(page, 'w1').locator('[data-row-actions]')
      );
      const h = await boxOf(header(page, 'w1'));
      // PREMISE: room between the title's text and the strip.
      expect(strip.x - (t.x + t.width)).toBeGreaterThan(40);
      const x = (t.x + t.width + strip.x) / 2;
      const y = h.y + h.height / 2;

      const before = (await chromeWindowIds(serviceWorker)).length;
      const sampling = windowCountsOver(serviceWorker, 1000);
      await page.mouse.click(x, y);
      expect(new Set(await sampling)).toEqual(new Set([before]));
      await expect(editor(page, 'w1')).toHaveCount(0);
      // PREMISE, on the same layout: the point is on the header, in no control.
      expect(
        await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el?.closest('button, [role="button"], [data-row-actions]')
              ? 'control'
              : el?.closest('[data-window-drag-handle]')
                ? 'header'
                : 'elsewhere';
          },
          [x, y]
        )
      ).toBe('header');

      // CONTROL: a click on the title opens the editor.
      await page.mouse.click(t.x + t.width / 2, y);
      await expect(editor(page, 'w1')).toBeVisible();
    });

    test('CONTROL (R8): a tab click still opens the tab', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await open(context, extensionId, view);
      const urls = () =>
        serviceWorker.evaluate(async () =>
          (await chrome.tabs.query({})).map((t) => t.pendingUrl || t.url || '')
        );
      // PREMISE: not already open.
      expect(await urls()).not.toContain('https://w1-0.test/');

      await page
        .getByRole('button', {
          name: 'Open in new tab: Page w1.0',
          exact: true,
        })
        .click();
      await expect.poll(urls).toContain('https://w1-0.test/');
    });

    test('a sideways drag on the top title moves nothing and renames nothing', async ({
      context,
      extensionId,
    }) => {
      const page = await open(context, extensionId, view);
      const order = await storedWindowIds(page, 'S1');
      const t = await boxOf(title(page, 'w1', NAMED));
      const x = t.x + Math.min(30, t.width / 2);
      const y = t.y + t.height / 2;

      await watchGesture(page);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y, { steps: 8 });
      await page.mouse.move(x, y, { steps: 8 });
      await page.mouse.up();
      // Settled: the drag's flag is gone.
      await expect(page.locator('html[data-dragging]')).toHaveCount(0);
      expect(await gestureSeen(page)).toEqual({
        dragging: true,
        editor: false,
      });
      expect(await storedWindowIds(page, 'S1')).toEqual(order);

      // CONTROL: the same observer sees a plain click open the editor.
      await watchGesture(page);
      await page.mouse.click(x, y);
      await expect(editor(page, 'w1')).toBeVisible();
      expect(await gestureSeen(page)).toEqual({
        dragging: false,
        editor: true,
      });
    });
  });
}

// The unnamed window renames from an empty field, prompting "Name this window".
test('popup: an unnamed window\'s field is empty, with "Name this window" as its placeholder', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'popup');
  await startRename(page, 'w2', 'Window 2');
  await expect(editor(page, 'w2')).toHaveValue('');
  await expect(editor(page, 'w2')).toHaveAttribute(
    'placeholder',
    'Name this window'
  );
});

// ---- the Open button's look (Task 7's checks, on the built artifact) ---------

for (const [theme, colours] of THEMES) {
  test(`popup, ${theme}: the Open button is 32px, a 1px DIVIDER edge, SECONDARY type, LABEL_L1 at rest and TEXT on hover and press`, async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, 'popup', { theme });
    const button = openButton(page, 'w1', NAMED);
    const style = () =>
      button.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          height: s.height,
          borders: [
            s.borderTopWidth,
            s.borderRightWidth,
            s.borderBottomWidth,
            s.borderLeftWidth,
          ],
          borderColours: [
            s.borderTopColor,
            s.borderRightColor,
            s.borderBottomColor,
            s.borderLeftColor,
          ],
          fontSize: s.fontSize,
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
          color: s.color,
          background: s.backgroundColor,
          opacity: s.opacity,
        };
      });

    // At rest, revealed: the pointer on the row's title, not on the button.
    await title(page, 'w1', NAMED).hover();
    await expect.poll(async () => (await style()).opacity).toBe('1');
    const rest = await style();
    expect(rest.height).toBe('32px');
    expect((await boxOf(button)).height).toBe(32);
    expect(rest.borders).toEqual(['1px', '1px', '1px', '1px']);
    expect(rest.borderColours.map(rgbToHex)).toEqual(
      Array(4).fill(colours.DIVIDER_COLOR)
    );
    expect(parseFloat(rest.fontSize)).toBeCloseTo(
      parseFloat(rest.rootFontSize) * parseFloat(TYPE.SECONDARY),
      2
    );
    expect(rgbToHex(rest.color)).toBe(colours.LABEL_L1_COLOR);

    // The ground behind the transparent button, painted and computed.
    const b = await boxOf(button);
    const groundComputed = await button.evaluate((el) => {
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        node = node.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    });
    const [groundPainted] = await pixelsAt(page, [[b.x + 3, b.y + 3]]);
    console.log(
      `[${theme}] ground painted ${groundPainted}, computed ${rgbToHex(
        groundComputed
      )}, HOVER ${colours.HOVER_COLOR}; LABEL_L1 on it ${contrast(
        colours.LABEL_L1_COLOR,
        groundPainted
      ).toFixed(2)}:1`
    );
    expect(groundPainted).toBe(rgbToHex(groundComputed));
    expect(contrast(colours.LABEL_L1_COLOR, groundPainted)).toBeGreaterThan(
      4.5
    );

    // Hover: the computed colour, after its transition.
    await button.hover();
    await expect
      .poll(async () => rgbToHex((await style()).background))
      .toBe(colours.ICON_HOVER_COLOR);
    await expect
      .poll(async () => rgbToHex((await style()).color))
      .toBe(colours.TEXT_COLOR);

    // Press, held: :active's fill is the premise that it is the press.
    await page.mouse.down();
    await expect
      .poll(async () => rgbToHex((await style()).background))
      .toBe(colours.ICON_ACTIVE_COLOR);
    await expect
      .poll(async () => rgbToHex((await style()).color))
      .toBe(colours.TEXT_COLOR);
    // Released off the button, so nothing opens.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });
}

// ---- keyboard focus ground ----------------------------------------------------

test('popup: focused by keyboard, the Open button sits on HOVER_COLOR', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'popup', { theme: 'Light' });
  const button = openButton(page, 'w1', NAMED);
  await title(page, 'w1', NAMED).focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('opacity', '1');
  const b = await boxOf(button);
  const [ground] = await pixelsAt(page, [[b.x + 3, b.y + 3]]);
  console.log(`[Light, focus] ground painted ${ground}`);
  expect(ground).toBe(LIGHT_THEME.HOVER_COLOR);
});

// ---- from a scrolled list --------------------------------------------------

test('popup, scrolled: a title click renames and moves nothing', async ({
  context,
  extensionId,
}) => {
  const ids = Array.from({ length: 12 }, (_, i) => `w${i + 1}`);
  const page = await open(context, extensionId, 'popup', {
    sessions: [
      session(
        'S1',
        'Long',
        ids.map((id) => win(id, '', 3))
      ),
    ],
  });
  const target = header(page, 'w6');
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const pane = await detailPane(page);
  expect(pane.scrollTop).toBeGreaterThan(0);
  const t = await boxOf(title(page, 'w6', 'Window 6'));
  // Clear of both auto-scroll bands (KAN-200).
  expect(t.y).toBeGreaterThan(pane.top + AUTO_SCROLL_BAND);
  expect(t.y + t.height).toBeLessThan(pane.bottom - AUTO_SCROLL_BAND);
  const order = await storedWindowIds(page, 'S1');

  await title(page, 'w6', 'Window 6').click();
  await expect(editor(page, 'w6')).toBeVisible();
  await expect(editor(page, 'w6')).toHaveAttribute(
    'placeholder',
    'Name this window'
  );
  expect((await detailPane(page)).scrollTop).toBe(pane.scrollTop);
  expect(await storedWindowIds(page, 'S1')).toEqual(order);
});

test('popup, scrolled: a sideways drag on a title renames nothing', async ({
  context,
  extensionId,
}) => {
  const ids = Array.from({ length: 12 }, (_, i) => `w${i + 1}`);
  const page = await open(context, extensionId, 'popup', {
    sessions: [
      session(
        'S1',
        'Long',
        ids.map((id) => win(id, '', 3))
      ),
    ],
  });
  await header(page, 'w6').evaluate((el) =>
    el.scrollIntoView({ block: 'center' })
  );
  const pane = await detailPane(page);
  expect(pane.scrollTop).toBeGreaterThan(0);
  const t = await boxOf(title(page, 'w6', 'Window 6'));
  const x = t.x + Math.min(30, t.width / 2);
  const y = t.y + t.height / 2;
  await watchGesture(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y, { steps: 2 });
  await expect(page.locator('html[data-dragging]')).toHaveCount(1);
  // The pick-up folds every window (KAN-153), so the list's place is read after it.
  const atPickUp = (await detailPane(page)).scrollTop;
  expect(atPickUp).toBeGreaterThan(0);
  await page.mouse.move(x + 40, y, { steps: 6 });
  await page.mouse.move(x, y, { steps: 8 });
  // The aim is clear of both auto-scroll bands, and the list held still (KAN-200).
  expect(y).toBeGreaterThan(pane.top + AUTO_SCROLL_BAND);
  expect(y).toBeLessThan(pane.bottom - AUTO_SCROLL_BAND);
  const atAim = (await detailPane(page)).scrollTop;
  expect(atAim).toBe(atPickUp);
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  );
  expect((await detailPane(page)).scrollTop).toBe(atAim);
  await page.mouse.up();
  await expect(page.locator('html[data-dragging]')).toHaveCount(0);

  // Below the top, the pick-up can move the window (KAN-161), so only the
  // rename is claimed here.
  expect(await gestureSeen(page)).toEqual({ dragging: true, editor: false });

  // CONTROL: the same observer sees a plain click on that title open the
  // editor. Its number follows wherever the drag left it.
  const again = await boxOf(
    header(page, 'w6').locator('button', { hasText: /^Window \d+$/ })
  );
  await watchGesture(page);
  await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
  await expect(editor(page, 'w6')).toBeVisible();
  expect(await gestureSeen(page)).toEqual({ dragging: false, editor: true });
});
