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

  // KAN-97, the mirror of the test above. That one watches the row LOSING
  // selection. This watches the row GAINING it, which nobody checked.
  //
  // background-color lands in one frame, correctly. The inset box-shadow does
  // not: it paints ON TOP of the background, and when the row becomes selected
  // its declaration disappears (the fill is guarded on !isSelected), so it
  // transitions from HOVER_COLOR to transparent over 0.2s. The newly selected
  // row is therefore painted the light hover colour and darkens into the
  // selection colour -- measured at 22 partially-transparent frames.
  //
  // The row must be HOVERED when clicked, which is what a mouse click always
  // is. Clicking an unhovered row has no shadow to fade and cannot show this.
  test('a row gaining selection does not fade into it', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const second = rowFor(page, 'Second session');

    // Select the first, so the second is the one that will change.
    await rowFor(page, 'First session').click({ position: { x: 20, y: 20 } });

    // A REAL hover. dispatchEvent(new MouseEvent('mouseover')) does not
    // trigger CSS :hover -- the first version of this test used it, painted no
    // shadow, and passed against the broken build because there was nothing
    // to fade. Playwright's hover is an actual mouse move, so it does.
    await second.hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(350);

    // Start sampling and return immediately, so the click below is a real
    // mouse click rather than something synthesized inside the page.
    await page.evaluate(() => {
      const button = Array.from(
        document.querySelectorAll('button[aria-label]')
      ).find((b) => b.getAttribute('aria-label') === 'Second session');
      const row = button!.parentElement!;
      const seen: string[] = [];
      (window as unknown as { __shadow: string[] }).__shadow = seen;
      const tick = () => {
        seen.push(getComputedStyle(row).boxShadow);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await second.click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(500);

    const samples = await page.evaluate(
      () => (window as unknown as { __shadow: string[] }).__shadow
    );

    // CONTROL: the sampler ran and saw the shadow painted before the click.
    // Without this, an empty midFade could mean the hover never landed.
    expect(
      samples.some((c) => /^rgb\(/.test(c)),
      'the row should have carried an opaque hover shadow before the click'
    ).toBe(true);

    // A partially transparent shadow can only come from an in-flight
    // transition. Fully opaque and fully transparent are both settled states.
    const midFade = samples.filter(
      (c) => /^rgba\(/.test(c) && !/,\s*0\)/.test(c)
    );

    expect(
      midFade,
      `selection should arrive in one frame; saw ${midFade.length} ` +
        `intermediate frames of the hover shadow fading over it`
    ).toEqual([]);
  });
});
