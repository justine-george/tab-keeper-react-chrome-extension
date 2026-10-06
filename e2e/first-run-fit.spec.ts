import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { RUN_FINISHED, buildContainer, buildSession } from './fixtures/seed';
import {
  THEMES,
  openPopup,
  openTabGroup,
  pageGround,
  twoFrames,
} from './fixtures/onboarding';
import { expectReadable, textContrasts } from './fixtures/textContrast';
import { contrast, rgbToHex } from './fixtures/pixels';
import { localeStrings } from './fixtures/locales';
import { pairFit } from './fixtures/pairFit';
import {
  FULL_AT_HELLO,
  FULL_RUN,
  POPUP_RUN,
  card,
  cardAt,
  centreOf,
  hello,
  nextTo,
  seedRawSettingsIfAbsent,
  seedSessionsIfAbsent,
  startRunFromHelp,
  type RunViewCase,
} from './fixtures/run';
import type { ThemeColors } from '../src/hooks/useThemeColors';

// §14 on the real build: every card and dialog of the first run fits in every locale at a 24px root, and reads in every theme.

test.use({ freshProfile: true });

const LANGS = [
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
const ROOT_PX = 24;
const SETTLED = {
  cloudConsent: 'declined',
  isAutoSync: false,
  isWhatsNew2Seen: true,
  setupState: 'done',
  hasOpenedFullView: true,
  isPinGuideDismissed: true,
  isFullViewCalloutSeen: true,
};
const welcome = (page: Page) =>
  page.locator('dialog[open][aria-labelledby="cloud-consent-title"]');
const setupDialog = (page: Page) =>
  page.locator('dialog[open][aria-labelledby="setup-title"]');

// Before the app's first render, as Chrome's font-size setting would be.
async function rootAt(context: BrowserContext, px: number) {
  await context.addInitScript((size: number) => {
    if (window.top !== window) return;
    const apply = () => {
      const root = document.documentElement;
      if (root === null) return false;
      root.style.fontSize = `${size}px`;
      return true;
    };
    if (!apply()) {
      new MutationObserver((_, observer) => {
        if (apply()) observer.disconnect();
      }).observe(document, { childList: true });
    }
  }, px);
}

// A page of the run's view, in whatever language is on screen.
async function openIn(
  context: BrowserContext,
  extensionId: string,
  view: RunViewCase
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(view.viewport);
  await page.goto(`chrome-extension://${extensionId}/${view.path}`);
  // Not the English "Sort sessions" label openPage waits for.
  await page.locator('[data-pane="sessions"]').waitFor();
  return page;
}

const expectRootTook = async (page: Page) =>
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize
    ),
    'CONTROL: the root size took'
  ).toBe(`${ROOT_PX}px`);

// Its entrance, glide and loop over: the end state is what has to fit.
const settle = (root: Locator) =>
  expect
    .poll(() =>
      root.evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === 'running').length
      )
    )
    .toBe(0);

// Inside the window; no element or line of text wider than the root or out of its own box; no sideways scroll.
async function expectFits(root: Locator, label: string) {
  await settle(root);
  const fit = await root.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const out = (b: DOMRect, box: DOMRect) =>
      b.left < box.left - 0.5 || b.right > box.right + 0.5;
    const spills: string[] = [];
    // The notch is drawn outside the card on purpose; icons are glyphs, not words.
    const skip = (node: Element) =>
      node.closest('[aria-hidden="true"], .material-symbols-outlined') !== null;
    for (const child of el.querySelectorAll('*')) {
      if (skip(child)) continue;
      const c = child.getBoundingClientRect();
      if (c.width > 0 && out(c, r)) {
        spills.push(`<${child.tagName.toLowerCase()}> ${child.textContent}`);
      }
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const parent = n.parentElement;
      const text = (n.textContent ?? '').trim();
      if (parent === null || text === '' || skip(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const own = parent.getBoundingClientRect();
      for (const line of range.getClientRects()) {
        if (line.width > 0 && (out(line, r) || out(line, own))) {
          spills.push(`"${text}"`);
          break;
        }
      }
    }
    return {
      inside:
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight,
      spills,
      // Only a root that clips or scrolls can hide what is wider than it.
      wide:
        getComputedStyle(el).overflowX !== 'visible' &&
        el.scrollWidth > el.clientWidth,
    };
  });
  expect(fit, label).toEqual({ inside: true, spills: [], wide: false });
}

