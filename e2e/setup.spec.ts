import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import {
  FULL,
  FULL_VIEW_PATH,
  THEMES,
  openFullView,
  openPopup,
  pageGround,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';
import { setPin, stubToolbarPin } from './fixtures/toolbarPin';
import { expectReadable } from './fixtures/textContrast';
import { rgbToHex } from './fixtures/pixels';
import { localeStrings } from './fixtures/locales';
import { DARKENHEIMER_THEME } from '../src/hooks/useThemeColors';

// KAN-7 §5 on the real build, and the whole first-open path end to end.

const DAY = 24 * 60 * 60 * 1000;
const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
const stepHeading = (page: Page) =>
  setup(page).getByRole('heading', { level: 3 });
const press = (page: Page, name: string) =>
  setup(page).getByRole('button', { name, exact: true }).click();
// By id, not by name: a language pick renames the dialog itself.
const setupAnyLanguage = (page: Page) =>
  page.locator('dialog[aria-labelledby="setup-title"]');
const languageCodes = (page: Page) =>
  setupAnyLanguage(page)
    .locator('button[lang]')
    .evaluateAll((cells) => cells.map((c) => c.getAttribute('lang')));
const popupOf = (worker: Worker) =>
  worker.evaluate(() => chrome.action.getPopup({}));

async function welcomeThen(
  context: BrowserContext,
  extensionId: string,
  answer: 'Open full view' | 'Not now'
): Promise<Page> {
  const popup = await openPopup(context, extensionId);
  await popup
    .getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true })
    .getByRole('button', { name: 'Get started', exact: true })
    .click();
  await popup
    .getByRole('dialog', { name: 'Try the full view', exact: true })
    .getByRole('button', { name: answer, exact: true })
    .click();
  return popup;
}

test.describe('on a new install', () => {
  test.use({ freshProfile: true });

  test('end to end: welcome, full view, pin, setup, done', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await welcomeThen(context, extensionId, 'Open full view');
    const full = await waitForFullView(context);

    await expect(guide(full)).toBeVisible();
    await setPin(full, true);
    await expect(guide(full)).toHaveCount(0, { timeout: 5000 });

    await expect(stepHeading(full)).toHaveText('Pick a theme');
    await press(full, 'Graphite');
    await expect
      .poll(() => pageGround(full))
      .toBe(DARKENHEIMER_THEME.PRIMARY_COLOR);
    await press(full, 'Next');
    await expect(setup(full).locator('button[lang]').first()).toHaveAttribute(
      'lang',
      'en'
    );
    await expect(setup(full).locator('button[lang="en"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await press(full, 'Next');
    await expect(
      setup(full).getByRole('button', { name: 'Compact view', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await press(full, 'Next');
    await expect(
      setup(full).getByText('Works in any window.', { exact: true })
    ).toBeVisible();
    await press(full, 'Done');

    await expect(full.locator('dialog[open]')).toHaveCount(0);
    expect(await storedSettings(full)).toMatchObject({
      setupState: 'done',
      theme: 'Darkenheimer',
      isFullViewOfferAnswered: true,
      hasOpenedFullView: true,
      isPinGuideDismissed: false,
    });
  });

  test('Not now, then the first full-view open: the guide, then setup', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await welcomeThen(context, extensionId, 'Not now');
    const full = await openFullView(context, extensionId);
    await guide(full)
      .getByRole('button', { name: 'Skip', exact: true })
      .click();
    await expect(stepHeading(full)).toHaveText('Pick a theme');
  });

  test('closing the tab mid-setup resumes at step 1 next time', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: true });
    await welcomeThen(context, extensionId, 'Not now');
    const first = await openFullView(context, extensionId);
    await press(first, 'Next');
    await press(first, 'Next');
    await expect(stepHeading(first)).toHaveText(
      'When you click Tab Keeper, open…'
    );
    await first.close();

    const again = await openFullView(context, extensionId);
    await expect(stepHeading(again)).toHaveText('Pick a theme');
    expect((await storedSettings(again)).setupState).toBe('pending');
  });
});

