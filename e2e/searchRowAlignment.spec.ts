import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-205. The search row's bottom edge meets the session header card's.
//
// The two panes are sized independently -- the left stacks a 64px toolbar above
// a control row, the right card is content-sized and starts 8px lower -- so the
// edges line up only because the row carries a deliberate 2px over
// CONTROL.DEFAULT. That is a coincidence held in place by one number, and this
// is what makes it fail loudly when something moves it: a title that starts
// wrapping, a change to either pane's padding, or a nudge to the scale.
//
// An e2e test rather than a component one: neither pane knows about the other,
// so only the assembled popup can say whether their edges meet.

test('the search row and the session header end on the same line', async ({
  context,
  extensionId,
}) => {
  const session = buildSession({
    tabGroupId: 's0',
    title: 'Pull requests · justine-george/tab-keeper-react',
    isSelected: true,
    windowCount: 2,
    tabCount: 47,
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's0',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('textbox').first()).toBeVisible();

  const edges = await page.evaluate(() => {
    const input = document.querySelector('input')!;
    const add = document.querySelector('[aria-label^="Add current window"]')!;
    // The card is the first ancestor of the add button that draws a border;
    // width alone finds the action strip, which is full width too.
    let card: HTMLElement | null = add.parentElement as HTMLElement;
    while (card && getComputedStyle(card).borderTopWidth === '0px') {
      card = card.parentElement;
    }
    return {
      searchRow: input.getBoundingClientRect().bottom,
      headerCard: card!.getBoundingClientRect().bottom,
    };
  });

  // A pixel of slack, no more: 2px is what it looked like before, and that read
  // as a mistake rather than as a choice.
  expect(Math.abs(edges.searchRow - edges.headerCard)).toBeLessThanOrEqual(1);
});

// KAN-216. The search button spans the same height as the search box.
//
// The box takes ROW_HEIGHT for the alignment above; the button was sized only
// by its padding around a 24px icon, so it stayed 48px and floated 5px short
// at each edge of a 58px row. The test above reads the input alone, so it
// passed the whole time the two were visibly different heights.
test('the search button is exactly as tall as the search box', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // The header's search icon opens the panel; its own submit button is the
  // second control with the same name.
  await page.getByRole('button', { name: 'Search' }).first().click();
  const input = page.locator('#searchInput');
  await expect(input).toBeVisible();

  const edges = await page.evaluate(() => {
    const box = document.querySelector('#searchInput')!;
    // The submit button is the input's row sibling, found by position rather
    // than by name so the header icon cannot be picked up instead.
    const button = box.parentElement!.querySelector('button')!;
    const a = box.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    return {
      label: button.getAttribute('aria-label'),
      box: { top: a.top, bottom: a.bottom },
      button: { top: b.top, bottom: b.bottom },
    };
  });

  // PREMISE: the right control, or a match proves nothing.
  expect(edges.label).toBe('Search');
  expect(edges.button.top).toBeCloseTo(edges.box.top, 0);
  expect(edges.button.bottom).toBeCloseTo(edges.box.bottom, 0);
});
