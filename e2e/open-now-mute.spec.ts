import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';

// KAN-280 O10a on the real artifact: the speaker in Open now's tab rows.
// What jsdom cannot show: Chrome reporting a tab's sound and mute, a click
// muting the real tab, the speaker held under a real pointer (rule 4A), a
// held Enter's real repeats (O7b), the × strip's :focus-visible reveal (O7d),
// the accessibility tree, and the slot's geometry at Chrome's font sizes.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';

const MUTE_TAB = localeStrings('en')['Mute tab'];

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

const speakerIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `${MUTE_TAB}: ${title}`, exact: true });

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

// The glyph the speaker shows: the text of whichever of its two faces is
// drawn (Button's secondFace crossfade), or null mid-fade.
const shownFace = (speaker: Locator): Promise<string | null> =>
  speaker.evaluate((button: Element) => {
    const faces = button.querySelectorAll(':scope > span > span');
    for (const face of faces) {
      if (getComputedStyle(face).opacity === '1') return face.textContent;
    }
    return null;
  });

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

test.describe('Mute with the sound on (KAN-280 O10a)', () => {
  test.use({ audibleTabs: true });

  test('1. a playing tab shows volume_up, and a click mutes and unmutes the real tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openSoundingWindow(context, serviceWorker);
    const [tone] = made.tabIds;
    const block = windowBlock(page, made.windowId);
    const speaker = speakerIn(block, SOUND_TITLE);

    await expect(speaker).toBeVisible();
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => shownFace(speaker)).toBe('volume_up');

    await speaker.click();
    await expect
      .poll(async () => (await soundOf(serviceWorker, tone)).mutedInfo)
      .toEqual({ muted: true, reason: 'extension', extensionId });
    await expect(speaker).toHaveAttribute('aria-pressed', 'true');
    await expect(speaker).toHaveAttribute('data-second-face-shown', 'true');
    await expect.poll(() => shownFace(speaker)).toBe('volume_off');
    // Muting does not stop the sound: Chrome still reports it playing.
    expect((await soundOf(serviceWorker, tone)).audible).toBe(true);

    await speaker.click();
    await expect
      .poll(async () => (await soundOf(serviceWorker, tone)).mutedInfo)
      .toEqual({ muted: false, reason: 'extension', extensionId });
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => shownFace(speaker)).toBe('volume_up');

    // Still playing, so the speaker stays with the pointer gone.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await expect(speaker).toBeVisible();
  });
});

