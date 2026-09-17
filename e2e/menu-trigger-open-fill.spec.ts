import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { pixelsAt } from './fixtures/pixels';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-217. An overflow menu's trigger stays filled while its menu is open.
//
// A trigger is an Icon, which filled only on :hover and :active. Opening the
// menu moves the pointer onto the menu, off the trigger, so the trigger went
// back to no fill while its own menu was on screen -- nothing said which
// control the open menu belonged to. Opened from the keyboard it never filled
// at all.
//
// The open trigger now paints the PRESSED rung, and this compares against a
// real press rather than a literal: a hex would pin one palette and pass a
// fix that filled with the wrong colour. The press is sampled mid-click, with
// the button down and not yet released.
//
// Pixels, not computed styles: jsdom cannot enter :hover or :active, and a
// computed background is a declaration, not what painted.

/**
 * The trigger's SETTLED fill, at a point inside its 4px padding clear of the
 * glyph.
 *
 * Icon eases background-color over 200ms, so one read lands mid-transition:
 * the first draft sampled a "press" of #DEE1E5 in Light, where the pressed
 * token is #B3B6B9, and every comparison built on it was noise. Reads until
 * two in a row, a full transition apart, agree.
 */
async function fillOf(page: Page, trigger: Locator): Promise<string> {
  const box = (await trigger.boundingBox())!;
  const read = async () => (await pixelsAt(page, [[box.x + 2, box.y + 2]]))[0];
  let previous = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const current = await read();
    if (current === previous) return current;
    previous = current;
  }
  throw new Error(`trigger fill never settled (last ${previous})`);
}

async function open(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string,
  theme: 'Light' | 'Darkenheimer'
): Promise<Page> {
  await seedSettings(context, {
    theme,
    isNeverAskAgainForTabGroups: true,
    isNeverAskAgainToRate: true,
  });
  await seedSessions(context, {
    ...buildContainer([
      buildSession({ tabGroupId: 's0', title: 'A session', isSelected: true }),
    ]),
    selectedTabGroupId: 's0',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

/** Rest, then the press itself, then releases -- which opens the menu. */
async function restAndPress(page: Page, trigger: Locator) {
  await page.mouse.move(0, 0);
  const rest = await fillOf(page, trigger);
  const box = (await trigger.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const pressed = await fillOf(page, trigger);
  await page.mouse.up();
  // CONTROL: if pressing painted nothing, "open looks pressed" would also
  // pass for "open looks like rest".
  expect(pressed).not.toBe(rest);
  return { rest, pressed };
}

for (const theme of ['Light', 'Darkenheimer'] as const) {
  test(`the session menu's trigger stays pressed while its menu is open (${theme})`, async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, theme);
    // Scoped to the right pane: since KAN-208 the save row's menu carries
    // the same name, so a locator on the name alone matches two controls
    // and strict mode refuses it.
    const trigger = sessionHeaderMenu(page);
    await expect(trigger).toBeVisible();

    const { pressed } = await restAndPress(page, trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // The pointer goes where it goes next: onto the menu, off the trigger.
    await page.getByRole('menuitem').first().hover();
    expect(await fillOf(page, trigger)).toBe(pressed);
  });
}

test('the sort trigger stays pressed while its menu is open', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'Light');
  const trigger = page.getByRole('button', { name: 'Sort sessions' });
  await expect(trigger).toBeVisible();

  const { pressed } = await restAndPress(page, trigger);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('menu').hover();
  expect(await fillOf(page, trigger)).toBe(pressed);
});

test('opened from the keyboard, the trigger fills with no pointer on it', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'Light');
  // Scoped to the right pane: since KAN-208 the save row's menu carries
  // the same name, so a locator on the name alone matches two controls
  // and strict mode refuses it.
  const trigger = sessionHeaderMenu(page);
  await expect(trigger).toBeVisible();
  const { rest, pressed } = await restAndPress(page, trigger);
  // Close the menu the mouse opened, and park the pointer away from it.
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.mouse.move(0, 0);
  expect(await fillOf(page, trigger)).toBe(rest);

  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(await fillOf(page, trigger)).toBe(pressed);
});
