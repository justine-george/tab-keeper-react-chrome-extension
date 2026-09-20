import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-225. The export page's sliding pairs are a toggle to a pointer -- a
// click on the pressed side flips the pair -- and NOT to the keyboard.
//
// To a screen reader each pair is two toggle buttons. Activating "Compact,
// toggle button, pressed" and having Comfortable become pressed is an action
// on one control silently changing another. So keyboard activation of the
// pressed side does nothing, and of the other side selects it.
//
// In a real browser, because the discriminator is the browser's: a click
// synthesised from Enter, Space or assistive technology carries
// `detail === 0`, a pointer click its click count. jsdom's user-event copies
// that convention; only Chrome can say Chrome does.

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

    // PREMISE: keyboard focus really is on the pressed button, so the key
    // goes where the test says it does.
    await page.getByRole('button', { name: 'Compact' }).focus();
    await expect(page.getByRole('button', { name: 'Compact' })).toBeFocused();

    await page.keyboard.press('Space');
    expect(await pressedIn(page, 'Layout')).toEqual(['Compact']);
    await page.keyboard.press('Enter');
    expect(await pressedIn(page, 'Layout')).toEqual(['Compact']);
  });

  // CONTROL, keyboard: the other side is still selectable. A keyboard that
  // could not change the pair at all would pass the test above.
  test('CONTROL: Space on the other option selects it', async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId);

    await page.getByRole('button', { name: 'Comfortable' }).focus();
    await page.keyboard.press('Space');

    expect(await pressedIn(page, 'Layout')).toEqual(['Comfortable']);
  });

  // CONTROL, pointer: the click-anywhere flip (KAN-218) is untouched. This
  // is what proves the fix keys on the input kind and not on the button.
  test('CONTROL: a pointer click on the pressed option still flips the pair', async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId);
    expect(await pressedIn(page, 'Layout')).toEqual(['Compact']);

    await page.getByRole('button', { name: 'Compact' }).click();

    expect(await pressedIn(page, 'Layout')).toEqual(['Comfortable']);
  });

  // Both pairs share the component; Colour gets the same contract.
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
