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

/**
 * How revealed the row's actions are, as an opacity string.
 *
 * Read from an ICON, not from the block (KAN-100). The block carries the
 * opaque mask and must land in one frame, so it no longer fades and its own
 * opacity is now 1 in every state. Asserting on the block would therefore be
 * trivially true and would go green against a build that never reveals
 * anything -- which is exactly what it did on the first run of this change.
 */
const revealOf = (row: Locator): Promise<string> =>
  actionsIn(row)
    .locator('> *')
    .first()
    .evaluate((el) => getComputedStyle(el).opacity);

type SeamFrame = { left: string; right: string };

/**
 * Start sampling, every animation frame, what the eye sees on each side of the
 * edge where the action strip begins.
 *
 * Composited, not declared (KAN-100). The strip's declared background IS the
 * row's destination colour the whole time, so comparing declared values sees
 * two identical strings and reports agreement even while the halves visibly
 * differ. What matters is the strip's paint attenuated by the opacity revealing
 * it, over whatever the row is currently showing.
 */
async function startSeamSampler(
  page: Page,
  rowLabel: string,
  /**
   * Where the strip sits relative to the labelled button. In a session row the
   * button IS the row's left column and the strip is the row's last child; in
   * a right-pane window row the labelled button is one of the strip's own
   * icons, so the strip is its parent and the row is the strip's parent.
   */
  kind: 'session' | 'window' = 'session'
): Promise<void> {
  const surface = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor
  );
  // CONTROL: compositing against the page needs an opaque page. A transparent
  // body would collapse every composite to the same value and the assertions
  // below could not fail.
  expect(
    surface,
    'the page needs an opaque background to composite against'
  ).not.toMatch(TRANSPARENT);

  await page.evaluate(
    ([label, pageColor, rowKind]: [string, string, string]) => {
      // Both shapes, because Icon renders a `div role="button"` rather than a
      // native <button> (it hand-rolls Enter AND Space), while ClickableRow
      // renders a real one. A `button[aria-label]` selector silently matches
      // nothing for a window row's icons.
      const button = Array.from(
        document.querySelectorAll(
          'button[aria-label], [role="button"][aria-label]'
        )
      ).find((b) => b.getAttribute('aria-label') === label);
      const row =
        rowKind === 'window'
          ? button!.parentElement!.parentElement!
          : button!.parentElement!;
      const actions =
        rowKind === 'window' ? button!.parentElement! : row.lastElementChild!;

      type Rgba = { r: number; g: number; b: number; a: number };
      const parse = (c: string): Rgba | null => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const over = (fg: Rgba | null, bg: Rgba): Rgba =>
        fg === null
          ? bg
          : {
              r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
              g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
              b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
              a: 1,
            };
      const show = (c: Rgba) => `rgb(${c.r},${c.g},${c.b})`;

      // The row's fill lives in two places by design (KAN-82): background-color
      // when selected, an inset shadow when hovered-unselected. Whichever is
      // painted is what the eye sees, so that is what gets composited.
      const paintOf = (el: Element): Rgba | null => {
        const cs = getComputedStyle(el);
        const bg = parse(cs.backgroundColor);
        if (bg && bg.a > 0) return bg;
        const shadow = cs.boxShadow.match(/rgba?\([^)]*\)/);
        return shadow ? parse(shadow[0]) : null;
      };

      const surfaceRgba = parse(pageColor)!;
      const seen: { left: string; right: string }[] = [];
      (window as unknown as { __seam: typeof seen }).__seam = seen;

      const tick = () => {
        const left = over(paintOf(row), surfaceRgba);
        const strip = paintOf(actions);
        const attenuated =
          strip === null
            ? null
            : {
                ...strip,
                a: strip.a * Number(getComputedStyle(actions).opacity),
              };
        seen.push({ left: show(left), right: show(over(attenuated, left)) });
        requestAnimationFrame(tick);
      };
      // Record the CURRENT frame synchronously, before scheduling the next.
      //
      // Not `requestAnimationFrame(tick)` alone. That takes the first sample a
      // frame after this call returns, and the caller's next action -- a mouse
      // move -- can be processed in between. On the way IN that is harmless,
      // because the un-hovered state persists until the pointer arrives. On the
      // way OUT it is fatal: KAN-100 made the fill land in ONE frame, so the
      // hovered state is gone immediately and the sampler records only the
      // after state. The control then reports, correctly, that nothing changed.
      //
      // Measured: 3 failures in 3 runs of the exit test on f0e695a before this
      // line. The flake was introduced by the fix it tests -- an instant
      // transition leaves no window for a late sampler to catch.
      tick();
    },
    [rowLabel, surface, kind] as [string, string, string]
  );
}

async function readSeam(page: Page): Promise<SeamFrame[]> {
  return page.evaluate(
    () => (window as unknown as { __seam: SeamFrame[] }).__seam
  );
}

