import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { pixelsAt, rgbToHex } from './fixtures/pixels';
import { LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-280 O11c on the real artifact: a pinned tab's row in Open now shows a
// pin mark (`keep`) in the icon slot left of ×, the O10b speaker's slot, and
// its Switch button is described as "Pinned". What jsdom cannot show: Chrome
// reporting a tab as pinned, the marks' geometry at Chrome's font sizes, and
// Chrome's own accessibility tree. A pin "from Chrome" is staged with
// tabs.update in the worker: Playwright cannot drive Chrome's tab strip.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';

async function openPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(TAB_VIEWPORT);
  await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
  // Barrier: goto resolves before React mounts. "Sort sessions" is in the
  // header of both the popup and the tab view.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

const dataUrl = (title: string) =>
  `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`;

const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

const liveRowIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Switch to tab: ${title}`, exact: true });

// The marks live inside the tab's Switch button (O10b, O11c).
const pinIn = (block: Locator, title: string): Locator =>
  liveRowIn(block, title).locator('[data-pin]');
const closeTabIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Close tab: ${title}`, exact: true });
const speakerIn = (block: Locator, title: string): Locator =>
  liveRowIn(block, title).locator('[data-speaker]');

interface MadeWindow {
  windowId: number;
  tabIds: number[];
}

// A window the browser opens, unfocused so the tab view stays in front, with
// one tab per url, in order.
async function openWindow(worker: Worker, urls: string[]): Promise<MadeWindow> {
  const made = await worker.evaluate(async (urls: string[]) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    const tabIds = (win?.tabs ?? []).flatMap((tab) =>
      tab.id === undefined ? [] : [tab.id]
    );
    if (win?.id === undefined || tabIds.length !== urls.length) return null;
    return { windowId: win.id, tabIds };
  }, urls);
  if (made === null) throw new Error('Chrome gave no window or tab ids');
  return made;
}

// Pins tabs in the given order; Chrome puts each at the end of the pinned
// run, so pinning the window's first tabs in order keeps their order.
const pin = (worker: Worker, tabIds: number[]) =>
  worker.evaluate(async (ids: number[]) => {
    for (const id of ids) await chrome.tabs.update(id, { pinned: true });
  }, tabIds);

const setMuted = (worker: Worker, tabId: number, muted: boolean) =>
  worker.evaluate(
    async ({ id, muted }) => {
      await chrome.tabs.update(id, { muted });
    },
    { id: tabId, muted }
  );