const press = (root: Locator, name: string) =>
  root.getByRole('button', { name, exact: true }).click();

// The words of a {{icon}} sentence before its glyph, enough to know which card shows.
const lead = (sentence: string) => sentence.split('{{icon}}')[0].trim();

const saveStep = (view: RunViewCase) => (view.view === 'popup' ? 1 : 3);

for (const lang of LANGS) {
  const say = (key: string) => localeStrings(lang)[key] ?? key;

  test.describe(`${lang} at a ${ROOT_PX}px root`, () => {
    test.beforeEach(async ({ context }) => {
      await rootAt(context, ROOT_PX);
    });

    for (const view of [POPUP_RUN, FULL_RUN]) {
      test(`${view.name}: Hello, every card, and the save card after a save fit; footers wrap inside`, async ({
        context,
        extensionId,
      }) => {
        // Help starts at card 1, so the full view's Hello comes from a run recorded at step 0.
        await seedRawSettingsIfAbsent(context, {
          ...SETTLED,
          language: lang,
          ...(view.view === 'full' ? { firstRun: FULL_AT_HELLO } : {}),
        });
        const page = await openIn(context, extensionId, view);
        await expectRootTook(page);
        if (view.view === 'full') {
          await expect(hello(page)).toBeVisible();
          await expectFits(hello(page), `${lang} ${view.name} Hello`);
          await press(hello(page), say('Start'));
        } else {
          await startRunFromHelp(page, say);
        }
        for (let step = 1; step <= view.total; step++) {
          await expect(cardAt(page, step)).toBeVisible();
          await expectFits(card(page), `${lang} ${view.name} step ${step}`);
          if (step === view.total) break;
          if (step !== saveStep(view)) {
            await press(card(page), say('Next'));
            continue;
          }
          // The run's own save, then Back: the save card says it saved (M4 A+).
          await page.locator('[data-tour-anchor="save"] input').press('Enter');
          await expect(cardAt(page, step + 1)).toBeVisible();
          await press(card(page), say('Back'));
          await expect(card(page)).toContainText(
            lead(
              say('Saved. Press {{icon}} any time to save your windows again.')
            )
          );
          await expectFits(card(page), `${lang} ${view.name} saved line`);
          await press(card(page), say('Next'));
        }
      });

      test(`${view.name}: the only-Tab-Keeper save card and the example line fit`, async ({
        context,
        extensionId,
      }) => {
        await seedRawSettingsIfAbsent(context, { ...SETTLED, language: lang });
        const page = await openIn(context, extensionId, view);
        await expectRootTook(page);
        for (const other of context.pages()) {
          if (other !== page) await other.close();
        }
        await startRunFromHelp(page, say);
        for (let step = 1; step < saveStep(view); step++) {
          await press(card(page), say('Next'));
          await expect(cardAt(page, step + 1)).toBeVisible();
        }
        await expect(card(page)).toContainText(
          lead(
            say(
              "This is where you save your open windows as a session: press {{icon}}. Only Tab Keeper is open right now, so let's try it with an example."
            )
          )
        );
        await expectFits(card(page), `${lang} ${view.name} Q3 card`);
        await press(card(page), say('Use an example'));
        await expect(cardAt(page, saveStep(view) + 1)).toBeVisible();
        await press(card(page), say('Back'));
        await expect(card(page)).toContainText(
          lead(
            say(
              'This is an example. Press {{icon}} any time to save your own windows.'
            )
          )
        );
        await expectFits(card(page), `${lang} ${view.name} example line`);
      });
    }

    test('full view: What’s new and the your-sessions card fit', async ({
      context,
      extensionId,
    }) => {
      await seedRawSettingsIfAbsent(context, {
        language: lang,
        cloudConsent: 'declined',
        isAutoSync: false,
        isPinGuideDismissed: true,
        isFullViewCalloutSeen: true,
      });
      await seedSessionsIfAbsent(
        context,
        buildContainer([buildSession({ tabGroupId: 'kept' })])
      );
      const page = await openIn(context, extensionId, FULL_RUN);
      await expectRootTook(page);
      await expect(hello(page)).toContainText(
        say("What's new in Tab Keeper 2.0")
      );
      await expectFits(hello(page), `${lang} What's new`);
      await press(hello(page), say('Start'));
      for (let step = 2; step <= 3; step++) {
        await press(card(page), say('Next'));
        await expect(cardAt(page, step)).toBeVisible();
      }
      await expect(card(page)).toContainText(
        say('Your saved sessions are all here, just as you left them.')
      );
      await expectFits(card(page), `${lang} your-sessions card`);
    });

    test('the welcome fits', async ({ context, extensionId }) => {
      await seedRawSettingsIfAbsent(context, { language: lang });
      const page = await openIn(context, extensionId, POPUP_RUN);
      await expectRootTook(page);
      await expect(welcome(page)).toBeVisible();
      await expect(welcome(page)).toContainText(
        say('Get started opens Tab Keeper in its own tab.')
      );
      await expectFits(welcome(page), `${lang} welcome`);
    });

    test('setup’s six steps fit, the switches of steps 5 and 6 included', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await openTabGroup(serviceWorker);
      await seedRawSettingsIfAbsent(context, {
        ...SETTLED,
        setupState: 'pending',
        language: lang,
        firstRun: RUN_FINISHED,
      });
      const page = await openIn(context, extensionId, FULL_RUN);
      await expectRootTook(page);
      const dialog = setupDialog(page);
      await expect(dialog.getByRole('progressbar')).toHaveAttribute(
        'aria-valuemax',
        '6'
      );
      for (let step = 1; step <= 6; step++) {
        await expect(dialog.getByRole('progressbar')).toHaveAttribute(
          'aria-valuenow',
          String(step)
        );
        await expectFits(dialog, `${lang} setup step ${step}`);
        if (step >= 5) {
          // The Off/On words sit inside their track, which grows only as they need (M5).
          const pair = dialog.getByRole('group');
          await expect(pair).toHaveCount(1);
          for (const word of [say('Off'), say('On')]) {
            const fit = await pairFit(pair, word);
            const label = `${lang} setup step ${step} ${word}`;
            expect(fit.clearTop, label).toBeGreaterThanOrEqual(0);
            expect(fit.clearBottom, label).toBeGreaterThanOrEqual(0);
          }
        }
        if (step < 6) await press(dialog, say('Next'));
      }
    });
  });
}

