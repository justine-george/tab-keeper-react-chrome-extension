import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';

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
