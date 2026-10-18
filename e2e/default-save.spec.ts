import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { saveRowMenu } from './fixtures/menus';
import { buildSession, seedSettings } from './fixtures/seed';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../src/hooks/useThemeColors';
import { seedOnce } from './fixtures/cloud';

// KAN-635 on the real artifact: Settings › Sessions › Default save decides
// what the row's button and Enter save; the ⋮ menu's first item is the other.
// The full view's own window holds Here; a second window holds Far, so a
// current-window save keeps Here and leaves Far out.

const VIEW = { width: 1280, height: 800 };
const ALL = 'Save all open windows as a session';
const CURRENT = 'Save current window as a session';

/** No spaces in the title: a data: URL keeps them only when encoded. */
const titled = (title: string) =>
  `data:text/html,<title>${title}</title><p>${title}</p>`;

async function openFarWindow(worker: Worker): Promise<void> {
  await worker.evaluate(async (url) => {
    const win = await chrome.windows.create({ url, focused: false });
    const tabId = win?.tabs?.[0]?.id;
    if (tabId === undefined) throw new Error('no window with a tab');
    for (let i = 0; i < 100; i++) {
      const now = await chrome.tabs.get(tabId);
      if (now.status === 'complete' && now.title === 'Far') return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the far tab never loaded');
  }, titled('Far'));
}

async function openFullView(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const here = await context.newPage();
  await here.goto(titled('Here'));
  const page = await context.newPage();
  await page.setViewportSize(VIEW);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  // Barrier: goto resolves before React mounts.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

// The titles of every stored session's tabs, by session title.
const storedTitles = (page: Page) =>
  page.evaluate(() => {
    const parsed = JSON.parse(
      window.localStorage.getItem('tabContainerData') ?? '{}'
    ) as {
      tabGroups?: {
        title: string;
        windows: { tabs: { title: string }[] }[];
      }[];
    };
    return Object.fromEntries(
      (parsed.tabGroups ?? []).map((g) => [
        g.title,
        g.windows.flatMap((w) => w.tabs.map((t) => t.title)),
      ])
    );
  });

async function saveByEnter(page: Page, name: string): Promise<void> {
  await page.locator('input#name').fill(name);
  await page.locator('input#name').press('Enter');
  await expect(
    page.getByRole('button', { name, exact: true }).first()
  ).toBeVisible();
}

// Scoped to the save row: Open now's own save-all button has the same name.
const saveRow = (page: Page) => page.locator('[data-save-row]');
const glyph = (page: Page, name: string) =>
  saveRow(page)
    .getByRole('button', { name, exact: true })
    .locator('.material-symbols-outlined');

test.beforeEach(async ({ context }) => {
  await seedOnce(context, [
    buildSession({ tabGroupId: 's0', title: 'Already saved' }),
  ]);
});

test('CONTROL, all windows by default: Enter saves the far window too', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await openFarWindow(serviceWorker);
  const page = await openFullView(context, extensionId);
  await expect(glyph(page, ALL)).toHaveText('library_add');

  await saveByEnter(page, 'Everything');
  const titles = (await storedTitles(page))['Everything'] ?? [];
  expect(titles).toContain('Here');
  expect(titles).toContain('Far');
});

test('Current window: the button and Enter save this window; the menu saves all; it survives a reload', async ({
  context,
  serviceWorker,
  extensionId,
}, testInfo) => {
  await openFarWindow(serviceWorker);
  const page = await openFullView(context, extensionId);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: 'Default save' });
  await expect(group.getByRole('radio', { name: 'All windows' })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('settings-all.png') });
  // The tile, not the hidden input: a click anywhere on the box chooses it.
  await group.locator('label', { hasText: 'Current window' }).click();
  await expect(
    group.getByRole('radio', { name: 'Current window' })
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('settings-current.png') });
  await page.getByText('Back', { exact: true }).click();

  await expect(glyph(page, CURRENT)).toHaveText('add_box');
  await expect(saveRow(page).getByRole('button', { name: ALL })).toHaveCount(0);

  await saveByEnter(page, 'Here only');
  const hereOnly = (await storedTitles(page))['Here only'] ?? [];
  expect(hereOnly).toContain('Here');
  expect(hereOnly).not.toContain('Far');

  await page.locator('input#name').fill('Both');
  await saveRowMenu(page).click();
  const first = page.getByRole('menuitem').first();
  await expect(first).toHaveAccessibleName(ALL);
  await first.click();
  await expect(
    page.getByRole('button', { name: 'Both', exact: true }).first()
  ).toBeVisible();
  const both = (await storedTitles(page))['Both'] ?? [];
  expect(both).toContain('Here');
  expect(both).toContain('Far');

  await page.reload();
  await page.locator('[data-tour-anchor="save"]').waitFor();
  await expect(glyph(page, CURRENT)).toHaveText('add_box');
});

