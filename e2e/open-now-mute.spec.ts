import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';

// KAN-280 O10b on the real artifact: the speaker in Open now's tab rows shows
// a tab's sound, and Chrome does the muting (KAN-315: an extension's mute
// cannot be undone from Chrome's own controls, measured). What jsdom cannot
// show: Chrome reporting a tab's sound and mute, a real click on the glyph
// switching the real tab without touching its mute, Chrome's accessibility
// tree, and the slot's geometry at Chrome's font sizes. A mute "from Chrome"
// is staged with tabs.update in the worker: Playwright cannot drive Chrome's
// own tab strip.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';

// A page that plays a tone once its button is clicked. The click is what
// Chrome's autoplay policy needs, and page.click gives it one.
const SOUND_URL = 'https://sound.test/';
const SOUND_TITLE = 'Tone';
const SOUND_PAGE = `<title>${SOUND_TITLE}</title>
<button id="play" onclick="
  const audio = new AudioContext();
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.5;
  tone.connect(gain).connect(audio.destination);
  tone.start();
">Play</button>`;

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

// The glyph lives inside the tab's Switch button (O10b).
const glyphIn = (block: Locator, title: string): Locator =>
  liveRowIn(block, title).locator('[data-speaker]');

// The ligature the glyph draws: "volume_up" or "volume_off".
const glyphName = (glyph: Locator): Promise<string | null> =>
  glyph.locator('.material-symbols-outlined').textContent();

const closeTabIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Close tab: ${title}`, exact: true });

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

// What Chrome says about a tab's sound: whether it is playing, and its mute.
const soundOf = (worker: Worker, tabId: number) =>
  worker.evaluate(async (id: number) => {
    const tab = await chrome.tabs.get(id);
    return { audible: tab.audible ?? false, mutedInfo: tab.mutedInfo };
  }, tabId);

const isMuted = async (worker: Worker, tabId: number): Promise<boolean> =>
  (await soundOf(worker, tabId)).mutedInfo?.muted ?? false;

const setMuted = (worker: Worker, tabId: number, muted: boolean) =>
  worker.evaluate(
    async ({ id, muted }) => {
      await chrome.tabs.update(id, { muted });
    },
    { id: tabId, muted }
  );

// A window whose one tab plays a tone, returned once Chrome reports it
// playing.
async function openSoundingWindow(
  context: BrowserContext,
  worker: Worker
): Promise<MadeWindow> {
  await context.route(`${SOUND_URL}**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: SOUND_PAGE })
  );
  const made = await openWindow(worker, [SOUND_URL]);
  const soundPage = (): Page | undefined =>
    context.pages().find((page) => page.url() === SOUND_URL);
  await expect.poll(() => soundPage() !== undefined).toBe(true);
  const page = soundPage();
  if (page === undefined) throw new Error('the sounding tab has no page');
  await page.click('#play');
  await expect
    .poll(async () => (await soundOf(worker, made.tabIds[0])).audible, {
      message:
        'Chromium never reported the tab as playing sound (audible: true), ' +
        'so nothing here can test a playing tab. Launched with --mute-audio?',
    })
    .toBe(true);
  return made;
}

// Whether a tab is the one its window shows, and its window has the focus:
// what a switch does (O6).
const isShownAndFocused = (worker: Worker, tabId: number) =>
  worker.evaluate(async (id: number) => {
    const tab = await chrome.tabs.get(id);
    const win = await chrome.windows.get(tab.windowId);
    return tab.active && (win.focused ?? false);
  }, tabId);

// Puts a new tab in front of a window's others, so a switch back to them
// has work to do.
const coverWith = (worker: Worker, windowId: number, url: string) =>
  worker.evaluate(
    async ({ windowId, url }) => {
      await chrome.tabs.create({ windowId, url, active: true });
    },
    { windowId, url }
  );

