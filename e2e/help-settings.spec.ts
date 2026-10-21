import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettingsIfAbsent } from './fixtures/seed';
import {
  THEMES,
  openFullView,
  openPopup,
  pageGround,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';
import { expectReadable } from './fixtures/textContrast';

// KAN-7 Help on the real build: the rows, and where each leads from each view.

const help = (page: Page) => page.locator('[data-help]');
const setup = (page: Page) =>
  page.getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true });
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
const row = (page: Page, name: string) =>
  help(page).getByRole('button', { name, exact: true });

async function openHelp(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(help(page)).toHaveAttribute('data-pin-state', /.+/);
}

test('popup: Run setup again opens the full view on setup’s first step', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await row(popup, 'Run setup again').click();
  const full = await waitForFullView(context);
  await expect(setup(full)).toBeVisible();
  await expect(setup(full).getByRole('heading', { level: 3 })).toHaveText(
    'Pick a theme'
  );
});

// KAN-589. Setup opens over the home page, not over Settings. The save row is
// the home page's own (Settings' left pane is data-pane="sessions" too).
const home = (page: Page) =>
  page.locator('[data-pane="sessions"] [data-tour-anchor="save"]');

test('full view: Run setup again leaves Settings and shows setup over the home page', async ({
  context,
  extensionId,
}) => {
  const full = await openFullView(context, extensionId);
  await openHelp(full);
  // PREMISE: on Settings, the home page hidden.
  await expect(home(full)).toBeHidden();
  await row(full, 'Run setup again').click();
  await expect(setup(full)).toBeVisible();
  await expect(help(full)).toHaveCount(0);
  await expect(home(full)).toBeVisible();
  expect((await storedSettings(full)).setupState).toBe('pending');
});

test('popup, with the full view open on Settings: Run setup again shows setup there over the home page', async ({
  context,
  extensionId,
}) => {
  const full = await openFullView(context, extensionId);
  await openHelp(full);
  // PREMISE: the full view sits on Settings.
  await expect(home(full)).toBeHidden();
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await row(popup, 'Run setup again').click();
  await expect(setup(full)).toBeVisible();
  await expect(help(full)).toHaveCount(0);
  await expect(home(full)).toBeVisible();
});

test('popup, unpinned: Show me how opens the full view on the guide, though it was dismissed', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await expect(help(popup)).toHaveAttribute('data-pin-state', 'unpinned');
  await row(popup, 'Show me how').click();
  const full = await waitForFullView(context);
  await expect(guide(full)).toBeVisible();
  expect((await storedSettings(full)).isPinGuideDismissed).toBe(true);
});

test('full view, unpinned: Show me how shows the guide right here', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  const full = await openFullView(context, extensionId);
  await openHelp(full);
  await row(full, 'Show me how').click();
  await expect(guide(full)).toBeVisible();
});

test('pinned: there is no pin row', async ({ context, extensionId }) => {
  await stubToolbarPin(context, { pinned: true });
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await expect(help(popup)).toHaveAttribute('data-pin-state', 'pinned');
  await expect(row(popup, 'Show me how')).toHaveCount(0);
  await expect(row(popup, 'Run setup again')).toBeVisible();
});

// KAN-512. The tour first, then setup, then the pin row; every button About's 250px, in the popup and the full view.
for (const view of ['popup', 'full view'] as const) {
  test(`${view}, unpinned: the tour leads, and every Help button is 250×48`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    const page =
      view === 'popup'
        ? await openPopup(context, extensionId)
        : await openFullView(context, extensionId);
    await openHelp(page);
    const boxes = await help(page)
      .getByRole('button')
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            name: (el.textContent ?? '').replace(/^[a-z_]+/, ''),
            y: r.y,
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })
      );
    expect(boxes.map((b) => b.name)).toEqual([
      'Show me around',
      'Run setup again',
      'Show me how',
    ]);
    expect(boxes.map((b) => [b.w, b.h])).toEqual([
      [250, 48],
      [250, 48],
      [250, 48],
    ]);
    expect(boxes[0].y).toBeLessThan(boxes[1].y);
    await expect(
      help(page).getByText('Go through the first-time setup again.', {
        exact: true,
      })
    ).toBeVisible();
  });
}

test('popup: Show me around returns home and records the popup run at its save card', async ({
  context,
  extensionId,
}) => {
  const popup = await openPopup(context, extensionId);
  await openHelp(popup);
  await row(popup, 'Show me around').click();
  await expect(
    popup.locator('[aria-label="Sort sessions"]').first()
  ).toBeVisible();
  await expect
    .poll(async () => (await storedSettings(popup)).firstRun)
    .toMatchObject({ view: 'popup', step: 1, sessionId: null, ended: null });
});

test.describe('contrast', () => {
  test.use({ freshProfile: true });

  for (const [theme, palette] of THEMES) {
    test(`${theme}: Help reads at 4.5:1`, async ({ context, extensionId }) => {
      await stubToolbarPin(context, { pinned: false });
      await seedSettingsIfAbsent(context, { theme });
      const popup = await openPopup(context, extensionId);
      expect(await pageGround(popup)).toBe(palette.PRIMARY_COLOR);
      await openHelp(popup);
      await expect(help(popup)).toHaveAttribute('data-pin-state', 'unpinned');
      await expectReadable(help(popup), `${theme} Help`);
    });
  }
});

// KAN-502. An icon-and-label button's content sits centred: as much room before
// the glyph's box as after the label, on every such button in Help and About.
for (const category of ['Help', 'About'] as const) {
  test(`${category}: each icon-and-label button is centred`, async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: category, exact: true }).click();
    // The pane's own buttons drawn first: a probe right after the click can run before they render.
    await expect(
      page.locator('[data-pane="detail"]').getByRole('button', {
        name: category === 'Help' ? 'Show me around' : 'Rate Tab Keeper',
        exact: true,
      })
    ).toBeVisible();
    const gaps = await page.evaluate(() =>
      // The settings content; the left pane's Back is a borderless link, not a Button.
      [...document.querySelectorAll('[data-pane="detail"] button')].flatMap(
        (button) => {
          const glyph = button.querySelector('.material-symbols-outlined');
          const label = [...button.querySelectorAll('span')].find(
            (span) =>
              !span.classList.contains('material-symbols-outlined') &&
              span.children.length === 0 &&
              (span.textContent ?? '').trim() !== ''
          );
          if (glyph === null || label === undefined) return [];
          const box = button.getBoundingClientRect();
          const before = glyph.getBoundingClientRect().left - box.left;
          const after = box.right - label.getBoundingClientRect().right;
          return [{ name: label.textContent, before, after }];
        }
      )
    );
    // CONTROL: the probe found the buttons it measures.
    expect(gaps.length).toBeGreaterThanOrEqual(category === 'Help' ? 3 : 2);
    for (const { name, before, after } of gaps) {
      expect(
        Math.abs(before - after),
        `${name}: ${before} vs ${after}`
      ).toBeLessThanOrEqual(0.5);
    }
  });
}
