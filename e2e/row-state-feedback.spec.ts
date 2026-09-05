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

    // Reveal the second row's actions with focus rather than the pointer.
    // .focus() rather than a Tab walk on purpose: :focus-within does not
    // distinguish the two, and this spec is about styling, not reachability
    // (which KAN-68's tab-order specs already cover).
    const open = actionsIn(second).getByRole('button', { name: 'Open' });
    await open.focus();

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
});