// The footers' wrap under stress: the longest words in a window too narrow for one row of buttons.
// How far the second button sits below the first's bottom edge: on a row of its own when it is not negative.
async function secondRowGap(dialog: Locator, first: string, second: string) {
  const box = (name: string) =>
    dialog
      .getByRole('button', { name, exact: true })
      .evaluate((el) => el.getBoundingClientRect().toJSON());
  const [above, below] = await Promise.all([box(first), box(second)]);
  return below.top - above.bottom;
}

// For each locale, a popup narrow enough that its two welcome buttons cannot share a row.
for (const [lang, welcomeWidth] of [
  ['de', 360],
  ['ru', 360],
  ['hi', 280],
] as const) {
  const say = (key: string) => localeStrings(lang)[key] ?? key;

  test.describe(`${lang}, narrow, at a ${ROOT_PX}px root`, () => {
    test.beforeEach(async ({ context }) => {
      await rootAt(context, ROOT_PX);
    });

    test('the welcome’s buttons wrap onto two rows and still fit', async ({
      context,
      extensionId,
    }) => {
      await seedRawSettingsIfAbsent(context, { language: lang });
      const page = await openIn(context, extensionId, {
        ...POPUP_RUN,
        viewport: { width: welcomeWidth, height: 900 },
      });
      await expect(welcome(page)).toBeVisible();
      await expectFits(welcome(page), `${lang} narrow welcome`);
      // CONTROL: this width does make them wrap.
      expect(
        await secondRowGap(welcome(page), say('Not now'), say('Get started'))
      ).toBeGreaterThanOrEqual(0);
    });

    test('Hello’s buttons wrap onto two rows and still fit', async ({
      context,
      extensionId,
    }) => {
      await seedRawSettingsIfAbsent(context, {
        ...SETTLED,
        language: lang,
        firstRun: FULL_AT_HELLO,
      });
      const page = await openIn(context, extensionId, {
        ...FULL_RUN,
        viewport: { width: 360, height: 800 },
      });
      await expect(hello(page)).toBeVisible();
      await expectFits(hello(page), `${lang} narrow Hello`);
      // CONTROL: this width does make them wrap.
      expect(
        await secondRowGap(hello(page), say('Skip tutorial'), say('Start'))
      ).toBeGreaterThanOrEqual(0);
    });
  });
}

