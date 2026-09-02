import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// Two sessions with distinct titles, window titles and tab titles, so every
// assertion below can name the thing it expects rather than counting rows.
const RESEARCH = buildSession({
  tabGroupId: 'session-research',
  title: 'Research',
});

const HOLIDAY = buildSession({
  tabGroupId: 'session-holiday',
  title: 'Holiday',
  windows: [
    {
      windowId: 'window-holiday',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Flights',
      tabs: [
        {
          tabId: 'tab-holiday',
          favicon: '',
          title: 'Skyscanner',
          url: 'https://example.org/flights',
        },
      ],
    },
  ],
});

// Seeded before newPage(), because the popup reads localStorage during its
// first render. Console output is captured from the moment the page exists so
// step 1 can assert on it.
async function openPopup(
  context: BrowserContext,
  extensionId: string
): Promise<{ page: Page; consoleErrors: string[] }> {
  await seedSessions(context, buildContainer([RESEARCH, HOLIDAY]));

  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return { page, consoleErrors };
}

test.describe('golden path', () => {
  test('1. the popup renders with no console errors', async ({
    context,
    extensionId,
  }) => {
    const { page, consoleErrors } = await openPopup(context, extensionId);

    await expect(page.locator('input#name')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('2. seeded sessions appear in the left pane', async ({
    context,
    extensionId,
  }) => {
    const { page } = await openPopup(context, extensionId);

    await expect(page.getByText('Research').first()).toBeVisible();
    await expect(page.getByText('Holiday').first()).toBeVisible();
  });

  test('3. clicking a session shows its details in the right pane', async ({
    context,
    extensionId,
  }) => {
    const { page } = await openPopup(context, extensionId);

    // Nothing is selected on boot, so the window title only exists once a
    // session has been picked -- which is what makes this assert the click
    // rather than the seed.
    await expect(page.getByText('Morning reading')).toHaveCount(0);

    await page.getByText('Research').first().click();

    await expect(page.getByText('Morning reading')).toBeVisible();
  });

  test('4. the open-in-window control is present and enabled', async ({
    context,
    extensionId,
  }) => {
    const { page } = await openPopup(context, extensionId);
    await page.getByText('Research').first().click();

    // Asserted, never clicked: invoking it spawns real browser windows on the
    // machine running the test.
    const openAll = page.locator('[aria-label="Open"]').first();
    await expect(openAll).toBeVisible();
    await expect(openAll).toBeEnabled();
  });

  test('5. search filters the session list', async ({
    context,
    extensionId,
  }) => {
    const { page } = await openPopup(context, extensionId);

    await page.locator('[aria-label="Search"]').click();
    await page.locator('input#searchInput').fill('Holiday');

    await expect(page.getByText('Holiday').first()).toBeVisible();
    await expect(page.getByText('Research')).toHaveCount(0);
  });

  test('6. the settings panel opens and closes', async ({
    context,
    extensionId,
  }) => {
    const { page } = await openPopup(context, extensionId);

    await page.locator('[aria-label="Settings"]').click();

    // Asserted on a settings-only heading, because the back control is not
    // unique to this panel -- the search pane has one too.
    await expect(page.getByText('Themes')).toBeVisible();

    // Addressed by role and accessible name rather than by visible text. That
    // became possible with KAN-56: the affordance is now a real <button>, so
    // this line exercises the same path a screen-reader user takes. It also
    // sidesteps the reason the old version needed `exact: true` -- the
    // Material icon renders its name as the ligature text `arrow_back`, which
    // substring-matches "Back" and trips strict mode.
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.locator('input#name')).toBeVisible();
  });
});
