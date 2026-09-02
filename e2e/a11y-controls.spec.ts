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

// The title is deliberately left as "Research" even though it substring-
// matches the "search" control: `getByRole(name:)` matches a SUBSTRING unless
// `exact: true` is passed, and this fixture is the cheapest standing reminder
// of that. It is the same hazard golden-path.spec.ts:138 already guards
// against, where the ligature text "arrow_back" substring-matches "Back".
// KAN-64 made it bite for real, because the session row is now a button named
// after its title.
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

    await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(1);
  });

  test('the settings back control is a button with an accessible name (KAN-56)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Go back' })).toHaveCount(1);
  });

  test('the search back control is a button with an accessible name (KAN-56)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('input#searchInput')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Go back' })).toHaveCount(1);
  });

  test('the search control is a button with an accessible name (KAN-56)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    await expect(
      page.getByRole('button', { name: 'Search', exact: true })
    ).toHaveCount(1);
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
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();

    await expect(
      page.getByRole('button', { name: 'Go back' })
    ).toMatchAriaSnapshot(`- button "Go back": Back`);
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

      await page.getByRole('button', { name: 'Settings' }).focus();
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

    await page.getByRole('button', { name: 'Settings' }).focus();
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
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByText('Themes')).toBeVisible();

      await page.getByRole('button', { name: 'Go back' }).focus();
      await page.keyboard.press(key);

      await expect(page.locator('input#name')).toBeVisible();
    });
  }
});

// Clicks the session row near its left edge, over the title, rather than at
// its geometric centre.
//
// The Open/Switch/Delete block is absolutely positioned over the right-hand
// ~170px of a ~321px row and appears on hover, so the centre of the row is
// underneath it. Nothing about that changed in KAN-64 -- the same pixels
// belonged to the same icons before -- but the DOM relationship did: those
// icons used to be DESCENDANTS of the clickable container, and Playwright
// permits a click whose hit target is a descendant of the locator. Now that
// the action is on an inner ClickableRow they are SIBLINGS, so the same click
// is reported as intercepted.
//
// A user selects a session by clicking its title, which is what this does.
async function selectSession(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Research' })
    .click({ position: { x: 20, y: 20 } });
}

// Walks the real tab order from the top of the document and returns the
// accessible name of each stop. This is the only way to test reachability
// honestly: `locator.focus()` succeeds on a tabindex=-1 element, so a test
// that focuses a control directly proves nothing about whether a keyboard
// user could ever have got there.
async function tabOrderNames(page: Page, steps: number): Promise<string[]> {
  await page.locator('body').press('Tab');
  const names: string[] = [];
  for (let i = 0; i < steps; i++) {
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return '<body>';
        // Accessible-name precedence, simplified to the three sources this app
        // actually uses: aria-label, then content, then title. `title` is not
        // decoration here -- the theme buttons carry no aria-label and no text,
        // so it is the only name they have.
        return (
          el.getAttribute('aria-label') ||
          el.textContent?.trim() ||
          el.getAttribute('title') ||
          '<unnamed>'
        );
      })
    );
    await page.keyboard.press('Tab');
  }
  return names;
}

test.describe('controls are reachable by keyboard', () => {
  // KAN-64. Four list rows were `tabIndex={0}` divs with an onClick and no
  // role: they took a tab stop, were exposed as `generic` -- where ARIA
  // PROHIBITS naming, so the name was dropped -- and ignored Space.
  //
  // These have to run in a real browser for the same reason the KAN-56
  // assertions do: dom-accessibility-api names a role-less div happily, so a
  // jsdom version of `getByRole('button', { name })` is green against the
  // broken code.
  test('the session row is a button with an accessible name (KAN-64)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    await expect(page.getByRole('button', { name: 'Research' })).toHaveCount(1);
  });

  test('the settings category row is a button with an accessible name (KAN-64)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings' }).click();

    // "Display" is the category ROW; "Themes" is a heading inside the pane it
    // opens. The row is the control KAN-64 is about.
    await expect(page.getByRole('button', { name: 'Display' })).toHaveCount(1);
  });

  test('the window and tab rows are buttons with accessible names (KAN-64)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await selectSession(page);

    await expect(
      page.getByRole('button', { name: 'Morning reading' })
    ).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Open in new tab: Example Domain' })
    ).toHaveCount(1);
  });

  // Enter is the control. It worked before this change on every one of these
  // rows, so a Space failure is a gap in the row's own key handling rather
  // than in the way this test drives the keyboard.
  for (const key of ['Enter', 'Space'] as const) {
    test(`the session row is operable with ${key} (KAN-64)`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);

      await page.getByRole('button', { name: 'Research' }).focus();
      await page.keyboard.press(key);

      await expect(
        page.getByRole('button', { name: 'Morning reading' })
      ).toBeVisible();
    });
  }

  // KAN-68. These eight controls had `focusable` wired to mouse-hover state,
  // so they were never in the tab order at all. Asserted by walking the real
  // tab order rather than by focusing them directly.
  test('session row actions are reachable by Tab (KAN-68)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);

    const names = await tabOrderNames(page, 12);

    expect(names).toContain('Open');
    expect(names).toContain('Switch');
    expect(names).toContain('Delete');
  });

  // Delete tab and Delete window group are the two that matter most: unlike
  // the session actions, they have no alternate path anywhere in the UI, so
  // before this change they could not be performed without a mouse at all.
  test('window and tab actions are reachable by Tab (KAN-68)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await selectSession(page);
    await expect(
      page.getByRole('button', { name: 'Morning reading' })
    ).toBeVisible();

    const names = await tabOrderNames(page, 20);

    expect(names).toContain('Delete window group');
    expect(names).toContain('Delete tab');
  });

  // The other half of KAN-68: being in the tab order is useless if focus
  // lands on something painted at opacity 0. Hover is a pointer-only signal,
  // so :focus-within is what reveals these to a keyboard user.
  test('focusing a row action reveals it (KAN-68)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const actions = page.locator('div:has(> [aria-label="Delete"])');

    // The control: unfocused and unhovered, the block really is invisible, so
    // the assertion below can tell the two states apart.
    await expect(actions).toHaveCSS('opacity', '0');

    await page.getByRole('button', { name: 'Delete', exact: true }).focus();

    await expect(actions).toHaveCSS('opacity', '1');
  });

  // KAN-67. `focusableButton` had no default, so `tabIndex={onClick &&
  // focusableButton ? 0 : -1}` put 32 of 36 clickable Buttons out of the tab
  // order -- the whole settings pane among them.
  test('settings buttons are reachable by Tab (KAN-67)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Themes')).toBeVisible();

    const names = await tabOrderNames(page, 25);

    expect(names.join('|')).toMatch(/Light/);
  });
});
