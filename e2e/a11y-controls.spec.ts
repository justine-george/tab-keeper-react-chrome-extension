import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// These specs assert on ROLE plus accessible name, never on the raw
// `[aria-label=...]` attribute. That distinction is the whole point of
// KAN-56: an `aria-label` on a div with no role sits on the implicit
// `generic` role, where naming is prohibited, so assistive tech drops it --
// while a CSS attribute selector still matches it happily. A test written
// against the attribute passes against the broken code and proves nothing.
//
// jsdom is not an option here for the same reason. `dom-accessibility-api`,
// which backs Testing Library's `getByRole(name:)`, computes a name from
// `aria-label` without applying the prohibition, so a vitest version of these
// assertions would be green today.

const RESEARCH = buildSession({
  tabGroupId: 'session-research',
  title: 'Research',
});

async function openPopup(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context, buildContainer([RESEARCH]));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

test.describe('accessible controls', () => {
  // The control for every negative assertion below. It exercises the same
  // component (Icon), the same prop (ariaLabel) and the same query, differing
  // only in that this Icon owns its own onClick and so renders role="button".
  // If this test ever fails, a zero count elsewhere in this file means the
  // harness is broken, not that the app is.
  test('CONTROL: an Icon that owns its onClick is exposed as a named button', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    await expect(page.getByRole('button', { name: 'settings' })).toHaveCount(1);
  });

  test('the settings back control is a button with an accessible name (KAN-56)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();

    await expect(page.getByRole('button', { name: 'go back' })).toHaveCount(1);
  });

  test('the search back control is a button with an accessible name (KAN-56)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'search' }).click();
    await expect(page.locator('input#searchInput')).toBeVisible();

    await expect(page.getByRole('button', { name: 'back' })).toHaveCount(1);
  });

  test('the search control is a button with an accessible name (KAN-56)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    await expect(page.getByRole('button', { name: 'search' })).toHaveCount(1);
  });

  // The other half of the Icon change: a presentational icon is hidden from
  // the tree, not merely unnamed. Material Symbols renders its glyph as
  // ligature TEXT, so without aria-hidden this button's content reads
  // "arrow_back Back" -- which is exactly why golden-path.spec.ts:138 has to
  // pass `exact: true` to stop "arrow_back" substring-matching "Back".
  test('a presentational icon is hidden from the accessibility tree (KAN-56)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();

    await expect(
      page.getByRole('button', { name: 'go back' })
    ).toMatchAriaSnapshot(`- button "go back": Back`);
  });

  // Icon renders div[role=button] rather than a real <button>, because
  // Button.tsx nests an Icon inside its own <button> and nested buttons are
  // invalid HTML. That means its key handling is hand-rolled, and a
  // hand-rolled handler is exactly where Space gets forgotten. Enter is the
  // control: it passes today, so a Space failure is a gap in the handler
  // rather than in the way this test drives the keyboard.
  for (const key of ['Enter', 'Space'] as const) {
    test(`an Icon button is operable with ${key}`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);

      await page.getByRole('button', { name: 'settings' }).focus();
      await page.keyboard.press(key);

      await expect(page.getByText('Themes')).toBeVisible();
    });
  }

  // Space on a role=button that does not preventDefault scrolls the page --
  // the classic hand-rolled-button bug. Asserted on defaultPrevented rather
  // than on scroll position, because the popup is short enough that there may
  // be nothing to scroll, which would make a scroll assertion pass for the
  // wrong reason. The listener goes on document in the bubble phase, so it
  // runs after React's root handler has had its say.
  test('Space on an Icon button does not also scroll the page', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    await page.evaluate(() => {
      (window as unknown as { prevented: boolean[] }).prevented = [];
      document.addEventListener('keydown', (e) => {
        (window as unknown as { prevented: boolean[] }).prevented.push(
          e.defaultPrevented
        );
      });
    });

    await page.getByRole('button', { name: 'settings' }).focus();
    await page.keyboard.press('Space');

    const prevented = await page.evaluate(
      () => (window as unknown as { prevented: boolean[] }).prevented
    );
    expect(prevented).toEqual([true]);
  });

  // KAN-62. The settings back affordance carries tabIndex={0} and an onClick
  // but no key handler, so it takes focus and then does nothing -- WCAG 2.1.1,
  // Level A. Enter and Space are asserted separately because a handler that
  // covers only Enter (as the search pane's does) still fails a user who
  // reaches for Space, which is what a real button honours.
  for (const key of ['Enter', 'Space'] as const) {
    test(`the settings back control is operable with ${key} (KAN-62)`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await page.getByRole('button', { name: 'settings' }).click();
      await expect(page.getByText('Themes')).toBeVisible();

      await page.getByRole('button', { name: 'go back' }).focus();
      await page.keyboard.press(key);

      await expect(page.locator('input#name')).toBeVisible();
    });
  }
});
