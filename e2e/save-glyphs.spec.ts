import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { expectGlyph, iconIn, inkOf } from './fixtures/glyphInk';
import { saveRowMenu } from './fixtures/menus';
import { seedSessions, seedSettings } from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';
import { standIn } from './fixtures/standInPages';
import { SVG_GLYPHS } from '../src/components/common/svgGlyphs';

// KAN-780. Save current window is a window with a plus badge, Save all two
// windows with the same badge: custom SVG paths, since Material Symbols has
// neither. Every surface that draws a save is checked by name, and its pixels
// are counted, because an <svg> with a broken path is a blank square.

const ALL = 'Save all open windows as a session';
const CURRENT = 'Save current window as a session';

test.beforeEach(async ({ context, serviceWorker }) => {
  await seedSettings(context, {});
  await seedSessions(context);
  // This window gets two tabs of its own; a second window gets one.
  await serviceWorker.evaluate(
    async (urls) => {
      const [w] = await chrome.windows.getAll({ windowTypes: ['normal'] });
      for (const url of urls.slice(0, 2))
        await chrome.tabs.create({ windowId: w.id, url, active: false });
      await chrome.windows.create({ url: urls[2], focused: false });
    },
    [standIn('Q4 roadmap'), standIn('KAN board'), standIn('Ryokan near Gion')]
  );
});

async function openFullView(
  context: Parameters<typeof openPage>[0],
  extensionId: string
): Promise<Page> {
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
  await expect(
    header(page).getByText('2 Windows', { exact: false })
  ).toBeVisible();
  return page;
}

const header = (page: Page) => page.locator('[data-open-now-header]');
test('every surface that saves draws its save glyph, and it inks', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);
  const saveRow = page.locator('[data-save-row]');

  // CONTROL: the ink count is zero for the same glyph with its path emptied.
  const probe = iconIn(header(page).getByRole('button', { name: CURRENT }));
  const d = await probe.locator('path').getAttribute('d');
  await probe.locator('path').evaluate((el) => el.setAttribute('d', ''));
  expect(await inkOf(page, probe)).toBe(0);
  await probe.locator('path').evaluate((el, d) => el.setAttribute('d', d), d!);

  await expectGlyph(
    page,
    saveRow.getByRole('button', { name: ALL, exact: true }),
    'two_windows_add'
  );
  await saveRowMenu(page).click();
  await expectGlyph(
    page,
    page.getByRole('menuitem', { name: CURRENT }),
    'window_add'
  );
  await page.keyboard.press('Escape');

  await expectGlyph(
    page,
    header(page).getByRole('button', { name: ALL }),
    'two_windows_add'
  );
  await expectGlyph(
    page,
    header(page).getByRole('button', { name: CURRENT }),
    'window_add'
  );
  await header(page)
    .getByRole('heading', { name: 'Currently open' })
    .click({ button: 'right' });
  // KAN-799. The two saves lead the menu in a row, by their short labels.
  await expectGlyph(
    page,
    page.getByRole('menuitem', { name: 'Save all', exact: true }),
    'two_windows_add'
  );
  await expectGlyph(
    page,
    page.getByRole('menuitem', { name: 'Save current window', exact: true }),
    'window_add'
  );
  // The row's first svg takes the box the list's ligature takes, on the same column.
  const boxOf = (name: RegExp | string) =>
    iconIn(page.getByRole('menuitem', { name, exact: true })).boundingBox();
  const [svgBox, ligatureBox] = [
    await boxOf('Save all'),
    await boxOf('Save open windows as PDF…'),
  ];
  expect(svgBox!.width).toBeCloseTo(ligatureBox!.width, 1);
  expect(svgBox!.height).toBeCloseTo(ligatureBox!.height, 1);
  expect(svgBox!.x).toBeCloseTo(ligatureBox!.x, 1);
  await page.keyboard.press('Escape');

  // A window row's Save saves that one window: Save current window's glyph.
  // Row actions show under the pointer only, so the row is hovered first.
  const windowSave = page
    .getByRole('button', { name: /^Save window as a session: / })
    .first();
  await page.locator('[data-window-row]').first().hover();
  await expect(windowSave).toHaveCSS('opacity', '1');
  await expectGlyph(page, windowSave, 'window_add');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: 'Default save' });
  await expectGlyph(
    page,
    group.locator('label', { hasText: 'All windows' }),
    'two_windows_add'
  );
  await expectGlyph(
    page,
    group.locator('label', { hasText: 'Current window' }),
    'window_add'
  );
});

