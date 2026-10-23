// KAN-672. The grey date and count lines read at 4.5:1 on the fills they sit
// on: the selected row, the session and Open now headers, the export header.
import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import { seed, sessionRow, S1, S2, S3, S4 } from './fixtures/betweenSessions';
import { sessionHeaderMenu } from './fixtures/menus';
import { expectReadable } from './fixtures/textContrast';

const THEMES = [
  'Chalk',
  'Light',
  'WarmLight',
  'BBPink',
  'Charcoal',
  'Darkenheimer',
  'Blue',
];

for (const theme of THEMES) {
  test(`${theme}: grey text reads at 4.5:1 on its fill`, async ({
    context,
    extensionId,
  }) => {
    await seed(context, [S1(), S2(), S3(), S4()], 'S1');
    // One call: a second seedSettings would replace the theme.
    await seedSettings(context, { theme, foldSavedSessionInTabView: false });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1600, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    const selected = sessionRow(page, 'S1');
    await expect(selected).toBeVisible();
    const now = page.locator('[data-pane="open-now"]');
    await expect(now.getByText('Updates as you browse')).toBeVisible();
    await page.mouse.move(800, 795);

    await expectReadable(selected, `${theme} selected row`);
    await expectReadable(sessionRow(page, 'S2'), `${theme} resting row`);
    await expectReadable(
      page.locator('[data-pane="detail"]').getByText(/^Created /),
      `${theme} session header date`
    );
    await expectReadable(
      now.getByText('Updates as you browse'),
      `${theme} Open now header`
    );

    const [exportPage] = await Promise.all([
      context.waitForEvent('page'),
      (async () => {
        await sessionHeaderMenu(page).click();
        await page.getByRole('menuitem', { name: 'Save as PDF…' }).click();
      })(),
    ]);
    const counts = exportPage.getByText(/^2 Windows/);
    await expect(counts).toBeVisible();
    await expectReadable(
      exportPage.getByText('Preview', { exact: true }),
      `${theme} export label`
    );
    await expectReadable(counts, `${theme} export counts`);
  });
}
