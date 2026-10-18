import type { JSHandle, Locator, Page } from '@playwright/test';

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
import { pixelsAt, rgbToHex } from './fixtures/pixels';
import { ON_TITLE } from './fixtures/savedRow';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';
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
// drawn round its whole row, glass and keycap included. A saved session's is
// its row's ::after, above the actions strip that covers the row's right. A visually hidden
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
    const candidates = hidden
      ? [...(parent?.querySelectorAll('*') ?? [])].map(after)
      : [outline(el), ...(parent ? [outline(parent), after(parent)] : [])];
    const ring = candidates.find((r) => r !== 'none') ?? 'none';
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

// A sliding pair's pressed half sits under the knob, painted in TEXT_COLOR,
// so its ring is drawn on the knob's copy of that half, in PRIMARY_COLOR.
for (const [theme, colors] of THEMES) {
  test(`a sliding pair's ring shows on either half (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const pair = page.getByRole('group', { name: 'Time format' });
    const halves = [
      pair.getByRole('button', { name: '12-hour' }),
      pair.getByRole('button', { name: '24-hour' }),
    ];
    const knobCopy = pair.locator('[data-sliding-knob] > span').first();
    const outline = (loc: Locator) =>
      loc.evaluate((el) => {
        const s = getComputedStyle(el);
        return s.outlineStyle === 'none'
          ? 'none'
          : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
      });
    // PREMISE: 12-hour is the pressed half, under the knob.
    await expect(halves[0]).toHaveAttribute('aria-pressed', 'true');

    await halves[0].focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(halves[0]).toBeFocused();
    expect(await outline(knobCopy)).toBe(
      `solid 2px ${rgb(colors.PRIMARY_COLOR)}`
    );

    await page.keyboard.press('Tab');
    await expect(halves[1]).toBeFocused();
    expect(await outline(halves[1])).toBe(
      `solid 2px ${rgb(colors.TEXT_COLOR)}`
    );
    expect(await outline(knobCopy)).toBe('none');
  });
}

// The selected session draws its actions strip at rest (KAN-582), an opaque
// mask over the row's right. The ring must paint over it, or it is open there.
for (const [theme, colors] of THEMES) {
  test(`the selected session's ring closes over its actions (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openPopup(context, extensionId);
    await page.mouse.move(2, 540);
    const button = page.getByRole('button', { name: 'Source', exact: true });
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    const row = await button.locator('..').boundingBox();
    if (row === null) throw new Error('no row box');
    const midY = row.y + row.height / 2;
    // PREMISE: the strip is drawn, under where the ring's right edge goes.
    const strip = await button
      .locator('..')
      .locator('[data-row-actions]')
      .boundingBox();
    if (strip === null) throw new Error('no actions strip');
    expect(strip.x + strip.width).toBeGreaterThanOrEqual(row.x + row.width - 1);
    const [inside, left, right] = await pixelsAt(page, [
      [row.x + 6, row.y + 6],
      [row.x + 3, midY],
      [row.x + row.width - 3, midY],
    ]);
    // Control: the decode reads the selection fill where nothing else paints.
    expect(inside).toBe(rgbToHex(rgb(colors.SELECTION_COLOR)));
    expect([left, right]).toEqual(
      [colors.TEXT_COLOR, colors.TEXT_COLOR].map((c) => c.toUpperCase())
    );
  });
}

// KAN-676. A rename field exists only while renaming, so no walk reaches it:
// open each with Tab and Enter, then require the ring at both of its sides.
// KAN-677. The tick is laid over the field's right end and fills under the
// pointer, and the session's was opaque, so read with the pointer away,
// resting on the field (where a click rename leaves it), and on the tick.
async function expectFieldRing(
  page: Page,
  opener: Locator,
  colors: typeof LIGHT_THEME
) {
  await page.mouse.move(2, 2);
  await opener.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  const field = page.locator('input:focus');
  // PREMISE: Enter opened the field and focus is in it.
  await expect(field).toHaveCount(1);
  const box = await field.boundingBox();
  const tickButton = page.getByRole('button', { name: 'Save changes' });
  const tick = await tickButton.boundingBox();
  if (box === null || tick === null) throw new Error('no field or tick box');
  const midY = box.y + box.height / 2;
  const fill = colors.PRIMARY_COLOR.toUpperCase();
  const ring = colors.TEXT_COLOR.toUpperCase();
  const states = [
    ['away', () => page.mouse.move(2, 2)],
    ['on the field', () => page.mouse.move(box.x + box.width / 3, midY)],
    ['on the tick', () => page.mouse.move(tick.x + 16, tick.y + 16)],
  ] as const;
  for (const [where, move] of states) {
    await move();
    // The tick's fill and reveal ease in: read once they have landed.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished))
    );
    const [ground, left, right, tickFill] = await pixelsAt(page, [
      [box.x + 5, midY],
      [box.x + 3, midY],
      [box.x + box.width - 3, midY],
      [tick.x + 6, tick.y + 6],
    ]);
    // PREMISE: pointing at the tick fills it, over the field's right end.
    if (where === 'on the tick') expect(tickFill).not.toBe(fill);
    // Control: the decode reads the field's own fill inside the ring. Away
    // from the tick, the tick has no box of its own (KAN-677 pick Y).
    expect({ where, ground, left, right }).toEqual({
      where,
      ground: fill,
      left: ring,
      right: ring,
    });
    if (where !== 'on the tick')
      expect({ where, tickFill }).toEqual({ where, tickFill: fill });
    // The tick is the edit's save control: shown for the whole edit, wherever
    // the pointer is. Playwright's toBeVisible passes at opacity 0.
    const shown = await tickButton.evaluate((el) => {
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement)
        opacity *= Number(getComputedStyle(e).opacity);
      return opacity;
    });
    expect({ where, shown }).toEqual({ where, shown: 1 });
  }
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
}

for (const [theme, colors] of THEMES) {
  test(`every saved rename field draws the ring (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openPopup(context, extensionId);
    for (const name of [
      'Rename session: Source',
      'Rename window: w1',
      'Rename group: Alpha',
    ]) {
      await expectFieldRing(
        page,
        page.getByRole('button', { name, exact: true }),
        colors
      );
    }
  });

  test(`the Open now group rename field draws the ring (${theme})`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSettings(context, { theme });
    const page = await context.newPage();
    await page.setViewportSize(TAB_VIEW);
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    const windowId = await serviceWorker.evaluate(async (urls) => {
      const win = await chrome.windows.create({ url: urls, focused: false });
      const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
      const groupId = await chrome.tabs.group({
        tabIds: [first, second],
        createProperties: { windowId: win?.id },
      });
      await chrome.tabGroups.update(groupId, { title: 'Kyoto' });
      return win?.id ?? -1;
    }, ['Temples', 'Gardens'].map(standIn));
    await expectFieldRing(
      page,
      page
        .locator(`[data-open-window-id="${windowId}"]`)
        .getByRole('button', { name: 'Rename group: Kyoto' }),
      colors
    );
  });
}
