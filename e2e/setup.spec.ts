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

  test('end to end: welcome, full view, setup, done, pin', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await welcomeThen(context, extensionId, 'Open full view');
    const full = await waitForFullView(context);

    await expect(stepHeading(full)).toHaveText('Pick a theme');
    await expect(guide(full)).toHaveCount(0);
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

    await expect(guide(full)).toBeVisible();
    await setPin(full, true);
    await expect(full.locator('dialog[open]')).toHaveCount(0, {
      timeout: 5000,
    });
    expect(await storedSettings(full)).toMatchObject({
      setupState: 'done',
      theme: 'Darkenheimer',
      isFullViewOfferAnswered: true,
      hasOpenedFullView: true,
      isPinGuideDismissed: false,
    });
  });

  test('Not now, then the first full-view open: setup, then the guide', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await welcomeThen(context, extensionId, 'Not now');
    const full = await openFullView(context, extensionId);
    await expect(stepHeading(full)).toHaveText('Pick a theme');
    await expect(guide(full)).toHaveCount(0);
    await setup(full).getByText('Skip setup', { exact: true }).click();
    await expect(guide(full)).toBeVisible();
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

// KAN-428. Go back and Next/Done share one width, in any language at any root size.
for (const lang of ['en', 'de', 'ru']) {
  for (const root of [16, 20, 24]) {
    test(`${lang} at a ${root}px root: Go back and Next/Done are one width, inside the dialog, on every step`, async ({
      context,
      extensionId,
    }) => {
      const strings = localeStrings(lang);
      await stubToolbarPin(context, { pinned: true });
      await seedSettings(context, { language: lang, setupState: 'pending' });
      const page = await context.newPage();
      await page.setViewportSize(FULL);
      await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
      await setupAnyLanguage(page).waitFor();
      await page.evaluate((px) => {
        document.documentElement.style.fontSize = `${px}px`;
      }, root);
      const button = (name: string) =>
        setupAnyLanguage(page).getByRole('button', { name, exact: true });
      const widths = async (primary: string) => {
        const [back, end, dialog] = await Promise.all([
          button(strings['Go back']).evaluate((el) =>
            el.getBoundingClientRect()
          ),
          button(primary).evaluate((el) => el.getBoundingClientRect()),
          setupAnyLanguage(page).evaluate((el) => el.getBoundingClientRect()),
        ]);
        return {
          back: back.width,
          end: end.width,
          inside:
            back.left >= dialog.left &&
            end.right <= dialog.right &&
            back.right <= end.left,
        };
      };

      // Step 1 has no Go back: the one button keeps its own width.
      await expect(button(strings['Go back'])).toHaveCount(0);
      await expect(button(strings.Next)).toBeVisible();
      for (const primary of [strings.Next, strings.Next, strings.Done]) {
        await button(strings.Next).or(button(strings.Done)).click();
        await expect(button(strings['Go back'])).toBeVisible();
        const seen = await widths(primary);
        // CONTROL: both are drawn, so a width of zero would not pass for a match.
        expect(seen.back).toBeGreaterThan(20);
        expect(Math.abs(seen.back - seen.end)).toBeLessThanOrEqual(1);
        expect(seen.inside).toBe(true);
      }
    });
  }
}

type TabRow = {
  id?: number;
  index: number;
  windowId: number;
  openerTabId?: number;
  active: boolean;
  url: string;
  pendingUrl: string;
};
const tabRows = (worker: Worker) =>
  worker.evaluate(async (): Promise<TabRow[]> => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: tab.id,
      index: tab.index,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      active: tab.active,
      url: tab.url ?? '',
      pendingUrl: tab.pendingUrl ?? '',
    }));
  });
const isShortcutsPage = (tab: TabRow) =>
  `${tab.url} ${tab.pendingUrl}`.includes('chrome://extensions/shortcuts');

test('Change shortcut opens Chrome shortcuts right after Tab Keeper, as its child (KAN-423)', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  const page = await openFullView(context, extensionId);
  await press(page, 'Next');
  await press(page, 'Next');
  await press(page, 'Next');
  await expect(setup(page).locator('[data-shortcut-hint]')).toHaveText(
    'Opens next to this tab. Close it to come back.'
  );
  const before = await tabRows(serviceWorker);
  const mine = before.find((tab) => tab.url.endsWith('index.html?view=tab'));
  if (mine === undefined) throw new Error('no full view tab');
  expect(before.some(isShortcutsPage)).toBe(false);

  await setup(page)
    .getByRole('button', { name: /^(Change shortcut|Set a shortcut)$/ })
    .click();
  await expect
    .poll(async () => (await tabRows(serviceWorker)).some(isShortcutsPage))
    .toBe(true);
  const opened = (await tabRows(serviceWorker)).find(isShortcutsPage);
  if (opened === undefined) throw new Error('no shortcuts tab');
  expect({
    index: opened.index,
    openerTabId: opened.openerTabId,
    windowId: opened.windowId,
  }).toEqual({
    index: mine.index + 1,
    openerTabId: mine.id,
    windowId: mine.windowId,
  });

  // The new tab takes focus from Tab Keeper, and Chrome returns to the opener on its close.
  expect(opened.active).toBe(true);
  await serviceWorker.evaluate((id) => chrome.tabs.remove(id), opened.id ?? -1);
  await expect
    .poll(async () => {
      const rows = await tabRows(serviceWorker);
      return rows.find((tab) => tab.id === mine.id)?.active;
    })
    .toBe(true);
  expect((await tabRows(serviceWorker)).some(isShortcutsPage)).toBe(false);
});

test('the shortcut shown follows a rebind when the page becomes visible again (KAN-423)', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  await seedSettings(context, { setupState: 'pending' });
  // The harness cannot rebind a command: the page asks a stand-in whose answer the test sets.
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, '__boundKey', {
      configurable: true,
      writable: true,
      value: 'Alt+Shift+K',
    });
    Object.defineProperty(chrome.commands, 'getAll', {
      configurable: true,
      value: () =>
        Promise.resolve([
          {
            name: '_execute_action',
            description: '',
            shortcut: Reflect.get(globalThis, '__boundKey'),
          },
        ]),
    });
  });
  const page = await openFullView(context, extensionId);
  await press(page, 'Next');
  await press(page, 'Next');
  await press(page, 'Next');
  const keys = () => setup(page).locator('[data-testid="setup-shortcut"] kbd');
  await expect(keys()).toHaveText(['Alt', 'Shift', 'K']);

  await page.evaluate(() => {
    Reflect.set(globalThis, '__boundKey', 'Alt+Shift+J');
    // The harness never fires it on a tab switch, so it is dispatched here.
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(keys()).toHaveText(['Alt', 'Shift', 'J']);

  await page.evaluate(() => {
    Reflect.set(globalThis, '__boundKey', 'Ctrl+Shift+M');
    window.dispatchEvent(new Event('focus'));
  });
  await expect(keys()).toHaveText(['Ctrl', 'Shift', 'M']);
});

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
      if (step === 'shortcut') {
        // The hint beside the button is in the read above, at LABEL_L1 on the page.
        await expect(setup(page).locator('[data-shortcut-hint]')).toBeVisible();
      }
      if (step !== 'shortcut') await press(page, 'Next');
    }
  });
}