test.describe('The speaker with the sound on (KAN-280 O10b)', () => {
  test.use({ audibleTabs: true });

  test('1. a playing tab shows volume_up, and a click on it switches to the tab and leaves its sound alone', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openSoundingWindow(context, serviceWorker);
    const [tone] = made.tabIds;
    await coverWith(serviceWorker, made.windowId, dataUrl('Cover'));
    const block = windowBlock(page, made.windowId);
    const glyph = glyphIn(block, SOUND_TITLE);

    await expect(glyph).toBeVisible();
    expect(await glyphName(glyph)).toBe('volume_up');
    await expect(liveRowIn(block, SOUND_TITLE)).toHaveAccessibleDescription(
      'Audio playing'
    );
    // PREMISE: the tone plays behind the cover, so the click has work to do.
    expect(await isShownAndFocused(serviceWorker, tone)).toBe(false);
    expect((await soundOf(serviceWorker, tone)).audible).toBe(true);

    await glyph.click();

    await expect.poll(() => isShownAndFocused(serviceWorker, tone)).toBe(true);
    // Never muted, and never touched: no extension reason on the tab.
    expect((await soundOf(serviceWorker, tone)).mutedInfo).toEqual({
      muted: false,
    });
    expect(page.isClosed()).toBe(false);
  });
});

