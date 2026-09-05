import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-92. A session row shows two things when you engage with it: it REVEALS
// its Open/Switch/Delete actions, and it FILLS with the hover colour. Those
// were driven by two independent mechanisms and could disagree.
//
//   reveal (the action block's opacity) <- React `isHovered` state, OR the
//                                          block's own :focus-within
//   fill   (the row's inset box-shadow) <- the container's :hover, and only
//                                          :hover
//
// The three action Icons each paint an opaque background of HOVER_COLOR --
// load-bearing, because the block is absolutely positioned over the title and
// has to mask it. So when the reveal fires without the fill, that background
// becomes a hover-coloured strip glued to the right of a row that is not
// hovered, with a hard vertical edge cutting the title in half.
//
// Reachable two ways, both real:
//   1. Keyboard. Tab to an action: :focus-within reveals, :hover is false.
//      That is what this spec pins, because it is deterministic.
//   2. Mouse. onMouseLeave does not fire when the pointer leaves the window
//      abruptly -- pressing a screenshot hotkey does exactly that -- so the
//      React state stays true while :hover drops in the same frame. Not
//      pinned here: leaving the OS window is not something Playwright can
//      stage honestly.
//
// The assertion compares against a genuinely hovered row rather than against
// a hard-coded rgb(). A literal would pin the LIGHT palette and go green on a
// fix that filled the row with the wrong colour; the comparison says the only
// thing that matters, which is that the two states agree.

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
const rowFor = (page: Page, title: string): Locator =>
  page.getByRole('button', { name: title, exact: true }).locator('..');

/** The absolutely-positioned Open/Switch/Delete block inside a row. */
const actionsIn = (row: Locator): Locator => row.locator('> div').last();

const fillOf = (row: Locator): Promise<string> =>
  row.evaluate((el) => getComputedStyle(el).boxShadow);

const TRANSPARENT = /rgba\(0, 0, 0, 0\)/;

