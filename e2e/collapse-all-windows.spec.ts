import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-206. The session header's fold-everything control, in a real browser.
//
// Two of the three things asserted here are invisible to jsdom:
//
//   1. THE LIGATURE. Material Symbols renders `unfold_less` as one glyph only
//      if that name is in the font. An unavailable ligature falls back to the
//      LITERAL TEXT "unfold_less" rather than to tofu -- the trap Icon.tsx:251
//      documents and the one KAN-5 had to measure inked width to catch. jsdom
//      loads no font at all, so a component test sees the same DOM either way
//      and can never tell a real glyph from the word.
//
//   2. THE ROWS LEAVING THE LAYOUT. jsdom reports every box as 0x0, so
//      "collapsed" there means only "absent from the DOM". Whether the pane
//      actually gets shorter is a question only a laid-out page can answer.
//
// The third -- which glyph is showing -- is covered by the component tests too,
// and is asserted here because it costs one line and pins the pair together.

const twoWindows = buildSession({
  tabGroupId: 's0',
  title: 'Pull requests · justine-george/tab-keeper-react',
  isSelected: true,
  windowCount: 2,
  tabCount: 3,
  windows: [
    {
      windowId: 'w1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Morning reading',
      tabs: [
        {
          tabId: 'w1t1',
          favicon: '',
          title: 'Alpha Page',
          url: 'https://example.com/alpha',
        },
        {
          tabId: 'w1t2',
          favicon: '',
          title: 'Bravo Page',
          url: 'https://example.com/bravo',
        },
      ],
    },
    {
      windowId: 'w2',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Afternoon reading',
      tabs: [
        {
          tabId: 'w2t1',
          favicon: '',
          title: 'Charlie Page',
          url: 'https://example.com/charlie',
        },
      ],
    },
  ],
});

test('folding every window shortens the pane, and the control offers to undo it', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer([twoWindows]),
    selectedTabGroupId: 's0',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  // Per-test barrier: goto resolves before the popup has mounted, and nothing
  // below auto-waits once page.evaluate is involved.
  const control = page.getByRole('button', { name: 'Collapse all windows' });
  await expect(control).toBeVisible();
  await expect(page.getByText('Alpha Page')).toBeVisible();
  await expect(page.getByText('Charlie Page')).toBeVisible();

  // THE LIGATURE CHECK -- does `unfold_less` resolve to one glyph, or fall back
  // to the literal word?
  //
  // MEASURED AS OVERFLOW, not as width. The obvious probe is the span's
  // bounding box, and it cannot work: Icon.tsx:142 sets an explicit
  // `width: ${size}` on this span, so the box reads 24px whether a glyph fills
  // it or eleven characters spill out of it. That first version of this check
  // passed happily against a deliberately misspelt ligature -- a probe with no
  // control, which is how it got through.
  //
  // scrollWidth is the content's own width inside that fixed box, so it is the
  // number that moves. Measured both ways at ICON.DEFAULT (1.5rem = 24px):
  //
  //   type="unfold_less"   box 24, scrollWidth 24   <- one glyph, fits
  //   type="unfold_lesss"  box 24, scrollWidth 48   <- the word, overflowing
  //
  // Asserted as "does not overflow" rather than against the literal 24, so the
  // check follows ICON.DEFAULT if the scale ever moves.
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  const glyph = await control.evaluate((el) => {
    const span = el.querySelector('.material-symbols-outlined')!;
    return {
      box: span.getBoundingClientRect().width,
      content: span.scrollWidth,
    };
  });
  expect(glyph.content).toBeLessThanOrEqual(glyph.box);

  // How much vertical room the window blocks actually occupy, before and after.
  //
  // NOT the list's scrollHeight, which was the first thing tried here and which
  // reported 416 in both states. scrollHeight never falls below the element's
  // own padding box, and folding three tab rows away makes this content SHORTER
  // THAN ITS VIEWPORT -- so the container's height answered both times and the
  // measurement could not move. Same clamp dragCollapse.test.tsx:116 records for
  // KAN-154, met here from the other side.
  //
  // Measuring the blocks' own union has no such floor: it is the content's
  // extent and nothing else.
  const blocksExtent = () =>
    page.evaluate(() => {
      const blocks = [...document.querySelectorAll('[data-drop-window-id]')];
      const rects = blocks.map((b) => b.getBoundingClientRect());
      return (
        Math.max(...rects.map((r) => r.bottom)) -
        Math.min(...rects.map((r) => r.top))
      );
    });

  const openHeight = await blocksExtent();

  await control.click();

  const collapsed = page.getByRole('button', { name: 'Expand all windows' });
  await expect(collapsed).toBeVisible();
  await expect(page.getByText('Alpha Page')).toBeHidden();
  await expect(page.getByText('Charlie Page')).toBeHidden();

  const shutHeight = await blocksExtent();
  // Three tab rows at 32px each is 96px of content that has to go. Asserting a
  // real reduction rather than an exact figure: the window headers and their
  // margins stay, and pinning their total here would make this test fail for
  // every unrelated spacing change.
  expect(shutHeight).toBeLessThan(openHeight - 80);

  // And back, from the same control in its other state.
  await collapsed.click();
  await expect(page.getByText('Alpha Page')).toBeVisible();
  expect(await blocksExtent()).toBe(openHeight);
});
