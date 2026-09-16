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