// The filled button at rest, hovered and held, each read once its fill settles; the hold ends in a click.
async function expectFilledReads(
  page: Page,
  button: Locator,
  palette: ThemeColors,
  label: string
) {
  const fill = () =>
    button
      .evaluate((el) => getComputedStyle(el).backgroundColor)
      .then(rgbToHex);
  const settled = () =>
    expect
      .poll(() => button.evaluate((el) => el.getAnimations().length))
      .toBe(0);
  await page.mouse.move(0, 0);
  // CONTROL: at rest it wears the filled look.
  await expect.poll(fill).toBe(palette.TEXT_COLOR);
  await expectReadable(button, `${label} at rest`);
  // Each rung must repaint, or a hover that never lands would pass as read.
  await button.hover();
  await expect.poll(fill).not.toBe(palette.TEXT_COLOR);
  await settled();
  const hovered = await fill();
  await expectReadable(button, `${label} hovered`);
  await page.mouse.move(...(await centreOf(button)));
  await page.mouse.down();
  await expect.poll(fill).not.toBe(hovered);
  await settled();
  await expectReadable(button, `${label} held`);
  await page.mouse.up();
}

// Every text run in the card reads, and the named lines were among those measured.
async function expectCardReads(
  page: Page,
  label: string,
  lines: string[] = []
) {
  await page.mouse.move(0, 0);
  await expect(() => expectReadable(card(page), label)).toPass();
  const measured = (await textContrasts(card(page))).map((r) => r.text);
  for (const line of lines) expect(measured, label).toContain(line);
}

async function expectLineReads(page: Page, label: string) {
  const [fill, track] = await card(page).evaluate((el) => [
    getComputedStyle(el.querySelector('[data-progress-fill]') ?? el)
      .backgroundColor,
    getComputedStyle(el.querySelector('[data-progress-line]') ?? el)
      .backgroundColor,
  ]);
  expect(
    contrast(rgbToHex(fill), rgbToHex(track)),
    `${label} progress fill on its track`
  ).toBeGreaterThanOrEqual(3);
}

const filled = (root: Locator, name: string) =>
  root.getByRole('button', { name, exact: true });

for (const [theme, palette] of THEMES) {
  test.describe(theme, () => {
    test('popup run: every card, its fine line, the example line, the progress line and the filled button at rest, hovered and held read', async ({
      context,
      extensionId,
    }) => {
      await seedRawSettingsIfAbsent(context, { ...SETTLED, theme });
      const page = await openIn(context, extensionId, POPUP_RUN);
      expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
      await startRunFromHelp(page);
      await expect(cardAt(page, 1)).toBeVisible();
      await expectCardReads(page, `${theme} popup save card`, [
        'Saving keeps them safe even after you close them.',
      ]);
      await expectLineReads(page, `${theme} popup`);
      // The hold ends in a click: Use an example.
      await expectFilledReads(
        page,
        filled(card(page), 'Use an example'),
        palette,
        `${theme} Use an example`
      );
      await expect(cardAt(page, 2)).toBeVisible();
      await press(card(page), 'Back');
      await expect(card(page)).toContainText('This is an example.');
      await expectCardReads(page, `${theme} popup example line`);
      await nextTo(page, 2);
      for (let step = 2; step <= 7; step++) {
        if (step > 2) await nextTo(page, step);
        await expectCardReads(page, `${theme} popup step ${step}`);
      }
    });

    test('full view run: Hello, every card, the saved line, the fine lines and Start at rest, hovered and held read', async ({
      context,
      extensionId,
    }) => {
      await seedRawSettingsIfAbsent(context, {
        ...SETTLED,
        theme,
        firstRun: FULL_AT_HELLO,
      });
      const page = await openIn(context, extensionId, FULL_RUN);
      expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
      await expect(hello(page)).toBeVisible();
      await settle(hello(page));
      await expectReadable(hello(page), `${theme} Hello`);
      // The hold ends in a click: Start.
      await expectFilledReads(
        page,
        filled(hello(page), 'Start'),
        palette,
        `${theme} Start`
      );
      for (let step = 1; step <= 8; step++) {
        if (step > 1 && step !== 4) await nextTo(page, step);
        await expect(cardAt(page, step)).toBeVisible();
        await expectCardReads(
          page,
          `${theme} full step ${step}`,
          step === 8 ? ['Undo any time: right-click the tab → Unpin.'] : []
        );
        if (step !== 3) continue;
        await expectLineReads(page, `${theme} full`);
        await page.locator('[data-tour-anchor="save"] input').press('Enter');
        await expect(cardAt(page, 4)).toBeVisible();
        await press(card(page), 'Back');
        await expect(card(page)).toContainText('Saved.');
        await expectCardReads(page, `${theme} full saved line`);
        await nextTo(page, 4);
      }
    });

    test('the welcome’s filled Get started reads at rest, hovered and held', async ({
      context,
      extensionId,
    }) => {
      await seedRawSettingsIfAbsent(context, { theme });
      const page = await openPopup(context, extensionId);
      expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
      await expect(welcome(page)).toBeVisible();
      await settle(welcome(page));
      // The hold ends in a click: Get started.
      await expectFilledReads(
        page,
        filled(welcome(page), 'Get started'),
        palette,
        `${theme} Get started`
      );
    });
  });
}

