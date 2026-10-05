import type { BrowserContext, Page } from '@playwright/test';

import { expect } from './extension';
import { rgbToHex } from './pixels';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
  type ThemeColors,
} from '../../src/hooks/useThemeColors';

// KAN-7. Shared by the onboarding specs.

export const POPUP = { width: 790, height: 550 };
export const FULL = { width: 1280, height: 800 };
export const FULL_VIEW_PATH = 'index.html?view=tab';

// Each theme as stored, with its palette for the CONTROL that it took effect.
export const THEMES: readonly (readonly [string, ThemeColors])[] = [
  ['Light', LIGHT_THEME],
  ['WarmLight', WARM_LIGHT_THEME],
  ['BBPink', BB_PINK_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
  ['Blue', BLUE_THEME],
];

// Waits for the app, not the navigation: goto resolves before React mounts.
// A CSS locator, so it also finds the header behind a modal dialog.
export async function openPage(
  context: BrowserContext,
  extensionId: string,
  path: string,
  viewport: { width: number; height: number }
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  return page;
}

export const openPopup = (context: BrowserContext, extensionId: string) =>
  openPage(context, extensionId, 'index.html', POPUP);

export const openFullView = (context: BrowserContext, extensionId: string) =>
  openPage(context, extensionId, FULL_VIEW_PATH, FULL);

// The full view the worker opened, found by address: a 'page' event can be another tab's.
export async function waitForFullView(context: BrowserContext): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = context.pages().find((p) => p.url().endsWith(FULL_VIEW_PATH));
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error('no full view page');
  await found.locator('[aria-label="Sort sessions"]').first().waitFor();
  return found;
}

export function storedSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const parsed: unknown = JSON.parse(
      localStorage.getItem('settingsData') ?? '{}'
    );
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  });
}

// The app's own fill, for the CONTROL that a seeded theme is the one painted.
export async function pageGround(page: Page): Promise<string> {
  return rgbToHex(
    await page.evaluate(() => {
      const app = document.querySelector('#root > div');
      if (app === null) throw new Error('no app container');
      return getComputedStyle(app).backgroundColor;
    })
  );
}

// Two frames after a barrier, so a negative is read after the page had its chance to draw.
export const twoFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      )
  );