function expectNoSeam(frames: SeamFrame[], moment: string): void {
  // CONTROL: the row's fill actually moved while the sampler was running. An
  // empty disagreement list is only meaningful if there was a change to
  // disagree during.
  expect(
    new Set(frames.map((f) => f.left)).size,
    `the row fill should have changed while ${moment}`
  ).toBeGreaterThan(1);

  const disagreeing = frames.filter((f) => f.left !== f.right);

  expect(
    disagreeing.length,
    `the row must fill uniformly while ${moment}; saw ${disagreeing.length} ` +
      `of ${frames.length} frames where the strip and the row showed ` +
      `different colours, e.g. left ${disagreeing[0]?.left} vs right ` +
      `${disagreeing[0]?.right}`
  ).toBe(0);
}

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
    await expect.poll(() => revealOf(second)).toBe('1');

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
      .poll(() => revealOf(first), {
        message:
          'a clicked row must not keep showing its actions after the pointer leaves',
      })
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

  // KAN-100. The strip must not reach the hover colour BEFORE the row does.
  //
  // KAN-98 pinned the two against each other by colour, and by colour they
  // already agree: the strip's background IS the row's destination colour,
  // from frame zero. The disagreement is entirely in WHEN, so a colour-equality
  // check reads it as correct. That is how this survived four passes over the
  // same family.
  //
  // One state, two channels, two durations:
  //   strip -- already at the final colour, only fades in: opacity 0.1s
  //   row   -- has to travel there:                        0.2s on the fill
  //
  // So the strip is done at ~100ms and the row at ~183ms, and in between there
  // is a hard vertical edge where the strip begins. Measured on main at 95ebbdc:
  // 18 disagreeing frames of 64, peak delta 19.
  //
  // Asserted on COMPOSITED output, not on declared colours. An opaque layer at
  // alpha a over the row's fill L shows a*H + (1-a)*L, which equals L only when
  // a is 0 or L has already reached H. Comparing the declared background to the
  // declared fill cannot see that, because both are the same string the whole
  // time.
  test('the action strip does not reach the hover colour before the row does', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const first = rowFor(page, 'First session');
    const second = rowFor(page, 'Second session');

    // Match the reported repro: row one selected, then the pointer moves onto
    // row two. Selected is what puts row two in the hovered-UNSELECTED state,
    // which is the state whose fill used to ease -- a selected row would not
    // exercise this at all.
    await first.click({ position: { x: 20, y: 20 } });
    await page.mouse.move(0, 0);

    await startSeamSampler(page, 'Second session');

    // A real mouse move at x:20 -- the left edge of the row. The row's centre
    // sits UNDER the action strip (measured: the strip starts at x=175.6 of a
    // 336.8px row), so an unpositioned hover lands on the strip and adds an
    // icon's own hover to what is being measured.
    await second.hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(500);

    expectNoSeam(await readSeam(page), 'the pointer arrives');
  });

  // KAN-100, the other direction, and it needs its own test because the entry
  // test CANNOT see this one.
  //
  // Once the fill lands in a single frame, a mask that lingers is invisible on
  // the way in -- the row is already at the destination colour, so whatever the
  // mask does over it composites to the same value. Leaving is where it shows:
  // the row drops to the page colour in one frame while the mask is still on
  // its way out, so the strip is briefly the only lit part of an unlit row.
  //
  // The mutation that pins this is giving the mask a colour transition
  // (`transition: background-color 0.2s` on the block). Measured: the entry
  // test stays green, this one fails 4 times out of 4.
  //
  // NOTE the margin is thin -- 1 to 2 disagreeing frames out of ~63, because
  // the mask is leaving while the row has already gone. It is reliable, but if
  // a future change makes it thinner this test degrades quietly rather than
  // loudly. If that happens, do not loosen the assertion; sample the first
  // post-departure frames directly instead.
  //
  // An earlier revision of this comment claimed the mutation was restoring the
  // block's `opacity` fade. That was wrong: the mask now lives on
  // background-color, which goes transparent instantly, so fading an already
  // transparent block changes nothing. The test's apparent failure under that
  // mutation was the flake below, not detection.
  test('the action strip does not outlast the row fill when the pointer leaves', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);
    const first = rowFor(page, 'First session');
    const second = rowFor(page, 'Second session');

    await first.click({ position: { x: 20, y: 20 } });
    await second.hover({ position: { x: 20, y: 20 } });

    // Settle first: sampling must start from a fully engaged row, or the
    // frames captured would be the arrival, not the departure.
    await expect.poll(() => revealOf(second)).toBe('1');

    await startSeamSampler(page, 'Second session');

    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);

    expectNoSeam(await readSeam(page), 'the pointer leaves');
  });

  // KAN-100 was measured at two sites, not one. The right pane's window row
  // had the same pairing -- `transition: background-color 0.2s` on the fill,
  // `transition: opacity 0.1s` on the strip -- and the same shape when
  // sampled live: 17 disagreeing frames of 52, strip done at ~100ms, row at
  // ~183ms.
  //
  // Covered here rather than left to the left pane's tests because the two
  // panes are different components with separately declared styles, and
  // nothing stops one from being fixed while the other regresses. The right
  // pane also still drives its reveal from React state rather than the
  // container's :hover, which is the KAN-92 defect unfixed -- out of scope
  // here, but the reason these are not one shared implementation.
  test('a right-pane window row also fills uniformly', async ({
    context,
    extensionId,
  }) => {
    const page = await openWith(context, extensionId);

    await rowFor(page, 'First session').click({ position: { x: 20, y: 20 } });
    const windowRow = page.getByRole('button', { name: 'Morning reading' });
    await expect(windowRow).toBeVisible();
    await page.mouse.move(0, 0);

    await startSeamSampler(page, 'Rename window group', 'window');

    await windowRow.hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(500);

    expectNoSeam(await readSeam(page), 'the pointer arrives on a window row');
  });
});
