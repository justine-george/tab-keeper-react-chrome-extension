import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';

// KAN-205. The save row's bottom edge meets the session header card's. This
// was the search row's job while the search was a mode in the same place; the
// save row has the same ROW_HEIGHT (KAN-385).
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

test('the save row and the session header end on the same line', async ({
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
  await expect(page.locator('input#name')).toBeVisible();

  const edges = await page.evaluate(() => {
    const input = document.querySelector('input#name')!;
    const add = document.querySelector('[aria-label^="Add current window"]')!;
    // The card is the first ancestor of the add button that draws a border;
    // width alone finds the action strip, which is full width too.
    let card: HTMLElement | null = add.parentElement as HTMLElement;
    while (card && getComputedStyle(card).borderTopWidth === '0px') {
      card = card.parentElement;
    }
    return {
      saveRow: input.getBoundingClientRect().bottom,
      headerCard: card!.getBoundingClientRect().bottom,
    };
  });

  // A pixel of slack, no more: 2px is what it looked like before, and that read
  // as a mistake rather than as a choice.
  expect(Math.abs(edges.saveRow - edges.headerCard)).toBeLessThanOrEqual(1);
});

// KAN-216, on the one row left beside the name box: the search panel's box and
// button are gone (KAN-385), and the save group must span the box's height as
// the search button had to.
test('the save group is exactly as tall as the name box', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('input#name')).toBeVisible();

  // The key is not the en string (the button reads "Save all open windows...").
  const saveAll = localeStrings('en')['Save every open window as a session'];
  const edges = await page.evaluate((label: string) => {
    const box = document.querySelector('input#name');
    // The group is the save button's bordered parent.
    const group = document.querySelector(`button[aria-label="${label}"]`)
      ?.parentElement;
    if (!box || !group) return null;
    const a = box.getBoundingClientRect();
    const b = group.getBoundingClientRect();
    return {
      groupBorder: getComputedStyle(group).borderTopWidth,
      box: { top: a.top, bottom: a.bottom },
      group: { top: b.top, bottom: b.bottom },
    };
  }, saveAll);
  if (edges === null) throw new Error('no name box or save group');

  // PREMISE: the right element, or a match proves nothing.
  expect(edges.groupBorder).toBe('1px');
  expect(edges.group.top).toBeCloseTo(edges.box.top, 0);
  expect(edges.group.bottom).toBeCloseTo(edges.box.bottom, 0);
});