test('a language pick re-renders the dialog in place, in that language', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  await press(page, 'Next');
  const before = await languageCodes(page);

  await setup(page)
    .getByRole('button', { name: 'Deutsch', exact: true })
    .click();
  await expect(
    setupAnyLanguage(page).getByRole('heading', { level: 3 })
  ).toHaveText('Welche Sprache bevorzugen Sie?');
  expect(await languageCodes(page)).toEqual(before);
  await expect(
    setupAnyLanguage(page).locator('button[lang="de"]')
  ).toHaveAttribute('aria-pressed', 'true');
});

const rectsOf = (locator: Locator) =>
  locator.evaluateAll((els) =>
    els.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    })
  );

test('a pick resizes nothing: every language cell is one height, and a pick in another row moves none', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  await press(page, 'Next');
  const cells = setupAnyLanguage(page).locator('button[lang]');
  await expect(cells).toHaveCount(13);

  const before = await rectsOf(cells);
  expect(new Set(before.map((r) => r.height)).size).toBe(1);

  await setup(page)
    .getByRole('button', { name: 'Italiano', exact: true })
    .click();
  await expect(
    setupAnyLanguage(page).locator('button[lang="it"]')
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await rectsOf(cells)).toEqual(before);
});

test('a pick resizes nothing: the pressed card strip is as tall as the other', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  await press(page, 'Next');
  await press(page, 'Next');
  const strips = setup(page).locator('[data-view-label]');
  const heights = async () => (await rectsOf(strips)).map((r) => r.height);

  const before = await heights();
  expect(new Set(before).size).toBe(1);
  await press(page, 'Full view');
  await expect(
    setup(page).getByRole('button', { name: 'Full view', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await heights()).toEqual(before);
});

// en is the CONTROL: a harness that clips en is broken, not de or ru.
for (const lang of ['en', 'de', 'ru']) {
  test(`${lang} at a 24px root: both view captions sit inside their equal-height cards`, async ({
    context,
    extensionId,
  }) => {
    const strings = localeStrings(lang);
    await stubToolbarPin(context, { pinned: true });
    await seedSettings(context, { language: lang, setupState: 'pending' });
    // Not openFullView: its barrier is an English aria-label.
    const page = await context.newPage();
    await page.setViewportSize(FULL);
    await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
    await setupAnyLanguage(page).waitFor();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '24px';
    });
    const next = setupAnyLanguage(page).getByRole('button', {
      name: strings.Next,
      exact: true,
    });
    await next.click();
    await next.click();
    const cards = setupAnyLanguage(page).locator('button[aria-pressed]');
    await expect(cards).toHaveCount(2);
    const captions = setupAnyLanguage(page).locator('[data-view-caption]');
    await expect(captions).toHaveText([
      strings['Opens under the toolbar icon'],
      strings['Opens in its own tab'],
    ]);
    const fit = await cards.evaluateAll((els) =>
      els.map((card) => {
        const box = card.getBoundingClientRect();
        const strip = card.querySelector('[data-view-label]');
        const caption = card.querySelector('[data-view-caption]');
        if (strip === null || caption === null) throw new Error('no strip');
        const text = caption.getBoundingClientRect();
        const bar = strip.getBoundingClientRect();
        return {
          height: box.height,
          stripHeight: bar.height,
          captionInsideStrip: text.top >= bar.top && text.bottom <= bar.bottom,
          captionInsideCard: text.left >= box.left && text.right <= box.right,
          stripClips: strip.scrollHeight > strip.clientHeight,
        };
      })
    );
    expect(fit[0].height).toBe(fit[1].height);
    expect(fit[0].stripHeight).toBe(fit[1].stripHeight);
    for (const one of fit) {
      expect(one.captionInsideStrip).toBe(true);
      expect(one.captionInsideCard).toBe(true);
      expect(one.stripClips).toBe(false);
    }
  });
}

test('step 3 removes the popup as Settings does', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  await press(page, 'Next');
  await press(page, 'Next');
  await press(page, 'Full view');
  await expect.poll(() => popupOf(serviceWorker)).toBe('');
});

