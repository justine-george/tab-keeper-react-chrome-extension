import type { JSHandle, Page } from '@playwright/test';

import { hasCloudConfig } from './fixtures/cloud';
import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  openPopup,
  seed,
  S1,
  S2,
  S3,
  S4,
  TAB_VIEW,
  sessionRow,
} from './fixtures/betweenSessions';
import { openFullView, openPopup as openWelcome } from './fixtures/onboarding';
import { ON_TITLE } from './fixtures/savedRow';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { stubToolbarPin } from './fixtures/toolbarPin';
import { DARKENHEIMER_THEME, LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-671. Tab through each page and require the app's ring (KAN-405: 2px
// TEXT_COLOR) at every stop. Before it, the name and search fields drew
// nothing, and rows, rename buttons, Settings and the welcome's link drew
// Chrome's blue. A light and a dark theme: the blue failed 3:1 only in dark.

const THEMES = [
  ['Light', LIGHT_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
] as const;

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const DAY = 24 * 60 * 60 * 1000;

const SETTINGS_CATEGORIES = [
  'Display',
  'Language',
  'Quick access',
  'Sync & backup',
  'Sessions',
  'Recently deleted',
  'About',
  'Help',
];

interface Stop {
  name: string;
  ring: string;
}

// The focused element's outline, or its parent's: a search field's ring is
// drawn round its whole row, glass and keycap included. A visually hidden
// radio's ring is a ::after border inside its label, on the tile it stands
// for (DefaultSaveChoice). 'lap' at a stop already in `seen`; null outside
// the page.
const readStop = (page: Page, seen: JSHandle<WeakSet<Element>>) =>
  page.evaluate((seen): Stop | 'lap' | null => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    if (seen.has(el)) return 'lap';
    seen.add(el);
    const outline = (e: Element) => {
      const s = getComputedStyle(e);
      return s.outlineStyle === 'none'
        ? 'none'
        : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
    };
    const after = (e: Element) => {
      const s = getComputedStyle(e, '::after');
      return s.content === 'none' || s.borderStyle === 'none'
        ? 'none'
        : `${s.borderStyle} ${s.borderWidth} ${s.borderColor}`;
    };
    const parent = el.parentElement;
    const hidden = el.getBoundingClientRect().width <= 1;
    const ring =
      hidden && parent
        ? ([...parent.querySelectorAll('*')]
            .map(after)
            .find((r) => r !== 'none') ?? 'none')
        : outline(el) === 'none' && parent
          ? outline(parent)
          : outline(el);
    const name =
      el.getAttribute('aria-label') ||
      (el.id ? `#${el.id}` : el.textContent?.trim().slice(0, 40) || el.tagName);
    return { name, ring };
  }, seen);

// Tab until focus comes back round to a stop already seen.
async function walk(page: Page, max: number): Promise<Stop[]> {
  await page.mouse.move(2, 2);
  const stops: Stop[] = [];
  const seen = await page.evaluateHandle(() => new WeakSet<Element>());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const stop = await readStop(page, seen);
    if (stop === 'lap') return stops;
    if (stop !== null) stops.push(stop);
  }
  throw new Error(
    `no lap in ${max} Tabs; last ${stops[stops.length - 1]?.name}`
  );
}

function expectRingEverywhere(stops: Stop[], text: string, reached: string[]) {
  // PREMISE: the walk got to the stops that had no ring or Chrome's.
  const names = stops.map((s) => s.name);
  for (const name of reached) expect(names).toContain(name);
  const ring = `solid 2px ${rgb(text)}`;
  expect(stops.filter((s) => s.ring !== ring)).toEqual([]);
}

for (const [theme, colors] of THEMES) {
  test(`every stop in the popup draws the ring (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openPopup(context, extensionId);
    expectRingEverywhere(await walk(page, 80), colors.TEXT_COLOR, [
      '#name',
      'Search saved tabs',
      'Source',
      'Rename session: Source',
      'Rename window: w1',
      'Open in new tab: Tab a0',
      'Rename group: Alpha',
    ]);
  });

  test(`every stop in the tab view draws the ring (${theme})`, async ({
    context,
    extensionId,
  }) => {
    // openTabView seeds settings itself and would drop the theme.
    await seed(context, [S1(), S2(), S3(), S4()], 'S1');
    await seedSettings(context, { theme, foldSavedSessionInTabView: false });
    const page = await context.newPage();
    await page.setViewportSize(TAB_VIEW);
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await sessionRow(page, 'S1').click(ON_TITLE);
    await expect(page.locator('[data-drag-row-id="w1"]')).toBeVisible();
    const stops = await walk(page, 140);
    expectRingEverywhere(stops, colors.TEXT_COLOR, [
      'Search open tabs',
      'Search saved tabs',
      'Open in new tab: Tab a0',
    ]);
    expect(stops.some((s) => s.name.startsWith('Switch to tab: '))).toBe(true);
  });

  test(`every stop in every Settings category draws the ring (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const stops: Stop[] = [];
    for (const category of SETTINGS_CATEGORIES) {
      await page
        .locator('[data-pane="sessions"]')
        .getByRole('button', { name: category, exact: true })
        .click();
      stops.push(...(await walk(page, 80)));
    }
    expectRingEverywhere(stops, colors.TEXT_COLOR, [
      'Go back',
      ...SETTINGS_CATEGORIES,
      'Paper',
      'Ink',
      '12-hour',
      '24-hour',
      'Privacy policy',
    ]);
  });

  test(`every stop in every setup step draws the ring (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: true });
    await seedSessions(context, buildContainer());
    await seedSettings(context, { setupState: 'pending', theme });
    const page = await openFullView(context, extensionId);
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    const stops: Stop[] = [];
    for (;;) {
      stops.push(...(await walk(page, 30)));
      const next = dialog.getByRole('button', { name: 'Next', exact: true });
      if ((await next.count()) === 0) break;
      await next.click();
    }
    expectRingEverywhere(stops, colors.TEXT_COLOR, [
      'Paper',
      'Ink',
      'privacy policy',
    ]);
  });

  test(`every stop in the welcome draws the ring (${theme})`, async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    // An existing user's welcome, as cloud-consent.spec stages it.
    await seedSessions(context, buildContainer());
    await seedSettings(context, {
      cloudConsent: '',
      extensionInstalledTime: Date.now() - 30 * DAY,
      theme,
    });
    const page = await openWelcome(context, extensionId);
    await expect(page.locator('dialog[open]')).toBeVisible();
    expectRingEverywhere(await walk(page, 12), colors.TEXT_COLOR, [
      'Read the privacy policy',
    ]);
  });
}