// KAN-5's measure, on what the build ships: each glyph's ink cropped to its
// bounding box, stretched to 128px square, then |A xor B| / |A or B|.
test('the save glyphs are told apart from each other and from Add window', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);
  await waitForFontsLoaded(page, ['Material Symbols Outlined']);
  const pathOf = (name: string) =>
    page.locator(`svg[data-icon="${name}"] path`).first().getAttribute('d');
  const paths = {
    window_add: (await pathOf('window_add'))!,
    two_windows_add: (await pathOf('two_windows_add'))!,
    // No live group here (tabGroups is not granted), so read from the source.
    group_add: SVG_GLYPHS.group_add,
  };

  // An empty path masks to nothing and would read 100% apart from anything.
  for (const d of Object.values(paths)) expect(d).toMatch(/^M[\d.]/);

  const distinct = await page.evaluate((paths) => {
    const S = 160;
    const mask = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const src = document.createElement('canvas');
      src.width = src.height = S;
      const ctx = src.getContext('2d', { willReadFrequently: true })!;
      draw(ctx);
      const { data } = ctx.getImageData(0, 0, S, S);
      let [x0, y0, x1, y1] = [S, S, -1, -1];
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++)
          if (data[(y * S + x) * 4 + 3] > 127) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
      const out = document.createElement('canvas');
      out.width = out.height = 128;
      const o = out.getContext('2d', { willReadFrequently: true })!;
      o.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, 128, 128);
      const bits = o.getImageData(0, 0, 128, 128).data;
      return Array.from({ length: 128 * 128 }, (_, i) => bits[i * 4 + 3] > 127);
    };
    const ligature = (name: string) =>
      mask((ctx) => {
        ctx.font = `110px "Material Symbols Outlined"`;
        ctx.textBaseline = 'top';
        ctx.fillText(name, 20, 20);
      });
    const svg = (d: string) =>
      mask((ctx) => {
        ctx.translate(20, 20);
        ctx.scale(110 / 24, 110 / 24);
        ctx.fill(new Path2D(d));
      });
    const apart = (a: boolean[], b: boolean[]) => {
      let x = 0;
      let o = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] || b[i]) o++;
        if (a[i] !== b[i]) x++;
      }
      return Math.round((1000 * x) / o) / 10;
    };
    const current = svg(paths.window_add);
    const all = svg(paths.two_windows_add);
    const playlist = ligature('playlist_add');
    return {
      self: apart(current, svg(paths.window_add)),
      searchSettings: apart(ligature('search'), ligature('settings')),
      pair: apart(current, all),
      addWindowCurrent: apart(playlist, current),
      addWindowAll: apart(playlist, all),
      groupCurrent: apart(svg(paths.group_add), current),
      groupAll: apart(svg(paths.group_add), all),
    };
  }, paths);
  console.log('KAN-780 distinctness', JSON.stringify(distinct));

  // CONTROLS: a glyph against itself is 0%; KAN-5's benchmark pair reads 82.1%
  // on a Mac and 83.0% on CI's Linux, which rasterises the font differently.
  expect(distinct.self).toBe(0);
  expect(Math.abs(distinct.searchSettings - 82.1)).toBeLessThanOrEqual(2);
  // Measured 2026-10-25: the pair 56.2%, as close as the library_add / add_box
  // pair it replaced (54.0%), by his choice: one family, told apart by one
  // window or two. Add window 79.1% / 76.2%, so it stays the odd one out.
  expect(distinct.pair).toBeGreaterThanOrEqual(55);
  expect(distinct.addWindowCurrent).toBeGreaterThanOrEqual(75);
  expect(distinct.addWindowAll).toBeGreaterThanOrEqual(75);
  // KAN-796, measured 2026-10-25: a group's Save 47.3% / 50.4% from the window
  // saves, closer than they are to each other. His pick: never on one row, and
  // always beside the word Save.
  expect(distinct.groupCurrent).toBeGreaterThanOrEqual(45);
  expect(distinct.groupAll).toBeGreaterThanOrEqual(48);
});
