import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-180. A band's LEADING EDGE decides the same way however the pointer
// arrives at it.
//
// Marking a band grows it, so that the tint can show the group the drop would
// make (KAN-171), and the hit test takes that growth back so the preview does
// not enlarge its own target. It took it back by rebuilding the resting top as
// `rect.top + paddingTop`, and that is 2px wrong: the negative margin which
// absorbs the padding also changes how the band COLLAPSES with the row above,
// so the box does not move by the padding alone.
//
// Two pixels is enough to latch. Measured at quarter-pixel steps on a band
// holding the KAN-179 gap:
//
//   unmarked   top 327  pad  0   boundary 327   -> y >= 327 marks it
//   marked     top 297  pad 32   boundary 329   -> y <  329 unmarks it
//
//   y 327.00  B     y 327.25  none    y 327.50  B     y 327.75  none ...
//
// The follower now measures what the growth moved and publishes it, so the hit
// test subtracts exactly that.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

// Two adjacent groups, so the lower band carries KAN-179's wider top margin --
// the arrangement where the residue was measured. Its own control below uses
// the band that does not.
const TABS = [
  tab('top'),
  tab('newtab'),
  tab('a1', 'A'),
  tab('a2', 'A'),
  tab('b1', 'B'),
  tab('b2', 'B'),
  tab('b3', 'B'),
  tab('last'),
];

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Band edge',
    isSelected: true,
    windowCount: 1,
    tabCount: TABS.length,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: TABS.length,
        title: 'w1',
        tabs: TABS,
        chromeTabGroups: [
          { groupId: 'A', title: 'A', color: 'grey' },
          { groupId: 'B', title: 'B', color: 'blue' },
        ],
      },
    ],
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('[data-band-id="B"]')).toBeAttached();
  return page;
}

const markedBand = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('[data-band-id][data-drop-target]')
        ?.getAttribute('data-band-id') ?? 'none'
  );

const boxOf = async (page: Page, selector: string) =>
  (await page.locator(selector).boundingBox())!;

async function hold(page: Page, rowId: string) {
  const held = await boxOf(page, `[data-drag-row-id="${rowId}"]`);
  const x = held.x + 60;
  await page.mouse.move(x, held.y + held.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, held.y + held.height / 2 + 8);
  return x;
}

// Every marked-band answer across a range, at quarter-pixel steps -- the scale
// the flapping happens at. A 1px sweep sees a clean edge here and proves
// nothing.
async function sweep(page: Page, x: number, from: number, to: number) {
  const seen: string[] = [];
  for (let y = from; y <= to; y += 0.25) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(80);
    const marked = await markedBand(page);
    if (seen[seen.length - 1] !== marked) seen.push(marked);
  }
  return seen;
}

test.describe('the leading edge of a band', () => {
  test('decides once, and does not flap', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    const bandB = await boxOf(page, '[data-band-id="B"]');
    const x = await hold(page, 'newtab');

    const seen = await sweep(page, x, bandB.y - 2, bandB.y + 6);

    // Exactly one change of mind on the way in: none, then B.
    expect(seen).toEqual(['none', 'B']);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('CONTROL: the same edge on a band with the narrow margin', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    // Band A follows a loose tab, so it rests at the 2px margin rather than
    // KAN-179's 8px -- a different collapse, and the rule must not care.
    const bandA = await boxOf(page, '[data-band-id="A"]');
    const x = await hold(page, 'top');

    const seen = await sweep(page, x, bandA.y - 2, bandA.y + 6);

    expect(seen).toEqual(['none', 'A']);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // CONTROL, and the defect this must not hand back (KAN-171): the growth is a
  // preview of the result, never a bigger target. A pointer clear of every
  // band leaves none of them lit -- which a hit test that simply used the grown
  // box would fail, since that box reaches a row higher.
  test('CONTROL: a pointer above every band lights none of them', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const bandA = await boxOf(page, '[data-band-id="A"]');
    const x = await hold(page, 'last');

    // Into band A first, so there is something lit to put out.
    await page.mouse.move(x, bandA.y + 10, { steps: 6 });
    await page.waitForTimeout(200);
    expect(await markedBand(page)).toBe('A');

    // Then clear of it, by less than the growth reaches.
    await page.mouse.move(x, bandA.y - 6, { steps: 6 });
    await page.waitForTimeout(200);
    expect(await markedBand(page)).toBe('none');

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
});