// Every Web Animation started on the run's card, ring or Hello from document start, as part and duration.
async function watchRunMotion(context: BrowserContext) {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const seen: string[] = [];
    Object.defineProperty(window, '__runMotion', { value: seen });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, keyframes, options) {
      const part = this.hasAttribute('data-coach-mark')
        ? 'card'
        : this.hasAttribute('data-coach-ring')
          ? 'ring'
          : this.hasAttribute('data-run-hello')
            ? 'hello'
            : null;
      const duration =
        typeof options === 'number' ? options : options?.duration;
      if (part !== null) seen.push(`${part} ${String(duration)}`);
      return animate.call(this, keyframes, options);
    };
  });
}

// Read after the caller's barrier and two frames.
async function runMotion(page: Page): Promise<string[]> {
  await twoFrames(page);
  return page.evaluate(() => {
    const seen: unknown = Reflect.get(window, '__runMotion');
    return Array.isArray(seen) ? seen.map(String) : [];
  });
}

// Hello, the card's first appearance, one glide and the line's step, each read at its barrier.
async function walkMotion(
  context: BrowserContext,
  extensionId: string,
  reducedMotion: 'reduce' | 'no-preference'
) {
  await seedRawSettingsIfAbsent(context, {
    ...SETTLED,
    firstRun: FULL_AT_HELLO,
  });
  await watchRunMotion(context);
  // Emulated before the load: Hello shows as the page mounts.
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize(FULL_RUN.viewport);
  await page.goto(`chrome-extension://${extensionId}/${FULL_RUN.path}`);
  await expect(hello(page)).toBeVisible();
  const atHello = await runMotion(page);
  await press(hello(page), 'Start');
  await expect(cardAt(page, 1)).toBeVisible();
  await nextTo(page, 2);
  const line = await page
    .locator('[data-coach-mark] [data-progress-fill]')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  const end = await card(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return { transform: style.transform, opacity: style.opacity };
  });
  return { atHello, all: await runMotion(page), line, end };
}

test.describe('reduced motion', () => {
  test('Hello, the card’s appearance and its glide play no animation, the line has no transition, and the end state shows at once', async ({
    context,
    extensionId,
  }) => {
    const seen = await walkMotion(context, extensionId, 'reduce');
    expect(seen.atHello).toEqual([]);
    expect(seen.all).toEqual([]);
    expect(seen.line).toBe('0s');
    expect(seen.end).toEqual({ transform: 'none', opacity: '1' });
  });
});

test('CONTROL: with motion allowed, the same observer sees Hello enter, the card appear and glide with its ring, and the line ease', async ({
  context,
  extensionId,
}) => {
  const seen = await walkMotion(context, extensionId, 'no-preference');
  expect(seen.atHello).toEqual(['hello 220']);
  expect(seen.all).toEqual(
    expect.arrayContaining(['hello 220', 'card 200', 'ring 200'])
  );
  expect(seen.all.filter((m) => m === 'card 200').length).toBe(2);
  expect(seen.line).toBe('0.2s');
});