test.describe('The pin mark (KAN-280 O11c)', () => {
  test("1. in Chrome's accessibility tree the pin is hidden, and the Switch button is described as Pinned, before the sound", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [
      dataUrl('Mail'),
      dataUrl('Radio'),
      dataUrl('Docs'),
    ]);
    const [mail, radio] = made.tabIds;
    await pin(serviceWorker, [mail, radio]);
    await setMuted(serviceWorker, radio, true);
    const block = windowBlock(page, made.windowId);
    await expect(pinIn(block, 'Mail')).toBeVisible();
    await expect(pinIn(block, 'Radio')).toBeVisible();
    await expect(speakerIn(block, 'Radio')).toBeVisible();

    // Chrome's own tree, not Playwright's role engine.
    const cdp = await context.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const live = nodes.filter((node) => !node.ignored);
    const text = (value: unknown) => String(value ?? '');
    const describedAs = (title: string) => {
      const found = live.filter(
        (node) =>
          node.role?.value === 'button' &&
          node.name?.value === `Switch to tab: ${title}`
      );
      expect(found).toHaveLength(1);
      return found[0].description?.value;
    };

    expect(describedAs('Mail')).toBe('Pinned');
    expect(describedAs('Radio')).toBe('Pinned Audio muted');
    expect(describedAs('Docs')).toBeUndefined();
    expect(
      live.filter((node) => /\bkeep\b/.test(text(node.name?.value)))
    ).toEqual([]);
    // CONTROL: the same search does find the pin's ligature text when it is
    // not hidden.
    await pinIn(block, 'Mail').evaluate((mark: Element) => {
      for (const hidden of mark.querySelectorAll('[aria-hidden="true"]')) {
        hidden.removeAttribute('aria-hidden');
      }
    });
    const after = await cdp.send('Accessibility.getFullAXTree');
    expect(
      after.nodes.filter(
        (node) => !node.ignored && /\bkeep\b/.test(text(node.name?.value))
      ).length
    ).toBeGreaterThan(0);
  });

  // The O10b slot at Chrome's Font size "Large", which sets the root to 20px
  // (KAN-312). The slot is Icon's box, ICON.DEFAULT (1.5rem) plus 4px a
  // side: 32px at 16px, 38px at 20px.
  const roots = [
    { rootPx: 16, slotPx: 32 },
    { rootPx: 20, slotPx: 38 },
  ];
  for (const { rootPx, slotPx } of roots) {
    test(`2. at a ${rootPx}px root the pin meets × on its left, or the speaker when both show, × keeps its column, and a long title stops before the marks, in rows as tall as one without`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await openPage(context, extensionId);
      await page.evaluate((px: number) => {
        document.documentElement.style.fontSize = `${px}px`;
      }, rootPx);
      // PREMISE: the root really is that size.
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize
        )
      ).toBe(`${rootPx}px`);

      const long =
        'A pinned tab with a title long enough to run past its pin in any ' +
        'Open now pane this spec opens, and then some, and then some more';
      const made = await openWindow(serviceWorker, [
        dataUrl(long),
        dataUrl('Radio'),
        dataUrl('Quiet'),
      ]);
      const [pinned, both, quiet] = made.tabIds;
      await pin(serviceWorker, [pinned, both]);
      await setMuted(serviceWorker, both, true);
      const block = windowBlock(page, made.windowId);
      await expect(pinIn(block, long)).toBeVisible();
      await expect(speakerIn(block, long)).toHaveCount(0);
      await expect(pinIn(block, 'Radio')).toBeVisible();
      await expect(speakerIn(block, 'Radio')).toBeVisible();
      await expect(pinIn(block, 'Quiet')).toHaveCount(0);
      await liveRowIn(block, long).hover();

      const measure = () =>
        page.evaluate(
          ({ pinned, both, quiet, long }) => {
            const box = (el: Element | null | undefined) => {
              if (!el) return null;
              const { left, right, width } = el.getBoundingClientRect();
              return { left, right, width };
            };
            const row = (id: number) =>
              document.querySelector(`[data-open-tab-id="${id}"]`);
            const height = (id: number) =>
              row(id)?.getBoundingClientRect().height ?? null;
            const titleText = [
              ...(row(pinned)?.querySelectorAll('span') ?? []),
            ].find((span) => span.textContent === long);
            return {
              pin: box(row(pinned)?.querySelector('[data-pin] > *')),
              close: box(row(pinned)?.querySelector('[data-close-tab] > *')),
              bothPin: box(row(both)?.querySelector('[data-pin] > *')),
              bothSpeaker: box(row(both)?.querySelector('[data-speaker] > *')),
              bothClose: box(row(both)?.querySelector('[data-close-tab] > *')),
              quietClose: box(
                row(quiet)?.querySelector('[data-close-tab] > *')
              ),
              pinnedHeight: height(pinned),
              bothHeight: height(both),
              quietHeight: height(quiet),
              title: box(titleText),
              ellipsized:
                titleText !== undefined &&
                titleText.scrollWidth > titleText.clientWidth,
            };
          },
          { pinned, both, quiet, long }
        );

      await expect(async () => {
        const m = await measure();
        if (
          !m.pin ||
          !m.close ||
          !m.bothPin ||
          !m.bothSpeaker ||
          !m.bothClose ||
          !m.quietClose ||
          !m.title ||
          m.pinnedHeight === null ||
          m.bothHeight === null ||
          m.quietHeight === null
        ) {
          throw new Error('a row is missing a part');
        }
        // PREMISE: the title is long enough to be cut.
        expect(m.ellipsized).toBe(true);
        // Alone, the pin takes the speaker's slot, right against ×.
        expect(Math.abs(m.pin.right - m.close.left)).toBeLessThanOrEqual(0.5);
        // With sound, pin first: pin, then speaker, then ×.
        expect(
          Math.abs(m.bothPin.right - m.bothSpeaker.left)
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(m.bothSpeaker.right - m.bothClose.left)
        ).toBeLessThanOrEqual(0.5);
        // × keeps its column on every row.
        for (const close of [m.close, m.bothClose]) {
          expect(
            Math.abs(close.right - m.quietClose.right)
          ).toBeLessThanOrEqual(0.5);
        }
        expect(m.title.right).toBeLessThanOrEqual(m.pin.left);
        for (const mark of [m.pin, m.bothPin, m.bothSpeaker, m.close]) {
          expect(Math.abs(mark.width - slotPx)).toBeLessThanOrEqual(0.5);
        }
        expect(
          Math.abs(m.pinnedHeight - m.quietHeight),
          `row heights: ${m.pinnedHeight} pinned, ${m.quietHeight} not`
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(m.bothHeight - m.quietHeight),
          `row heights: ${m.bothHeight} pinned with sound, ${m.quietHeight} not`
        ).toBeLessThanOrEqual(0.5);
      }).toPass({ timeout: 5000 });
    });
  }
});