// Each glyph's horizontal offset from the middle of the cell it sits in,
// measured inside the cell's border, in CSS px. Centred measures 0; the
// tolerance is Chromium's 1/64px layout unit.
const LAYOUT_UNIT = 1 / 64;
const glyphOffsets = (cells: ReturnType<Page['locator']>) =>
  cells.evaluateAll((els) =>
    els.map((cell) => {
      const glyph = cell.querySelector('.material-symbols-outlined');
      if (!glyph) throw new Error('a cell without a glyph');
      const c = cell.getBoundingClientRect();
      const g = glyph.getBoundingClientRect();
      return (
        g.left + g.width / 2 - (c.left + cell.clientLeft + cell.clientWidth / 2)
      );
    })
  );

// 20px is Chrome's "Large" font size: the glyph is rem, the strip px.
for (const root of [16, 20]) {
  test(`KAN-647: the settings tiles centre their glyphs, as the save row does, at a ${root}px root`, async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await page.evaluate((px) => {
      document.documentElement.style.fontSize = `${px}px`;
    }, root);
    // CONTROL: the drawing copies this row, whose ⋮ is centred.
    const row = await glyphOffsets(
      saveRow(page)
        .getByRole('button', { name: ALL, exact: true })
        .or(saveRow(page).getByRole('button', { name: 'More actions' }))
    );
    expect(row).toHaveLength(2);
    for (const offset of row)
      expect(Math.abs(offset)).toBeLessThanOrEqual(LAYOUT_UNIT);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    const cells = page
      .getByRole('radiogroup', { name: 'Default save' })
      .locator('[data-tile] > span');
    // Two tiles, a square and a strip each. Barrier: evaluateAll does not wait.
    await expect(cells).toHaveCount(4);
    const tiles = await glyphOffsets(cells);
    for (const offset of tiles)
      expect(Math.abs(offset)).toBeLessThanOrEqual(LAYOUT_UNIT);
  });
}

test('another open page swaps its row without a reload', async ({
  context,
  extensionId,
}) => {
  const other = await openFullView(context, extensionId);
  await expect(glyph(other, ALL)).toHaveText('library_add');

  const page = await openFullView(context, extensionId);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Default save' })
    .locator('label', { hasText: 'Current window' })
    .click();

  await expect(glyph(other, CURRENT)).toHaveText('add_box');
});

// KAN-675. The chosen tile's mark is its own frame at 2px of LABEL_L2, not the
// focus ring: a 2px TEXT_COLOR outline read as "focus is here", and with focus
// the tile drew two rings of the same weight.
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
for (const [theme, colors] of [
  ['Light', LIGHT_THEME],
  ['WarmLight', WARM_LIGHT_THEME],
  ['BBPink', BB_PINK_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
  ['Blue', BLUE_THEME],
] as const) {
  test(`KAN-675: the chosen tile has a 2px LABEL_L2 frame and no ring, focused or not (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    const group = page.getByRole('radiogroup', { name: 'Default save' });
    const tile = (name: string) =>
      group.locator('label', { hasText: name }).locator('[data-tile]');
    const mark = (name: string) =>
      tile(name).evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          outline: s.outlineStyle,
          border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        };
      });
    const chosen = {
      outline: 'none',
      border: `2px solid ${rgb(colors.LABEL_L2_COLOR)}`,
    };
    const other = {
      outline: 'none',
      border: `1px solid ${rgb(colors.CONTROL_BORDER_COLOR)}`,
    };
    await expect(
      group.getByRole('radio', { name: 'All windows' })
    ).toBeChecked();
    expect(await mark('All windows')).toEqual(chosen);
    expect(await mark('Current window')).toEqual(other);

    // Focused, the only TEXT_COLOR ring is the focus ring inside the tile.
    const radio = group.getByRole('radio', { name: 'All windows' });
    await radio.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(radio).toBeFocused();
    expect(await mark('All windows')).toEqual(chosen);
    expect(
      await tile('All windows').evaluate((el) => {
        const s = getComputedStyle(el, '::after');
        return `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`;
      })
    ).toBe(`2px solid ${rgb(colors.TEXT_COLOR)}`);

    // The mark moves with the choice.
    await group.locator('label', { hasText: 'Current window' }).click();
    expect(await mark('Current window')).toEqual(chosen);
    expect(await mark('All windows')).toEqual(other);
  });
}