// The fill eases in over 0.2s (KAN-82 keeps the transition on the shadow
// precisely so hover CAN ease), so reading it the moment the state changes
// catches a partial alpha -- the first run of this spec captured
// `rgba(223, 226, 230, 0.224)` and would have compared two arbitrary points
// on the curve. A settled opaque colour serialises as `rgb(...)`; every
// in-flight frame and the transparent start state serialise as `rgba(...)`,
// so waiting for the absence of an alpha channel is exactly "the transition
// has finished".
async function settledFillOf(row: Locator): Promise<string> {
  await expect
    .poll(() => fillOf(row), {
      message: 'the row fill should settle to a fully opaque colour',
    })
    .not.toMatch(/rgba\(/);
  return fillOf(row);
}

/**
 * Press Tab until `target` holds focus.
 *
 * A real key press, not `.focus()`, because engagement keys off
 * :focus-visible and Chrome decides that from the PRECEDING interaction --
 * after a mouse move, a programmatic focus does not set it. `.focus()` would
 * therefore test a state no keyboard user can reach, and would pass against
 * code that never engages on Tab at all.
 *
 * Walking rather than pressing a fixed count: the number of stops ahead of
 * this control is an unrelated fact about the header and the rows above it,
 * and hard-coding it turns any change there into a failure here.
 */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxPresses = 40
): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached the target in ${maxPresses} presses`);
}

test.describe('a row reveals its actions and fills as one state', () => {
  test('a row whose actions the keyboard revealed is filled like a hovered one', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const first = rowFor(page, 'First session');
    const second = rowFor(page, 'Second session');

    // What a genuinely hovered row looks like. Playwright's hover is a real
    // mouse move, so this is the actual :hover rendering, not a synthesized
    // event -- which is why this spec can compare against it at all.
    await first.hover();
    const hoveredFill = await settledFillOf(first);

    // CONTROL for the comparison: hovering really does change the fill. If
    // this were transparent the main assertion could pass against a row that
    // is never filled in any state.
    expect(
      hoveredFill,
      'a hovered row should carry a non-transparent fill'
    ).not.toMatch(TRANSPARENT);

    // Park the pointer off every row, so nothing below is hover-driven.
    await page.mouse.move(0, 0);
    expect(
      await fillOf(second),
      'CONTROL: an untouched row starts unfilled'
    ).toMatch(TRANSPARENT);

    // Reveal the second row's actions with a REAL Tab press, not .focus().
    // KAN-94: engagement now keys off :focus-visible, and Chrome decides that
    // from the preceding interaction -- a programmatic .focus() after a mouse
    // move does not set it. So .focus() would test a state no keyboard user
    // can be in, and would go green against code that never engages on Tab.
    const open = actionsIn(second).getByRole('button', { name: 'Open' });
    await tabUntilFocused(page, open);

    // The reveal happened -- without this the fill assertion could go green
    // simply because nothing was showing.
    await expect(actionsIn(second)).toHaveCSS('opacity', '1');

    await expect
      .poll(() => fillOf(second), {
        message:
          'a row showing its actions must fill the same as a hovered row',
      })
      .toBe(hoveredFill);
  });

  // KAN-94, a regression from the fix above. Collapsing reveal and fill onto
  // one condition was right; :focus-within was the wrong condition. It matches
  // ANY focus, including the focus a mouse click leaves behind -- so clicking a
  // row engaged it indefinitely, and with no focus ring on a click there was
  // nothing on screen to explain why. Reported as "why is hover state sticky".
  //
  // :focus-visible is the distinction that was wanted all along: the browser
  // already decides whether a given focus deserves a visible indicator, and it
  // says no for a click. Measured on the broken build with the pointer parked
  // away: :focus-within true, :has(:focus-visible) false, actions opacity 1.
  test('a row clicked with the mouse does not stay engaged once the pointer leaves', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const first = rowFor(page, 'First session');

    await first.click({ position: { x: 20, y: 20 } });

    // CONTROL: the click really did leave focus inside the row. Without this
    // the test could pass on a build where clicking focuses nothing at all,
    // which is a different app, not a fixed one.
    expect(
      await first.evaluate((el) => el.matches(':focus-within')),
      'the click should leave focus inside the row -- otherwise this test ' +
        'proves nothing about focus-driven stickiness'
    ).toBe(true);

    await page.mouse.move(0, 0);

    await expect
      .poll(
        () => actionsIn(first).evaluate((el) => getComputedStyle(el).opacity),
        {
          message:
            'a clicked row must not keep showing its actions after the pointer leaves',
        }
      )
      .toBe('0');
  });

  // KAN-98. The action strip must never disagree with the row it masks.
  //
  // Icon carries `transition: background-color 0.2s` for its OWN hover, and
  // TabGroupEntry was relaying the ROW's state colour through that same
  // property. So on click the row's background snapped to the selection colour
  // while the strip eased toward it over 200ms -- 20 measured frames with a
  // hard vertical seam down the middle of the row.
  //
  // Asserted as agreement between the two, sampled every frame, rather than
  // against literal colours: the invariant is that the mask matches what it is
  // masking, whatever the palette says those colours are.
  test('the action strip never disagrees with the row it masks', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const first = rowFor(page, 'First session');
    const second = rowFor(page, 'Second session');

    await first.click({ position: { x: 20, y: 20 } });
    await second.hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(350);

    await page.evaluate(() => {
      const button = Array.from(
        document.querySelectorAll('button[aria-label]')
      ).find((b) => b.getAttribute('aria-label') === 'Second session');
      const row = button!.parentElement!;
      const actions = row.lastElementChild!;
      const seen: { row: string; strip: string }[] = [];
      (window as unknown as { __pairs: typeof seen }).__pairs = seen;

      // The row's fill lives in TWO places by design (KAN-82): a selected row
      // paints background-color, an unselected hovered one paints an inset
      // box-shadow. Comparing background to background would therefore report
      // a false disagreement on every hovered-unselected frame. What the eye
      // sees is whichever of the two is painted, so that is what the strip
      // must match.
      const effectiveFill = (el: Element): string => {
        const cs = getComputedStyle(el);
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
          return cs.backgroundColor;
        const shadow = cs.boxShadow.match(/rgba?\([^)]*\)/);
        return shadow ? shadow[0] : cs.backgroundColor;
      };

      const tick = () => {
        seen.push({
          row: effectiveFill(row),
          strip: getComputedStyle(actions).backgroundColor,
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await second.click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(500);

    const pairs = await page.evaluate(
      () =>
        (window as unknown as { __pairs: { row: string; strip: string }[] })
          .__pairs
    );

    // CONTROL: the sampler ran across the state change, so an empty
    // disagreement list cannot mean it never observed anything.
    expect(
      new Set(pairs.map((p) => p.row)).size,
      'the row background should have changed during the sample window'
    ).toBeGreaterThan(1);

    const disagreeing = pairs.filter((p) => p.row !== p.strip);

    expect(
      disagreeing.length,
      `the strip must track the row exactly; saw ${disagreeing.length} ` +
        `frames where they differed, e.g. row ${disagreeing[0]?.row} vs ` +
        `strip ${disagreeing[0]?.strip}`
    ).toBe(0);
  });
});
