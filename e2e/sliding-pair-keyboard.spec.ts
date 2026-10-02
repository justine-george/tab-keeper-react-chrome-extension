import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-225. A pointer click on the pressed side flips the pair; a keyboard one
// does nothing, since to a screen reader that silently changes another control.
// Real browser: the discriminator is Chrome's `detail === 0` on synthesised
// clicks.

const SESSION = buildSession({
  tabGroupId: 'session-pair',
  title: 'Keyboard pair',
  isSelected: true,
});

async function openExport(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-pair',
  });
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-pair`
  );
  await expect(page.getByRole('button', { name: 'Compact' })).toBeVisible();
  return page;
}

const pressedIn = (page: Page, group: string) =>
  page
    .getByRole('group', { name: group })
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.getAttribute('aria-label'))
    );

test.describe('the sliding pair from the keyboard (KAN-225)', () => {
  test('Space or Enter on the pressed option leaves it pressed', async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId);
    expect(await pressedIn(page, 'Layout')).toEqual(['Compact']);

    // PREMISE: focus is on the pressed button.
    await page.getByRole('button', { name: 'Compact' }).focus();
    await expect(page.getByRole('button', { name: 'Compact' })).toBeFocused();

    await page.keyboard.press('Space');
    expect(await pressedIn(page, 'Layout')).toEqual(['Compact']);
    await page.keyboard.press('Enter');
    expect(await pressedIn(page, 'Layout')).toEqual(['Compact']);
  });

  // CONTROL: a keyboard that could not change the pair passes the test above.
  test('CONTROL: Space on the other option selects it', async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId);

    await page.getByRole('button', { name: 'Comfortable' }).focus();
    await page.keyboard.press('Space');

    expect(await pressedIn(page, 'Layout')).toEqual(['Comfortable']);
  });

  // CONTROL (KAN-218): proves the fix keys on input kind, not on the button.
  test('CONTROL: a pointer click on the pressed option still flips the pair', async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId);
    expect(await pressedIn(page, 'Layout')).toEqual(['Compact']);

    await page.getByRole('button', { name: 'Compact' }).click();

    expect(await pressedIn(page, 'Layout')).toEqual(['Comfortable']);
  });

  test('the Colour pair behaves the same', async ({ context, extensionId }) => {
    const page = await openExport(context, extensionId);
    expect(await pressedIn(page, 'Colour')).toEqual(['Light']);

    await page.getByRole('button', { name: 'Light' }).focus();
    await page.keyboard.press('Space');
    expect(await pressedIn(page, 'Colour')).toEqual(['Light']);

    await page.getByRole('button', { name: 'Dark' }).focus();
    await page.keyboard.press('Space');
    expect(await pressedIn(page, 'Colour')).toEqual(['Dark']);
  });
});