// KAN-280 O11c, D F N (settled 2026-09-28): a 1px DIVIDER_COLOR line over
// the last pinned row's bottom pixel, from the favicon's left edge to the
// row's end, on top of the hover shade, and none in a window whose tabs are
// all pinned. The default theme is Paper (LIGHT_THEME). Pixels, not only the
// computed style: a line can be styled and still be painted over.
test.describe('The pinned line (KAN-280 O11c, D F N)', () => {
  const roots = [16, 20];
  for (const rootPx of roots) {
    test(`3. at a ${rootPx}px root the line is on the last pinned row only, in the divider colour, from the favicon to the row's end, over the hover shade, and adds no height`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await openPage(context, extensionId);
      await page.evaluate((px: number) => {
        document.documentElement.style.fontSize = `${px}px`;
      }, rootPx);
      // PREMISE: the root really is that size.
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize
        )
      ).toBe(`${rootPx}px`);

      const made = await openWindow(serviceWorker, [
        dataUrl('Mail'),
        dataUrl('Cal'),
        dataUrl('Docs'),
        dataUrl('News'),
      ]);
      const [mail, cal, docs] = made.tabIds;
      await pin(serviceWorker, [mail, cal]);
      const allPinned = await openWindow(serviceWorker, [
        dataUrl('Chat'),
        dataUrl('Music'),
      ]);
      await pin(serviceWorker, allPinned.tabIds);
      const block = windowBlock(page, made.windowId);
      const allPinnedBlock = windowBlock(page, allPinned.windowId);
      await expect(pinIn(block, 'Cal')).toBeVisible();
      await expect(pinIn(allPinnedBlock, 'Music')).toBeVisible();

      // Only the last pinned row of the mixed window carries the line.
      const boundaries = (windowId: number) =>
        page.evaluate(
          (windowId: number) =>
            [
              ...document.querySelectorAll(
                `[data-open-window-id="${windowId}"] [data-pinned-boundary]`
              ),
            ].map((row) => Number(row.getAttribute('data-open-tab-id'))),
          windowId
        );
      expect(await boundaries(made.windowId)).toEqual([cal]);
      expect(await boundaries(allPinned.windowId)).toEqual([]);

      const measure = () =>
        page.evaluate(
          ({ cal, docs }) => {
            const row = (id: number) =>
              document.querySelector(`[data-open-tab-id="${id}"]`);
            const calRow = row(cal);
            const docsRow = row(docs);
            // The favicon's box: an <img>, or the globe glyph drawn in its
            // place when the page has none (these data: tabs), the first
            // child of the row's first Icon.
            const favicon = calRow?.querySelector(
              'button > div:first-child > *'
            );
            if (!calRow || !docsRow || !favicon) return null;
            const line = getComputedStyle(calRow, '::after');
            const rowBox = calRow.getBoundingClientRect();
            return {
              lineContent: line.content,
              lineColor: line.backgroundColor,
              lineLeft: rowBox.left + parseFloat(line.left),
              lineRight: rowBox.right - parseFloat(line.right),
              lineTop:
                rowBox.bottom -
                parseFloat(line.bottom) -
                parseFloat(line.height),
              lineHeight: parseFloat(line.height),
              faviconLeft: favicon.getBoundingClientRect().left,
              rowLeft: rowBox.left,
              rowRight: rowBox.right,
              rowTop: rowBox.top,
              rowBottom: rowBox.bottom,
              calHeight: rowBox.height,
              docsHeight: docsRow.getBoundingClientRect().height,
              docsLine: getComputedStyle(docsRow, '::after').content,
            };
          },
          { cal, docs }
        );

      const at = await measure();
      if (at === null) throw new Error('a row is missing a part');
      // The token, in the computed style.
      expect(at.lineContent).not.toBe('none');
      expect(rgbToHex(at.lineColor)).toBe(LIGHT_THEME.DIVIDER_COLOR);
      expect(at.docsLine).toBe('none');
      // Its extent: favicon's left edge to the row's end, the bottom pixel.
      expect(Math.abs(at.lineLeft - at.faviconLeft)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(at.lineRight - at.rowRight)).toBeLessThanOrEqual(0.5);
      expect(at.lineHeight).toBe(1);
      expect(Math.abs(at.lineTop - (at.rowBottom - 1))).toBeLessThanOrEqual(
        0.5
      );
      // It adds no height: the pinned row with the line is as tall as an
      // unpinned row without one.
      expect(
        Math.abs(at.calHeight - at.docsHeight),
        `row heights: ${at.calHeight} with the line, ${at.docsHeight} without`
      ).toBeLessThanOrEqual(0.5);

      // Painted, hovered: the line wins over the row's hover shade AND over
      // the × strip's shade at the row's right end.
      await liveRowIn(block, 'Cal').hover();
      await expect(closeTabIn(block, 'Cal')).toBeVisible();
      await expect(async () => {
        // The row's bottom pixel. pixelsAt rounds, so an integer, not a
        // pixel centre: at.rowBottom - 0.5 would round onto the next row.
        const y = Math.ceil(at.rowBottom) - 1;
        const [aboveLine, beforeFavicon, mid, rightEnd] = await pixelsAt(page, [
          [(at.rowLeft + at.rowRight) / 2, at.rowBottom - 4],
          [at.faviconLeft - 2, y],
          [(at.rowLeft + at.rowRight) / 2, y],
          [at.rowRight - 3, y],
        ]);
        // CONTROL: the decode is faithful; the hover shade is where expected.
        expect(aboveLine).toBe(LIGHT_THEME.HOVER_COLOR);
        // Left of the favicon, the bottom pixel is the hover shade: the line
        // starts at the favicon.
        expect(beforeFavicon).toBe(LIGHT_THEME.HOVER_COLOR);
        expect(mid).toBe(LIGHT_THEME.DIVIDER_COLOR);
        expect(rightEnd).toBe(LIGHT_THEME.DIVIDER_COLOR);
      }).toPass({ timeout: 5000 });
    });
  }
});
