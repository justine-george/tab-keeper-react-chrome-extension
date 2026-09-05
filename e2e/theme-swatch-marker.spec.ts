import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';

// KAN-95. The active theme swatch was marked with `outline: 2px solid
// TEXT_COLOR; outline-offset: 2px`, which is wrong in two separable ways.
//
// Too loud: TEXT_COLOR against the page is 9.2-13.8:1, focus-ring weight for
// a passive state marker. Contrast was the right axis to measure and the wrong
// one to maximise -- the same mistake as KAN-87's accent bar, rejected on
// sight within the hour for the same reason.
//
// Cramped: 2px of outline plus 2px of offset is 4px of ring, and the swatches
// sit in a flex row with gap: 4px, so the ring consumed the whole gap and
// touched its neighbours. Each swatch also carries its own 1px border, so the
// active one drew two concentric lines with a space between them.
//
// The marker is now the swatch's OWN border, thickened. One line instead of
// two, nothing drawn outside the box, so the collision cannot recur by
// construction. box-sizing: border-box keeps the swatch the same size as it
// thickens -- avoiding the layout shift that made KAN-88 reach for an outline
// in the first place.
//
// Asserted at every swatch rather than only the active one: "the active
// swatch differs" is satisfied by a build where ALL of them are 2px, which is
// no marker at all.

async function openThemes(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await expect(page.getByText('Themes')).toBeVisible();
  return page;
}

const THEMES = ['Light', 'Warm Light', 'BB Pink', 'Darkenheimer', 'Blue'];

const swatch = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true });

async function markerOf(
  s: Locator
): Promise<{ border: string; outline: string; width: number }> {
  return s.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      border: cs.borderTopWidth,
      outline: cs.outlineStyle,
      width: el.getBoundingClientRect().width,
    };
  });
}

test.describe('the active theme swatch is marked by its own border', () => {
  test('only the active swatch is thickened, and no outline is drawn', async ({
    context,
    extensionId,
  }) => {
    const page = await openThemes(context, extensionId);

    // Pick a theme explicitly rather than trusting whatever the profile had.
    await swatch(page, 'BB Pink').click();
    await expect(swatch(page, 'BB Pink')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    const active = await markerOf(swatch(page, 'BB Pink'));

    expect(
      active.border,
      'the active swatch should carry a thicker border'
    ).toBe('2px');
    expect(
      active.outline,
      'no outline at all -- an outline is drawn outside the box and is what ' +
        'collided with the neighbouring swatches'
    ).toBe('none');

    // CONTROL: every other swatch stays thin. Without this the assertion above
    // passes on a build where all five are 2px, which marks nothing.
    for (const name of THEMES.filter((n) => n !== 'BB Pink')) {
      const other = await markerOf(swatch(page, name));
      expect(
        other.border,
        `${name} is not active and should keep the thin border`
      ).toBe('1px');
      expect(other.outline, `${name} should have no outline`).toBe('none');
    }
  });

  test('thickening the border does not resize the swatch', async ({
    context,
    extensionId,
  }) => {
    const page = await openThemes(context, extensionId);

    // The width of one swatch while it is NOT active, then while it is. This
    // is the whole reason KAN-88 used an outline: a border that changes the
    // box shoves the other four sideways as selection moves. box-sizing:
    // border-box is what makes the border safe to use here, and this is the
    // assertion that holds it to that.
    await swatch(page, 'Light').click();
    const inactive = (await markerOf(swatch(page, 'Blue'))).width;

    await swatch(page, 'Blue').click();
    await expect(swatch(page, 'Blue')).toHaveAttribute('aria-pressed', 'true');
    const activeWidth = (await markerOf(swatch(page, 'Blue'))).width;

    expect(
      activeWidth,
      'the swatch must not change size when it activates'
    ).toBe(inactive);
  });
});