// Everything here needs only a mute, which Chrome records with the sound
// off, so it runs in the same silent browser as every other spec.
test.describe('The speaker without sound (KAN-280 O10b)', () => {
  test("2. in Chrome's accessibility tree there is no mute button, the glyph is hidden, and the Switch button is described as muted", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [dataUrl('Quiet')]);
    const block = windowBlock(page, made.windowId);
    await setMuted(serviceWorker, made.tabIds[0], true);
    await expect(glyphIn(block, 'Quiet')).toBeVisible();

    // Chrome's own tree, not Playwright's role engine.
    const cdp = await context.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const live = nodes.filter((node) => !node.ignored);
    const text = (value: unknown) => String(value ?? '');

    expect(
      live.filter(
        (node) =>
          node.role?.value === 'button' && /mute/i.test(text(node.name?.value))
      )
    ).toEqual([]);
    expect(
      live.filter((node) => /volume_(up|off)/.test(text(node.name?.value)))
    ).toEqual([]);
    const switches = live.filter(
      (node) =>
        node.role?.value === 'button' &&
        node.name?.value === 'Switch to tab: Quiet'
    );
    expect(switches).toHaveLength(1);
    expect(switches[0].description?.value).toBe('Audio muted');
    // CONTROL: the same search does find the glyph's ligature text when it
    // is not hidden.
    await glyphIn(block, 'Quiet').evaluate((glyph: Element) => {
      for (const hidden of glyph.querySelectorAll('[aria-hidden="true"]')) {
        hidden.removeAttribute('aria-hidden');
      }
    });
    const after = await cdp.send('Accessibility.getFullAXTree');
    expect(
      after.nodes.filter(
        (node) => !node.ignored && /volume_off/.test(text(node.name?.value))
      ).length
    ).toBeGreaterThan(0);
  });
  // KAN-280 O10a (1B), kept by O10b, and Chrome's Font size "Large", which sets the root
  // to 20px (KAN-312). The slot is Icon's box, ICON.DEFAULT (1.5rem) plus
  // 4px a side: 32px at 16px, 38px at 20px.
  const roots = [
    { rootPx: 16, slotPx: 32 },
    { rootPx: 20, slotPx: 38 },
  ];
  for (const { rootPx, slotPx } of roots) {
    test(`3. at a ${rootPx}px root the speaker meets × on its left, × keeps its column, and a long title stops before the speaker, in a row as tall as one without`, async ({
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
        'A tab with a title long enough to run past the speaker in any ' +
        'Open now pane this spec opens, and then some, and then some more';
      const made = await openWindow(serviceWorker, [
        dataUrl(long),
        dataUrl('Quiet'),
      ]);
      const [loud, quiet] = made.tabIds;
      const block = windowBlock(page, made.windowId);
      await setMuted(serviceWorker, loud, true);
      await expect(glyphIn(block, long)).toBeVisible();
      await expect(glyphIn(block, 'Quiet')).toHaveCount(0);
      await liveRowIn(block, long).hover();

      const measure = () =>
        page.evaluate(
          ({ loud, quiet, long }) => {
            const box = (el: Element | null | undefined) => {
              if (!el) return null;
              const { left, right, width } = el.getBoundingClientRect();
              return { left, right, width };
            };
            const row = (id: number) =>
              document.querySelector(`[data-open-tab-id="${id}"]`);
            const loudRow = row(loud);
            const quietRow = row(quiet);
            const titleText = [
              ...(loudRow?.querySelectorAll('span') ?? []),
            ].find((span) => span.textContent === long);
            return {
              speaker: box(loudRow?.querySelector('[data-speaker] > *')),
              close: box(loudRow?.querySelector('[data-close-tab] > *')),
              quietClose: box(quietRow?.querySelector('[data-close-tab] > *')),
              loudRowHeight: loudRow?.getBoundingClientRect().height ?? null,
              quietRowHeight: quietRow?.getBoundingClientRect().height ?? null,
              title: box(titleText),
              ellipsized:
                titleText !== undefined &&
                titleText.scrollWidth > titleText.clientWidth,
            };
          },
          { loud, quiet, long }
        );

      await expect(async () => {
        const {
          speaker,
          close,
          quietClose,
          title,
          ellipsized,
          loudRowHeight,
          quietRowHeight,
        } = await measure();
        if (
          !speaker ||
          !close ||
          !quietClose ||
          !title ||
          loudRowHeight === null ||
          quietRowHeight === null
        ) {
          throw new Error('a row is missing a part');
        }
        // PREMISE: the title is long enough to be cut.
        expect(ellipsized).toBe(true);
        expect(Math.abs(speaker.right - close.left)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(close.right - quietClose.right)).toBeLessThanOrEqual(
          0.5
        );
        expect(title.right).toBeLessThanOrEqual(speaker.left);
        expect(Math.abs(speaker.width - slotPx)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(close.width - slotPx)).toBeLessThanOrEqual(0.5);
        // The glyph is the one extra in-flow part of a row, and it must not
        // make its row taller than a row without one ("Rows look like saved
        // rows").
        expect(
          Math.abs(loudRowHeight - quietRowHeight),
          `row heights: ${loudRowHeight} with a speaker, ${quietRowHeight} without`
        ).toBeLessThanOrEqual(0.5);
      }).toPass({ timeout: 5000 });
    });
  }

  test('4. a tab muted from outside shows volume_off; a click switches to it and it stays muted; an unmute from outside takes the glyph away under the pointer', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [dataUrl('Quiet')]);
    const [quiet] = made.tabIds;
    await coverWith(serviceWorker, made.windowId, dataUrl('Cover'));
    const block = windowBlock(page, made.windowId);
    const glyph = glyphIn(block, 'Quiet');
    await expect(liveRowIn(block, 'Quiet')).toBeVisible();
    // PREMISE: a silent, unmuted tab has no glyph.
    await expect(glyph).toHaveCount(0);

    await setMuted(serviceWorker, quiet, true);
    await expect(glyph).toBeVisible();
    expect(await glyphName(glyph)).toBe('volume_off');

    await glyph.click();
    await expect.poll(() => isShownAndFocused(serviceWorker, quiet)).toBe(true);
    expect(await isMuted(serviceWorker, quiet)).toBe(true);

    // The pointer is still on the glyph. Nothing holds it up (O10a's rule
    // 4A is gone with the control).
    await glyph.hover();
    await setMuted(serviceWorker, quiet, false);
    await expect(glyph).toHaveCount(0);
    await expect(liveRowIn(block, 'Quiet')).not.toHaveAttribute(
      'aria-describedby'
    );
  });

  test('5. the glyph is no tab stop: Tab goes from the Switch button to ×', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [dataUrl('Quiet')]);
    const block = windowBlock(page, made.windowId);
    await setMuted(serviceWorker, made.tabIds[0], true);
    await expect(glyphIn(block, 'Quiet')).toBeVisible();

    await liveRowIn(block, 'Quiet').focus();
    await page.keyboard.press('Tab');

    await expect(closeTabIn(block, 'Quiet')).toBeFocused();
  });
});
