import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { ONBOARDING_ANSWERED, REVIEW_CARD_DECLINED } from './fixtures/seed';
import { seedRawSettingsIfAbsent } from './fixtures/run';
import { pageGround, storedSettings } from './fixtures/onboarding';
import { rgbToHex } from './fixtures/pixels';
import { stubToolbarPin } from './fixtures/toolbarPin';
import {
  CHALK_THEME,
  CHARCOAL_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
} from '../src/hooks/useThemeColors';

// KAN-731. A new install starts on Chalk, or Charcoal on a dark OS; a stored
// Paper or Graphite moves to Chalk or Charcoal once, and a pick after that sticks.

test.use({ freshProfile: true });

const CHALK = CHALK_THEME.PRIMARY_COLOR;
const CHARCOAL = CHARCOAL_THEME.PRIMARY_COLOR;
const PAPER = LIGHT_THEME.PRIMARY_COLOR;
const GRAPHITE = DARKENHEIMER_THEME.PRIMARY_COLOR;

// Consent, onboarding and the review card answered; no theme and no move flag.
const EVERY_ASK_ANSWERED = {
  cloudConsent: 'granted',
  ...ONBOARDING_ANSWERED,
  ...REVIEW_CARD_DECLINED,
};

// Every document records the settings it started with and its body's ground on its first frame.
async function recordFirstFrames(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    Object.assign(window, {
      __settingsAtStart: localStorage.getItem('settingsData'),
    });
    requestAnimationFrame(() => {
      Object.assign(window, {
        __firstFrameGround: document.body
          ? getComputedStyle(document.body).backgroundColor
          : 'no body yet',
      });
    });
  });
}

const firstFrame = async (page: Page): Promise<string> => {
  const seen = await page
    .waitForFunction(() => Reflect.get(window, '__firstFrameGround'))
    .then((handle) => handle.jsonValue());
  return typeof seen === 'string' ? rgbToHex(seen) : String(seen);
};

// The popup's first frame, then its ground once React has drawn.
async function openPopup(context: BrowserContext, extensionId: string) {
  await recordFirstFrames(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  const first = await firstFrame(page);
  // goto resolves before React mounts.
  await page.locator('[data-pane="sessions"]').waitFor();
  return { page, first };
}

const settingsAtStart = (page: Page) =>
  page.evaluate(() => Reflect.get(window, '__settingsAtStart') as unknown);

const isDarkOs = (page: Page) =>
  page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);

const setupDialog = (page: Page) =>
  page.locator('dialog[open][aria-labelledby="setup-title"]');

// Setup in the full view, on a profile past the move that has stored no theme:
// without the flag, the move would turn a Paper default into Chalk and hide it.
async function openSetup(context: BrowserContext, extensionId: string) {
  await stubToolbarPin(context, { pinned: true });
  await seedRawSettingsIfAbsent(context, {
    ...EVERY_ASK_ANSWERED,
    cloudConsent: 'declined',
    isAutoSync: false,
    setupState: 'pending',
    isChalkCharcoalMoveApplied: true,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await expect(setupDialog(page)).toBeVisible();
  return page;
}

const pressed = (page: Page, name: string) =>
  setupDialog(page)
    .getByRole('button', { name, exact: true })
    .getAttribute('aria-pressed');

for (const [os, theme, ground, other] of [
  ['light', 'Chalk', CHALK, 'Charcoal'],
  ['dark', 'Charcoal', CHARCOAL, 'Chalk'],
] as const) {
  test.describe(`a new install on a ${os} OS`, () => {
    test.use({ colorScheme: os });

    test(`is ${theme} from the first frame`, async ({
      context,
      extensionId,
    }) => {
      const { page, first } = await openPopup(context, extensionId);
      // CONTROL: the OS scheme is the one emulated, inside the page.
      expect(await isDarkOs(page)).toBe(os === 'dark');
      // PREMISE: a new install, with no settings stored.
      expect(await settingsAtStart(page)).toBeNull();
      expect(first).toBe(ground);
      expect(await pageGround(page)).toBe(ground);
    });

    test(`a theme this build does not know is ${theme}`, async ({
      context,
      extensionId,
    }) => {
      await seedRawSettingsIfAbsent(context, {
        ...EVERY_ASK_ANSWERED,
        theme: 'Sepia',
        isChalkCharcoalMoveApplied: true,
      });
      const { page, first } = await openPopup(context, extensionId);
      expect(await isDarkOs(page)).toBe(os === 'dark');
      expect(first).toBe(ground);
      expect(await pageGround(page)).toBe(ground);
    });

    test(`setup offers ${theme} pressed`, async ({ context, extensionId }) => {
      const page = await openSetup(context, extensionId);
      expect(await isDarkOs(page)).toBe(os === 'dark');
      expect(await pressed(page, theme)).toBe('true');
      expect(await pressed(page, other)).toBe('false');
      expect(await pageGround(page)).toBe(ground);
    });
  });
}

for (const [stored, moved, ground] of [
  ['Light', 'Chalk', CHALK],
  ['Darkenheimer', 'Charcoal', CHARCOAL],
] as const) {
  test(`a stored ${stored} without the flag is ${moved} from the first frame, and the move is saved`, async ({
    context,
    extensionId,
  }) => {
    // No flag: as an older build saved it.
    await seedRawSettingsIfAbsent(context, {
      ...EVERY_ASK_ANSWERED,
      theme: stored,
    });
    const { page, first } = await openPopup(context, extensionId);
    expect(first).toBe(ground);
    expect(await pageGround(page)).toBe(ground);
    expect(await storedSettings(page)).toMatchObject({
      theme: moved,
      isChalkCharcoalMoveApplied: true,
    });

    // Saved at load: the next page reads the move, not the old theme.
    await page.reload();
    expect(await firstFrame(page)).toBe(ground);
  });
}

for (const [stored, ground] of [
  ['Light', PAPER],
  ['Darkenheimer', GRAPHITE],
] as const) {
  test(`a stored ${stored} with the flag stays itself`, async ({
    context,
    extensionId,
  }) => {
    await seedRawSettingsIfAbsent(context, {
      ...EVERY_ASK_ANSWERED,
      theme: stored,
      isChalkCharcoalMoveApplied: true,
    });
    const { page, first } = await openPopup(context, extensionId);
    expect(first).toBe(ground);
    expect(await pageGround(page)).toBe(ground);
    expect(await storedSettings(page)).toMatchObject({ theme: stored });
  });
}

test('moved to Chalk, a user who picks Paper again keeps it', async ({
  context,
  extensionId,
}) => {
  // No flag: as an older build saved it.
  await seedRawSettingsIfAbsent(context, {
    ...EVERY_ASK_ANSWERED,
    theme: 'Light',
  });
  const { page } = await openPopup(context, extensionId);
  // PREMISE: the move ran.
  expect(await pageGround(page)).toBe(CHALK);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Paper', exact: true }).click();
  await expect
    .poll(async () => (await storedSettings(page)).theme)
    .toBe('Light');

  await page.reload();
  expect(await firstFrame(page)).toBe(PAPER);
  await page.locator('[data-pane="sessions"]').waitFor();
  expect(await pageGround(page)).toBe(PAPER);
});
