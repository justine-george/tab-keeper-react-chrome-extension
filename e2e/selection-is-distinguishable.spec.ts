import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-87. Hover and selection were told apart only by lightness, and by
// almost none of it: SELECTION_COLOR against HOVER_COLOR is 1.21:1 on Light
// and 1.04:1 on Blue, where WCAG 1.4.11 asks 3:1 for a state a user has to
// distinguish. So hovering an unselected row made it look selected, and with
// two rows looking selected there was no way to tell which one the right pane
// was actually showing.
//
// The mechanism was never the problem -- KAN-82 correctly split selection
// (background-color, settled) from hover (inset box-shadow, eased), and that
// still holds. The two properties were simply painted almost the same colour.
//
// No colour-only fix reaches 3:1 without making a selected row the LIGHTEST
// thing in the pane, which inverts the visual hierarchy. So selection gains a
// second cue of a different KIND -- a shape -- and that is what these specs
// assert. A test that compared two fills could be satisfied by a palette tweak
// that is still under 3:1; asserting on the bar's presence cannot be.
//
// The bar is a ::before, deliberately. ::after is reserved for the
// drop-indicator line that drag-and-drop reordering will need, and an extra
// inset box-shadow would recreate KAN-82 the moment a drag transition lands.
//
// Both panes are covered in one file on purpose: the defect was in the shared
// palette, not in either component, so a per-component spec would have let the
// two drift apart again.

async function openPopup(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(
    context,
    buildContainer([
      buildSession({ tabGroupId: 'first', title: 'First session' }),
      buildSession({ tabGroupId: 'second', title: 'Second session' }),
    ])
  );
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}

/** The session row's container is the parent of its ClickableRow button. */
const sessionRow = (page: Page, title: string): Locator =>
  page.getByRole('button', { name: title, exact: true }).locator('..');

/**
 * The marker the selected row carries and a hovered one must not.
 *
 * Read off ::before rather than off the row: `width` on a pseudo-element that
 * was never generated computes to `auto`, so "no bar" and "a bar of zero
 * width" are distinguishable, and a fix that drew the element but left it
 * invisible cannot pass.
 */
async function accentBar(
  row: Locator
): Promise<{ width: string; color: string }> {
  return row.evaluate((el) => {
    const cs = getComputedStyle(el, '::before');
    return { width: cs.width, color: cs.backgroundColor };
  });
}

const barIsDrawn = (bar: { width: string; color: string }): boolean =>
  /^\d+(\.\d+)?px$/.test(bar.width) &&
  parseFloat(bar.width) > 0 &&
  bar.color !== 'rgba(0, 0, 0, 0)';

test.describe('selection is distinguishable from hover by shape', () => {
  test('a selected session row carries an accent bar and a hovered one does not', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    const first = sessionRow(page, 'First session');
    const second = sessionRow(page, 'Second session');

    await first.click({ position: { x: 20, y: 20 } });

    // Hover the OTHER row -- the exact situation that was ambiguous: one row
    // selected, a different one under the pointer.
    await second.hover();

    expect(
      barIsDrawn(await accentBar(first)),
      'the selected row should carry an accent bar'
    ).toBe(true);

    expect(
      barIsDrawn(await accentBar(second)),
      'CONTROL: a hovered but unselected row must NOT carry one, or the bar ' +
        'would say nothing about which row is selected'
    ).toBe(false);
  });

  test('a selected settings category carries an accent bar and a hovered one does not', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await page.locator('[aria-label="Settings"]').click();

    // Settings categories are real <button>s (KAN-64), named by their own
    // translated label.
    const selected = page.getByRole('button', { name: 'Sync & Privacy' });
    const other = page.getByRole('button', { name: 'Data Management' });

    await selected.click();
    await other.hover();

    expect(
      barIsDrawn(await accentBar(selected)),
      'the selected category should carry an accent bar'
    ).toBe(true);

    expect(
      barIsDrawn(await accentBar(other)),
      'CONTROL: a hovered but unselected category must NOT carry one'
    ).toBe(false);
  });
});