test('an existing user never sees setup', async ({ context, extensionId }) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSessions(context, buildContainer());
  await seedSettings(context, {
    extensionInstalledTime: Date.now() - 2 * DAY,
    lastValueMomentTime: Date.now() - 60 * 60 * 1000,
  });
  const page = await openFullView(context, extensionId);
  // The rate prompt is decided after setup: its opening proves setup said no.
  await expect(
    page.getByRole('dialog', { name: 'Enjoying Tab Keeper?', exact: true })
  ).toBeVisible();
  await expect(setup(page)).toHaveCount(0);
});

test('Esc ends setup for good, as the ✕ does', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  await expect(stepHeading(page)).toHaveText('Pick a theme');
  await page.keyboard.press('Escape');
  await expect(setup(page)).toHaveCount(0);
  expect((await storedSettings(page)).setupState).toBe('done');
});

test('the ✕ is named Skip setup and ends setup for good, as the link does (D4)', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  const named = setup(page).getByRole('button', {
    name: 'Skip setup',
    exact: true,
  });
  // The text link and the ✕; the ✕ is the one drawn with the close glyph.
  await expect(named).toHaveCount(2);
  const cross = named.filter({
    has: page.locator('.material-symbols-outlined', { hasText: /^close$/ }),
  });
  await expect(cross).toHaveCount(1);
  await cross.click();
  await expect(setup(page)).toHaveCount(0);
  expect((await storedSettings(page)).setupState).toBe('done');
});

test('a new step takes the focus to its heading (D5)', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  await expect(setup(page)).toBeFocused();
  await press(page, 'Next');
  await expect(stepHeading(page)).toBeFocused();
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: every setup step reads at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: true });
    await seedSettings(context, { theme, setupState: 'pending' });
    const page = await openFullView(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    for (const step of ['theme', 'language', 'default view', 'shortcut']) {
      // Off the dialog: a hover repaints a button, and the read is of the resting colours.
      await page.mouse.move(0, 0);
      // A button the pointer just left is still fading its hover fill out: retry until it rests.
      await expect(() =>
        expectReadable(setup(page), `${theme} setup, ${step}`)
      ).toPass();
      const colours = (locator: Locator) =>
        locator.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            fill: style.backgroundColor,
            text: style.color,
            border: style.borderTopColor,
          };
        });
      if (step === 'language') {
        // The pressed cell wears the SlidingPair knob: TEXT fill, page-coloured words.
        const cell = await colours(
          setup(page).locator('button[aria-pressed="true"][lang]')
        );
        expect(rgbToHex(cell.fill)).toBe(palette.TEXT_COLOR);
        expect(rgbToHex(cell.text)).toBe(palette.PRIMARY_COLOR);
      }
      if (step === 'default view') {
        // D2: the pressed card's label strip wears the same look; its outline is 1px TEXT.
        const card = setup(page).locator('button[aria-pressed="true"]');
        const strip = await colours(card.locator('[data-view-label]'));
        expect(rgbToHex(strip.fill)).toBe(palette.TEXT_COLOR);
        expect(rgbToHex(strip.text)).toBe(palette.PRIMARY_COLOR);
        // The picked caption reads on the fill as the name does; the other keeps LABEL_L1.
        const caption = (pressedCard: boolean) =>
          colours(
            setup(page)
              .locator(`button[aria-pressed="${pressedCard}"]`)
              .locator('[data-view-caption]')
          );
        expect(rgbToHex((await caption(true)).text)).toBe(
          palette.PRIMARY_COLOR
        );
        expect(rgbToHex((await caption(false)).text)).toBe(
          palette.LABEL_L1_COLOR
        );
        expect(rgbToHex((await colours(card)).border)).toBe(palette.TEXT_COLOR);
        expect(
          await card.evaluate((el) => getComputedStyle(el).borderTopWidth)
        ).toBe('1px');
      }
      if (step !== 'shortcut') await press(page, 'Next');
    }
  });
}