// Everything here needs only a mute, which Chrome records with the sound
// off, so it runs in the same silent browser as every other spec.
test.describe('Mute without sound (KAN-280 O10a)', () => {
  test('2. in the real accessibility tree the speaker is a pressed button of its own, named for its tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [dataUrl('Quiet')]);
    const block = windowBlock(page, made.windowId);
    await setMuted(serviceWorker, made.tabIds[0], true);
    await expect(speakerIn(block, 'Quiet')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Chrome's own tree, not Playwright's role engine.
    const cdp = await context.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const named = (name: string) =>
      nodes.filter(
        (node) =>
          !node.ignored &&
          node.role?.value === 'button' &&
          node.name?.value === name
      );
    // The buttons above a node, nearest first.
    const buttonsAbove = (nodeId: string): string[] => {
      const above: string[] = [];
      for (
        let id = byId.get(nodeId)?.parentId;
        id !== undefined;
        id = byId.get(id)?.parentId
      ) {
        const parent = byId.get(id);
        if (parent?.role?.value === 'button') {
          above.push(String(parent.name?.value ?? ''));
        }
      }
      return above;
    };

    const speakers = named(`${MUTE_TAB}: Quiet`);
    expect(speakers).toHaveLength(1);
    const [speaker] = speakers;
    const pressed = speaker.properties?.find((p) => p.name === 'pressed');
    expect(pressed?.value.value).toBe('true');
    expect(buttonsAbove(speaker.nodeId)).toEqual([]);

    // CONTROL: the walk sees a button above a node inside one. The row's
    // title text sits inside its Switch button.
    const switches = named('Switch to tab: Quiet');
    expect(switches).toHaveLength(1);
    const title = nodes.find(
      (node) =>
        node.role?.value === 'StaticText' &&
        node.name?.value === 'Quiet' &&
        buttonsAbove(node.nodeId).length > 0
    );
    expect(title && buttonsAbove(title.nodeId)).toEqual([
      'Switch to tab: Quiet',
    ]);
  });

  // KAN-280 O10a (1B), and Chrome's Font size "Large", which sets the root
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
      await expect(speakerIn(block, long)).toBeVisible();
      await expect(speakerIn(block, 'Quiet')).toHaveCount(0);
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
              speaker: box(loudRow?.querySelector('[data-speaker] button')),
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
        // The speaker is the one new in-flow part of a row, and it must not
        // make its row taller than a row without one ("Rows look like saved
        // rows").
        expect(
          Math.abs(loudRowHeight - quietRowHeight),
          `row heights: ${loudRowHeight} with a speaker, ${quietRowHeight} without`
        ).toBeLessThanOrEqual(0.5);
      }).toPass({ timeout: 5000 });
    });
  }

  test('4. a muted silent tab: a click unmutes it, the speaker stays under the pointer, and goes when the pointer leaves', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [dataUrl('Quiet')]);
    const [quiet] = made.tabIds;
    const block = windowBlock(page, made.windowId);
    const speaker = speakerIn(block, 'Quiet');
    await expect(liveRowIn(block, 'Quiet')).toBeVisible();
    // PREMISE: a silent, unmuted tab has no speaker.
    await expect(speaker).toHaveCount(0);

    await setMuted(serviceWorker, quiet, true);
    await expect(speaker).toHaveAttribute('aria-pressed', 'true');

    // Counts every speaker the page removes, so a speaker that goes and
    // comes back between two reads is still seen.
    await page.evaluate(() => {
      document.documentElement.dataset.speakersRemoved = '0';
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (
              node instanceof Element &&
              (node.matches('[data-speaker]') ||
                node.querySelector('[data-speaker]') !== null)
            ) {
              const seen = Number(
                document.documentElement.dataset.speakersRemoved
              );
              document.documentElement.dataset.speakersRemoved = String(
                seen + 1
              );
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    const speakersRemoved = () =>
      page.evaluate(() =>
        Number(document.documentElement.dataset.speakersRemoved)
      );

    await speaker.click();
    await expect.poll(() => isMuted(serviceWorker, quiet)).toBe(false);
    // The pane has read the unmute, and the speaker is still there.
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => shownFace(speaker)).toBe('volume_up');
    expect(await speakersRemoved()).toBe(0);

    await page.mouse.move(0, 0);
    await expect(speaker).toHaveCount(0);
    // CONTROL: the counter sees a speaker go.
    expect(await speakersRemoved()).toBe(1);
  });

  test('5. a held Enter on the speaker toggles the mute once', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [dataUrl('Quiet')]);
    const [quiet] = made.tabIds;
    const block = windowBlock(page, made.windowId);
    const speaker = speakerIn(block, 'Quiet');
    await setMuted(serviceWorker, quiet, true);
    await expect(speaker).toHaveAttribute('aria-pressed', 'true');

    await page.evaluate(() => {
      const seen: { key: string; repeat: boolean }[] = [];
      document.documentElement.dataset.keysSeen = '[]';
      window.addEventListener(
        'keydown',
        (event) => {
          seen.push({ key: event.key, repeat: event.repeat });
          document.documentElement.dataset.keysSeen = JSON.stringify(seen);
        },
        { capture: true }
      );
    });
    const keysSeen = async (): Promise<unknown> =>
      JSON.parse(
        await page.evaluate(
          () => document.documentElement.dataset.keysSeen ?? ''
        )
      );

    await speaker.focus();
    // Playwright does not auto-repeat, but a second down before the up is
    // sent with repeat: true.
    await page.keyboard.down('Enter');
    await expect.poll(() => isMuted(serviceWorker, quiet)).toBe(false);
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');
    await expect(speaker).toBeFocused();
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    // CONTROL: the second down reached the page as a repeat.
    expect(await keysSeen()).toEqual([
      { key: 'Enter', repeat: false },
      { key: 'Enter', repeat: true },
    ]);
    // Give a wrongly-handled repeat time to mute it again, then: one toggle.
    await page.waitForTimeout(300);
    expect(await isMuted(serviceWorker, quiet)).toBe(false);
    await expect(speaker).toHaveAttribute('aria-pressed', 'false');
  });

  test('6. keyboard focus on the speaker does not reveal ×; on × it does', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const made = await openWindow(serviceWorker, [dataUrl('Quiet')]);
    const block = windowBlock(page, made.windowId);
    const speaker = speakerIn(block, 'Quiet');
    const close = closeTabIn(block, 'Quiet');
    await setMuted(serviceWorker, made.tabIds[0], true);
    await expect(speaker).toBeVisible();
    await page.mouse.move(0, 0);
    const closeOpacity = () =>
      close.evaluate((el: Element) => getComputedStyle(el).opacity);

    await liveRowIn(block, 'Quiet').focus();
    await page.keyboard.press('Tab');
    await expect(speaker).toBeFocused();
    expect(await speaker.evaluate((el) => el.matches(':focus-visible'))).toBe(
      true
    );
    // Past the strip's fade (DURATION.COLOR, 120ms), so a reveal would have
    // finished.
    await page.waitForTimeout(400);
    expect(await closeOpacity()).toBe('0');

    // CONTROL: the same read sees × revealed once it has the focus.
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await expect.poll(closeOpacity).toBe('1');
  });
});
