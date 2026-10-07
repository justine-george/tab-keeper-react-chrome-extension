import type { BrowserContext } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import { rgbToHex } from './fixtures/pixels';
import { DARKENHEIMER_THEME, LIGHT_THEME } from '../src/hooks/useThemeColors';

// The first frame a page paints is its theme's ground, not App.css's grey fallback.
const PAGES = [
  ['popup', 'index.html'],
  ['full view', 'index.html?view=tab'],
] as const;
const THEMES = [
  ['Light', LIGHT_THEME.PRIMARY_COLOR],
  ['Darkenheimer', DARKENHEIMER_THEME.PRIMARY_COLOR],
] as const;

// The body's colour on the page's first animation frame, as `#RRGGBB` (or why there was none).
async function firstFrameGround(
  context: BrowserContext,
  extensionId: string,
  path: string
): Promise<unknown> {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    requestAnimationFrame(() => {
      const body = document.body;
      Object.assign(window, {
        __firstFrameGround: body
          ? getComputedStyle(body).backgroundColor
          : 'no body yet',
      });
    });
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  const first = await page
    .waitForFunction(() => Reflect.get(window, '__firstFrameGround'))
    .then((handle) => handle.jsonValue());
  return typeof first === 'string' ? rgbToHex(first) : first;
}

for (const [view, path] of PAGES) {
  for (const [theme, ground] of THEMES) {
    test(`${view}, ${theme}: the first frame is the theme's ground`, async ({
      context,
      extensionId,
    }) => {
      await seedSettings(context, { theme });
      expect(await firstFrameGround(context, extensionId, path)).toBe(
        ground.toUpperCase()
      );
    });
  }
}

// Stored as written, not JSON-encoded: seedSettings cannot write malformed JSON.
const JUNK = [
  ['a theme named __proto__', '{"theme":"__proto__"}'],
  ['malformed settings JSON', '{"theme":'],
] as const;

for (const [view, path] of PAGES) {
  for (const [name, raw] of JUNK) {
    test(`${view}, ${name}: the first frame is Light's ground`, async ({
      context,
      extensionId,
    }) => {
      await context.addInitScript((value: string) => {
        localStorage.setItem('settingsData', value);
      }, raw);
      expect(await firstFrameGround(context, extensionId, path)).toBe(
        LIGHT_THEME.PRIMARY_COLOR.toUpperCase()
      );
    });
  }
}
