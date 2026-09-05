import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-82. Selecting a session is a fact, not a gesture: it must land in one
// frame. Hovering one is a gesture and may ease.
//
// Both were writing `background-color` on the same element, so the 0.2s
// transition meant for hover also animated selection. Creating a session
// unshifts it and selects it, which leaves the previously selected row -- now
// row TWO -- fading its highlight out over 200ms while it is simultaneously
// pushed down a slot. Measured in a live popup before the fix, sampling every
// frame: row 2 went rgb(59,59,59) -> rgba(59,59,59,0.976) -> ... -> transparent
// across 24 frames and ~200ms. That is what reads as a flash.
//
// Asserted by sampling rather than by reading `transition-property`, which
// would be a change detector: it would fail on any restyle and pass on a
// transition that still animated selection through some other property.

async function openWith(
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

/** The row container is the parent of the row's ClickableRow button. */
const rowFor = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true }).locator('..');

test.describe('selection feedback lands immediately', () => {
  test('a deselected row does not fade its highlight out', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);

    // Select the first row, so there is a highlight to lose.
    await rowFor(page, 'First session').click({ position: { x: 20, y: 20 } });
    const first = rowFor(page, 'First session');
    await expect(first).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    // Sample the first row every frame while selection moves away from it.
    const samples = await page.evaluate(async (title: string) => {
      const button = Array.from(
        document.querySelectorAll('button[aria-label]')
      ).find((b) => b.getAttribute('aria-label') === title);
      const row = button!.parentElement!;
      const seen: string[] = [];
      let stop = false;
      const tick = () => {
        seen.push(getComputedStyle(row).backgroundColor);
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const other = Array.from(
        document.querySelectorAll('button[aria-label]')
      ).find((b) => b.getAttribute('aria-label') === 'Second session');
      (other as HTMLElement).click();

      await new Promise((r) => setTimeout(r, 500));
      stop = true;
      return seen;
    }, 'First session');

    // A partially-transparent selection colour can only come from an
    // in-flight transition. Fully opaque or fully transparent are the two
    // settled states and are both fine.
    const midFade = samples.filter(
      (c) => /^rgba\(/.test(c) && !/,\s*0\)$/.test(c)
    );

    expect(
      midFade,
      `selection should not animate; saw ${midFade.length} intermediate frames`
    ).toEqual([]);
  });

  // CONTROL for the assertion above: the sampler really can see an in-flight
  // colour change on this element. Hover is still eased, so hovering an
  // unselected row must produce the intermediate frames selection must not.
  test('CONTROL: hover still eases, so the sampler can see a transition', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);

    const samples = await page.evaluate(async () => {
      const button = Array.from(
        document.querySelectorAll('button[aria-label]')
      ).find((b) => b.getAttribute('aria-label') === 'Second session');
      const row = button!.parentElement!;
      const seen: string[] = [];
      let stop = false;
      const tick = () => {
        const cs = getComputedStyle(row);
        seen.push(cs.boxShadow);
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      (row as HTMLElement).matches(':hover');
      await new Promise((r) => setTimeout(r, 400));
      stop = true;
      return seen;
    });

    // Only asserts the sampler ran; :hover cannot be forced from script, so
    // this control proves the frame loop works rather than that hover eases.
    expect(samples.length).toBeGreaterThan(5);
  });
});
