import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// While sessions exist, one is selected, so the right pane is never blank.
// Seeded with no selection (selectedTabGroupId null), as a fresh profile or a
// device that lost its session to a sync is.

const sessionNamed = (id: string, title: string, windowTitle: string) =>
  buildSession({
    tabGroupId: id,
    title,
    windows: [
      {
        windowId: `${id}-w`,
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: windowTitle,
        tabs: [
          {
            tabId: `${id}-t`,
            favicon: '',
            title: `${title} tab`,
            url: `https://${id}.example/`,
          },
        ],
      },
    ],
  });

const THREE = [
  sessionNamed('s-first', 'First session', 'First window'),
  sessionNamed('s-second', 'Second session', 'Second window'),
  sessionNamed('s-third', 'Third session', 'Third window'),
];

async function openUnselected(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, buildContainer(THREE));
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

// The row container is the parent of the row's ClickableRow button; the
// highlight is its background (selection-feedback.spec.ts).
const row = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true }).locator('..');
const HIGHLIGHT = 'rgba(0, 0, 0, 0)';

test.describe('a session is always selected (KAN-390)', () => {
  test('opening with no stored selection selects the first session and shows it', async ({
    context,
    extensionId,
  }) => {
    const page = await openUnselected(context, extensionId);

    await expect(page.getByText('First window')).toBeVisible();
    await expect(row(page, 'First session')).not.toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
    await expect(row(page, 'Second session')).toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
    await expect(row(page, 'Third session')).toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
    await expect(page.getByText('Second window')).toHaveCount(0);
  });

  test('deleting the selected middle session selects the next one and shows it', async ({
    context,
    extensionId,
  }) => {
    const page = await openUnselected(context, extensionId);
    await row(page, 'Second session').click({ position: { x: 20, y: 20 } });
    await expect(page.getByText('Second window')).toBeVisible();

    await sessionHeaderMenu(page).click();
    await page.getByRole('menuitem', { name: 'Delete session' }).click();

    await expect(
      page.getByRole('button', { name: 'Second session', exact: true })
    ).toHaveCount(0);
    await expect(page.getByText('Third window')).toBeVisible();
    await expect(row(page, 'Third session')).not.toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
    await expect(row(page, 'First session')).toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
  });
});

// Folded, the selected row is kept in state but not drawn: no saved session is
// shown. Unfolding draws it; a peek lights the row that is then shown.
test.describe('the tab view folded does not draw the selection (KAN-390)', () => {
  const openTabView = async (
    context: BrowserContext,
    extensionId: string
  ): Promise<Page> => {
    await seedSessions(context, {
      ...buildContainer(THREE),
      selectedTabGroupId: 's-first',
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await expect(
      page.getByRole('button', { name: 'Show the saved session', exact: true })
    ).toBeVisible();
    return page;
  };
  const bg = (page: Page, title: string) =>
    row(page, title).evaluate((el) => getComputedStyle(el).backgroundColor);

  test('folded the selected row looks like an unselected one; unfolding draws it; folding again removes it', async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(context, extensionId);
    await page.mouse.move(0, 0);

    await expect(row(page, 'First session')).toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
    expect(await bg(page, 'First session')).toBe(
      await bg(page, 'Second session')
    );

    await page
      .getByRole('button', { name: 'Show the saved session', exact: true })
      .click();
    await page.mouse.move(0, 0);
    await expect(row(page, 'First session')).not.toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
    await expect(row(page, 'Second session')).toHaveCSS(
      'background-color',
      HIGHLIGHT
    );

    await page
      .getByRole('button', { name: 'Fold the saved session away', exact: true })
      .click();
    await page.mouse.move(0, 0);
    await expect(row(page, 'First session')).toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
  });

  test('a peek lights the peeked row', async ({ context, extensionId }) => {
    const page = await openTabView(context, extensionId);

    await row(page, 'Second session').click({ position: { x: 20, y: 20 } });
    await page.mouse.move(0, 0);

    await expect(page.getByText('Second window')).toBeVisible();
    await expect(row(page, 'Second session')).not.toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
    await expect(row(page, 'First session')).toHaveCSS(
      'background-color',
      HIGHLIGHT
    );
  });
});
