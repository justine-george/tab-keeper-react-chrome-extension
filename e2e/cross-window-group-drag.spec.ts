// KAN-132 §11.3. A whole Chrome tab group, dragged by its title row, lands in
// another saved window -- keeping its identity: its title, its colour, and its
// tabs in order and contiguous.
//
// The same drop `cross-window-drag.spec.ts` pins for a TAB, one level up. The
// helpers below are copied from it unchanged, so the two files ask their
// questions the same way; only the fixture and the pick-up differ (an items
// list is dragged by its handle, as in `group-drag.spec.ts`).
//
// Previews are read from the COMMANDED inline transforms, never from rects: the
// rows ease into place over 0.18s (KAN-165), and a rect read straight after a
// move describes a row still on its way. Where a rect IS read, it is a box with
// no transition on it (the landing slot, a window's block) or a resting top
// polled until it stops moving.

import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import {
  startGeometryEvidence,
  withGeometryEvidence,
} from './fixtures/dragEvidence';

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const win = (
  id: string,
  tabs: ReturnType<typeof tab>[],
  groups: { groupId: string; title: string; color: string }[]
) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: id,
  tabs,
  chromeTabGroups: groups,
});

// w1 items: [tab:a0, group:alpha, tab:a2]. w2 items: [group:beta, tab:b0,
// tab:b1] -- a LEADING group, so w2's first item sits at window-local index 0,
// the same number as w1's first tab.
//
// Two tabs in each group, so "its tabs keep their order and stay contiguous"
// has something to say. As small as those shapes allow: the popup's pane is a
// fixed 415px whatever the viewport, and a session that overflows it scrolls,
// which a drag near an edge turns into auto-scroll moving rows under the held
// pointer.
const WINDOWS = [
  win(
    'w1',
    [tab('a0'), tab('al0', 'alpha'), tab('al1', 'alpha'), tab('a2')],
    [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }]
  ),
  win(
    'w2',
    [tab('be0', 'beta'), tab('be1', 'beta'), tab('b0'), tab('b1')],
    [{ groupId: 'beta', title: 'Beta', color: 'red' }]
  ),
];
const W1_START = 'a0 al0* al1* a2';
const W2_START = 'be0* be1* b0 b1';

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Cross window groups',
    isSelected: true,
    windowCount: WINDOWS.length,
    tabCount: WINDOWS.reduce((n, w) => n + w.tabs.length, 0),
    windows: WINDOWS,
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105), and the group rows need the
  // grant -- without it a group is not an item at all.
  await expect(page.locator('[data-drag-row-id="group:beta"]')).toBeAttached();
  // PREMISE: nothing scrolls, so no drag here can auto-scroll -- none of these
  // claims is about scrolling.
  const pane = await page.evaluate(() => {
    let el = document.querySelector<HTMLElement>(
      '[data-drag-row-id="w1"]'
    )!.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    return { scrollHeight: el!.scrollHeight, clientHeight: el!.clientHeight };
  });
  expect(pane.scrollHeight).toBeLessThanOrEqual(pane.clientHeight);
  return page;
}

// A window's stored tab order, with a star on every grouped tab.
const order = (page: Page, windowId: string) =>
  page.evaluate((windowId) => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windows: {
          windowId: string;
          tabs: { tabId: string; chromeGroupId?: string }[];
        }[];
      }[];
    };
    return data.tabGroups
      .find((g) => g.tabGroupId === 's1')!
      .windows.find((w) => w.windowId === windowId)!
      .tabs.map((t) => t.tabId + (t.chromeGroupId ? '*' : ''))
      .join(' ');
  }, windowId);

// A window's own stored Chrome-group metadata, WHOLE -- id, title and colour.
// Distinct from order()'s '*' markers, which come off the TABS' membership and
// say nothing about the group's identity travelling with them.
const groupsOf = (page: Page, windowId: string) =>
  page.evaluate((windowId) => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windows: {
          windowId: string;
          chromeTabGroups?: { groupId: string; title: string; color: string }[];
        }[];
      }[];
    };
    return (
      data.tabGroups
        .find((g) => g.tabGroupId === 's1')!
        .windows.find((w) => w.windowId === windowId)!.chromeTabGroups ?? []
    ).map((g) => ({ groupId: g.groupId, title: g.title, color: g.color }));
  }, windowId);

const ALPHA = { groupId: 'alpha', title: 'Alpha', color: 'blue' };
const BETA = { groupId: 'beta', title: 'Beta', color: 'red' };

// The session's own bookkeeping, which must agree with the windows array.
const sessionShape = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windowCount: number;
        tabCount: number;
        windows: { windowId: string; tabCount: number }[];
      }[];
    };
    const g = data.tabGroups.find((g) => g.tabGroupId === 's1')!;
    return {
      windowCount: g.windowCount,
      tabCount: g.tabCount,
      windows: g.windows.map((w) => ({
        windowId: w.windowId,
        tabCount: w.tabCount,
      })),
    };
  });

const lastModified = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('tabContainerData')!) as {
          lastModified: number;
        }
      ).lastModified
  );

// A window's block -- header and items together -- in the viewport.
const blockBox = async (page: Page, windowId: string) =>
  (await page.locator(`[data-drop-window-id="${windowId}"]`).boundingBox())!;

// Picks a GROUP up by its title row -- the only handle an items list has
// (group-drag.spec's `grab`) -- and activates the drag WITHOUT aiming it
// anywhere.
//
// Split from cross-window-drag's holdAt, which does both in one call, for a
// reason that is specific to a group: the pick-up COMPRESSES the held group to
// its title row (KAN-160), which shortens its window and moves every window
// below it up by the members it just hid. No rect read before the press
// describes the list the engine has just measured, so every test here aims
// with a box read after this call.
async function grabGroup(page: Page, groupId: string) {
  const b = (await page
    .locator(`[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`)
    .boundingBox())!;
  const x = b.x + 40;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Past the activation distance, which is what publishes the drag and
  // compresses the group.
  await page.mouse.move(x, y + 8, { steps: 2 });
  return x;
}

// Every commanded shift inside a window's block. During a GROUP drag only the
// top-level item rows carry one: the tab rows belong to the `tabs` area, which
// is not the list being dragged, and a group's title row is moved by the frame
// follower, which reads that same `tabs` state. So a zero reported here is a
// row that genuinely did not move.
const shiftsIn = (page: Page, windowId: string) =>
  page.evaluate((windowId) => {
    const block = document.querySelector<HTMLElement>(
      `[data-drop-window-id="${windowId}"]`
    )!;
    const out: Record<string, number> = {};
    for (const el of block.querySelectorAll<HTMLElement>(
      '[data-drag-row-id]'
    )) {
      if (el.hasAttribute('data-drag-held')) continue;
      const n = Number(
        /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
      );
      if (n !== 0) out[el.dataset.dragRowId!] = n;
    }
    return out;
  }, windowId);

// The landing slot's top. The slot rides on the held row, and neither carries a
// transition, so -- unlike the rows stepping aside -- its box is where it was
// commanded to be the moment the pointer stops.
const slotTop = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('[data-drag-landing-slot]')!
        .getBoundingClientRect().top
  );

// Where a row SITS with its commanded shift taken back out: the position the
// drag measured it at, and the one the preview's arithmetic is expressed in.
//
// Needed here and not in cross-window-drag because a group drag CHANGES THE
// LAYOUT at pick-up: the held group compresses to its title row (KAN-160), so
// every row below it moves up and no rect read before the drag describes the
// list the engine measured. The layout change itself is instant -- only the
// transform carries the 0.18s transition -- so this settles as soon as the
// stepping-aside animation does.
// Summed over the element AND its ancestors, because a tab row is drawn inside
// the item row that carries the shift: a group's members move because their
// group's row moved, and their own transform is empty.
const restingTopRaw = (page: Page, rowId: string) =>
  page.evaluate((rowId) => {
    const el = document.querySelector<HTMLElement>(
      `[data-drag-row-id="${rowId}"]`
    )!;
    let shift = 0;
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      shift += Number(
        /translateY\((-?[\d.]+)px\)/.exec(n.style.transform)?.[1] ?? 0
      );
    }
    const r = el.getBoundingClientRect();
    return { top: r.top - shift, height: r.height };
  }, rowId);

// Polled until two consecutive reads agree, rather than slept on: the settle is
// what is being waited for, and a fixed wait either flakes or wastes time.
async function restingBox(page: Page, rowId: string) {
  let last: { top: number; height: number } | undefined;
  await expect
    .poll(async () => {
      const now = await restingTopRaw(page, rowId);
      const settled =
        last !== undefined &&
        Math.abs(now.top - last.top) < 0.5 &&
        Math.abs(now.height - last.height) < 0.5;
      last = now;
      return settled;
    })
    .toBe(true);
  return last!;
}

test.describe('a group released over another window', () => {
  // THE DROP THIS TASK IS FOR. Into the middle of another window's list: past
  // its first loose tab's midpoint, short of the next one's.
  test('into the middle: it lands there, whole', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'alpha');
    const b0 = await restingBox(page, 'tab:b0');
    const b1 = await restingBox(page, 'tab:b1');
    // PREMISE: past tab:b0's midpoint and short of tab:b1's.
    const y = b0.top + b0.height - 4;
    expect(y).toBeGreaterThan(b0.top + b0.height / 2);
    expect(y).toBeLessThan(b1.top + b1.height / 2);

    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();

    // THE TABS: alpha's two members arrive together, in order, between b0 and
    // b1 -- and they are still grouped.
    await expect
      .poll(() => order(page, 'w2'))
      .toBe('be0* be1* b0 al0* al1* b1');
    expect(await order(page, 'w1')).toBe('a0 a2');
    // THE IDENTITY: title and colour travel with the tabs, and leave nothing
    // behind in the window the group came from.
    expect(await groupsOf(page, 'w1')).toEqual([]);
    // THE DESTINATION'S OWN GROUP: beta is untouched, and still first.
    expect(await groupsOf(page, 'w2')).toEqual([BETA, ALPHA]);
    // THE COUNTS: they move with the tabs; the session's total does not.
    expect(await sessionShape(page)).toEqual({
      windowCount: 2,
      tabCount: 8,
      windows: [
        { windowId: 'w1', tabCount: 2 },
        { windowId: 'w2', tabCount: 6 },
      ],
    });
  });

  // Spec §11.3: at the end of a window is allowed, in the user's own words.
  test("at the end of another window's list: it lands last", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'alpha');
    const b1 = await restingBox(page, 'tab:b1');
    const block = await blockBox(page, 'w2');
    const y = block.y + block.height - 3;
    // PREMISE: past the last item's midpoint, and still inside the block.
    expect(y).toBeGreaterThan(b1.top + b1.height / 2);
    expect(y).toBeLessThan(block.y + block.height);

    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(() => order(page, 'w2'))
      .toBe('be0* be1* b0 b1 al0* al1*');
    expect(await order(page, 'w1')).toBe('a0 a2');
    expect(await groupsOf(page, 'w2')).toEqual([BETA, ALPHA]);
  });

  // Spec §11.3: a window's header is that window, at index 0 -- the same rule
  // §2.1 and §7.1 gave the tab list.
  test("on another window's header: it lands first", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'alpha');
    const header = (await page
      .locator('[data-drop-window-id="w2"] [data-window-drag-handle]')
      .boundingBox())!;
    const beta = await restingBox(page, 'group:beta');
    const y = header.y + 4;
    // PREMISE: on w2's header, and above every item of w2, so no midpoint is
    // passed.
    expect(y).toBeLessThan(header.y + header.height);
    expect(y).toBeLessThan(beta.top);

    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(() => order(page, 'w2'))
      .toBe('al0* al1* be0* be1* b0 b1');
    expect(await order(page, 'w1')).toBe('a0 a2');
    expect(await groupsOf(page, 'w2')).toEqual([BETA, ALPHA]);
  });

  // Spec §11.3: a collapsed window draws no items, so a release anywhere on it
  // passes no midpoint -- index 0, asserted after expanding it again.
  test('into a collapsed window: it lands first', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await page
      .locator('[data-drop-window-id="w2"] [aria-label="Collapse"]')
      .click();
    await expect(
      page.locator('[data-drop-window-id="w2"] [data-window-tabs]')
    ).toHaveCount(0);

    const x = await grabGroup(page, 'alpha');
    const w2 = await blockBox(page, 'w2');
    await page.mouse.move(x, w2.y + w2.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(() => order(page, 'w2'))
      .toBe('al0* al1* be0* be1* b0 b1');
    expect(await order(page, 'w1')).toBe('a0 a2');
    expect(await groupsOf(page, 'w2')).toEqual([BETA, ALPHA]);
    // And the rows really are there once the window is opened again.
    //
    // The 400ms is the drag's own click suppression (RowDragArea swallows the
    // first click after a drag, so releasing a row does not also open it). It
    // is a fixed product constant, not a race: without waiting it out, this
    // click is the one that gets swallowed and the window stays shut.
    await page.waitForTimeout(450);
    await page
      .locator('[data-drop-window-id="w2"] [aria-label="Expand"]')
      .click();
    await expect(
      page.locator(
        '[data-drop-window-id="w2"] [data-drag-row-id="group:alpha"]'
      )
    ).toBeAttached();
  });

  // Spec §11.1, explicitly rejected in the exchange that asked for this: a
  // group released inside another group does NOT pour its tabs in. An items
  // list names no band at all -- it has no resolveDrop -- so a release deep
  // inside beta lands between items like any other, here after beta because
  // beta's own item row is one row spanning its whole group.
  test("inside another window's group: it lands beside it, never in it", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'alpha');
    const beta = await restingBox(page, 'group:beta');
    const be1 = await restingBox(page, 'be1');
    const y = be1.top + be1.height / 2;
    // PREMISE: squarely on beta's LAST member, inside the band, and past the
    // beta ITEM row's midpoint.
    expect(y).toBeGreaterThan(beta.top + beta.height / 2);
    expect(y).toBeLessThan(beta.top + beta.height);

    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();

    // THE CLAIM: beta still holds exactly be0 and be1, contiguously, and alpha
    // sits after it as a group of its own.
    await expect
      .poll(() => order(page, 'w2'))
      .toBe('be0* be1* al0* al1* b0 b1');
    expect(await groupsOf(page, 'w2')).toEqual([BETA, ALPHA]);
    // STRENGTHENED (Task 13 step 1): the release lands deep inside beta's own
    // band, which is the one geometry where a bug pouring alpha's tabs into
    // beta could also leave alpha's metadata behind in w1 -- the two windows'
    // chromeTabGroups arrays being independent, a bug in the removal half of
    // the move would not show up in w2's assertion above at all.
    expect(await groupsOf(page, 'w1')).toEqual([]);
  });
});

// A release that names no window has nowhere to go, and doing nothing is the
// honest answer (§11.3, §6 as amended in Task 5). It pairs with the drops
// above, so a list that refused everything cannot pass here.
test.describe('a group released over no window', () => {
  // KAN-185 REPLACED this one's rule. The gap between two blocks named no
  // window, so a release there was refused -- and crossing it slowly showed the
  // landing snap home to the row's own origin and out again. It belongs to the
  // nearer block now, which leaves "no window" meaning beside the pane and past
  // the ends of the list, both still refused and both still pinned elsewhere.
  test('in the gap above the next window, the group lands in the nearer one', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const before = await lastModified(page);

    // Measured with the drag live, so the compression cannot move the gap out
    // from under the release point.
    const x = await grabGroup(page, 'beta');
    const w1 = await blockBox(page, 'w1');
    const w2 = await blockBox(page, 'w2');
    // PREMISE: there is a gap, and the release point is in neither block.
    expect(w2.y - (w1.y + w1.height)).toBeGreaterThanOrEqual(4);
    // Just inside the upper block's half of it.
    const gapY = w1.y + w1.height + 1;

    await page.mouse.move(x, gapY, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => order(page, 'w1')).toBe(`${W1_START} be0* be1*`);
    expect(await order(page, 'w2')).toBe('b0 b1');
    expect(await groupsOf(page, 'w1')).toContainEqual(BETA);
    // A move that commits re-stamps the session, where the refusal this
    // replaced deliberately did not.
    expect(await lastModified(page)).not.toBe(before);
  });
});

// KAN-160/KAN-161, across a window boundary: the held group compresses to its
// title row so it moves like a tab, and NOTHING else folds -- a group folding
// above it would move it off the cursor.
test.describe('while a group is held over another window', () => {
  test('only the held group compresses', async ({ context, extensionId }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'alpha');
    const w2 = await blockBox(page, 'w2');
    await page.mouse.move(x, w2.y + w2.height / 2, { steps: 8 });

    await expect(
      page.locator('[data-drag-row-id="group:alpha"] [data-group-tabs]')
    ).toBeHidden();
    // THE CONTROL: the destination's own group, and the one below the pointer,
    // stays open.
    await expect(
      page.locator('[data-drag-row-id="group:beta"] [data-group-tabs]')
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });
});

// KAN-164: the preview must show what the release DOES. Each window is
// previewed in its own frame (previewShiftsAcross, measured wrong as one flat
// range in Task 5): the window the group leaves closes up below it, the window
// it enters opens from the insertion point down, and nothing else moves.
test.describe('what a group drag into another window previews', () => {
  test('into the middle: only the items past the landing point step down', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    // KAN-191: this assertion has failed once on CI, 3px out against a 0.5px
    // tolerance, and has never been reproduced locally. Recording starts before
    // the pick-up so a failure can say whether the slot was still moving.
    await startGeometryEvidence(page, {
      slot: '[data-drag-landing-slot]',
      'tab:b0': '[data-drag-row-id="tab:b0"]',
      'tab:b1': '[data-drag-row-id="tab:b1"]',
      w1: '[data-drop-window-id="w1"]',
      w2: '[data-drop-window-id="w2"]',
    });

    const x = await grabGroup(page, 'alpha');
    const b0 = await restingBox(page, 'tab:b0');
    const b1 = await restingBox(page, 'tab:b1');
    await page.mouse.move(x, b0.top + b0.height - 4, { steps: 8 });

    // The window it left closes up below the group, by the held row's own
    // footprint -- the COMPRESSED group row, which is what a release removes
    // from this window's flow right now.
    await expect
      .poll(() => shiftsIn(page, 'w1'))
      .toEqual({ 'tab:a2': expect.any(Number) });
    const fp = -(await shiftsIn(page, 'w1'))['tab:a2'];
    expect(fp).toBeGreaterThan(0);
    // THE CLAIM: the window it enters opens at tab:b1, and ONLY there. beta's
    // item row and tab:b0, which sit above the landing point, do not move --
    // one flat range across both windows would have lifted them.
    expect(await shiftsIn(page, 'w2')).toEqual({ 'tab:b1': fp });
    // And the slot is drawn in the space tab:b1 is vacating.
    await withGeometryEvidence(
      page,
      'kan-191-slot-vs-b1',
      async () => {
        // KAN-191. Polled, not read once. The recorded frames show the slot
        // arriving in discrete jumps -- 191, 225, 299, 397, 429 -- while the
        // held row's commanded shift is still climbing toward the pointer, so
        // a single read lands wherever the travel happens to have reached. The
        // claim and its 0.5px tolerance are unchanged; only the moment it is
        // allowed to be true has stopped being one arbitrary instant.
        await expect.poll(() => slotTop(page)).toBeCloseTo(b1.top, 0);
      },
      // The two numbers the assertion compares, plus the settle the recorder
      // cannot show on its own: b1's resting top is DERIVED (rect minus
      // commanded shift), so a stale `b1` and a moving slot look identical in
      // the frames alone.
      async () => ({
        expectedB1Top: b1.top,
        slotTopNow: await slotTop(page),
        b1RestingNow: await restingTopRaw(page, 'tab:b1'),
        shiftsW1: await shiftsIn(page, 'w1'),
        shiftsW2: await shiftsIn(page, 'w2'),
      })
    );

    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order(page, 'w1')).toBe(W1_START);
    expect(await order(page, 'w2')).toBe(W2_START);
  });

  // Past another window's last item there is no item to step aside for. The
  // slot goes where a row appended to that window is drawn: its block's bottom.
  test("past another window's last item: nothing there moves, and the slot sits at its end", async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const x = await grabGroup(page, 'alpha');
    const block = await blockBox(page, 'w2');
    await page.mouse.move(x, block.y + block.height - 3, { steps: 8 });

    await expect
      .poll(() => shiftsIn(page, 'w1'))
      .toEqual({ 'tab:a2': expect.any(Number) });
    expect(await shiftsIn(page, 'w2')).toEqual({});
    expect(await slotTop(page)).toBeCloseTo(block.y + block.height, 0);

    await page.mouse.up();
    await expect
      .poll(() => order(page, 'w2'))
      .toBe('be0* be1* b0 b1 al0* al1*');
  });

  // A collapsed destination has no items at all, so nothing there can move and
  // the slot sits under its header -- where the first row will be drawn.
  test('into a collapsed window: nothing moves there, and the slot sits under its header', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await page
      .locator('[data-drop-window-id="w2"] [aria-label="Collapse"]')
      .click();
    await expect(
      page.locator('[data-drop-window-id="w2"] [data-window-tabs]')
    ).toHaveCount(0);

    const x = await grabGroup(page, 'alpha');
    const block = await blockBox(page, 'w2');
    await page.mouse.move(x, block.y + block.height / 2, { steps: 8 });

    await expect
      .poll(() => shiftsIn(page, 'w1'))
      .toEqual({ 'tab:a2': expect.any(Number) });
    expect(await shiftsIn(page, 'w2')).toEqual({});
    expect(await slotTop(page)).toBeCloseTo(block.y + block.height, 0);

    await page.mouse.up();
    await expect
      .poll(() => order(page, 'w2'))
      .toBe('al0* al1* be0* be1* b0 b1');
  });
});

// Spec §11.3, "source window emptied": the window goes with its last tab, and
// the session's windowCount goes with it. A fixture of its own, since the
// shared shape has no window a single group can empty.
test.describe('a window emptied by the group that left it', () => {
  async function openSolo(
    context: BrowserContext,
    extensionId: string
  ): Promise<Page> {
    const session = buildSession({
      tabGroupId: 's1',
      title: 'Emptying window',
      isSelected: true,
      windowCount: 2,
      tabCount: 4,
      windows: [
        win(
          'w1',
          [tab('s0', 'solo'), tab('s1', 'solo')],
          [{ groupId: 'solo', title: 'Solo', color: 'purple' }]
        ),
        win('w2', [tab('b0'), tab('b1')], []),
      ],
    });
    await seedSessions(context, {
      ...buildContainer([session]),
      selectedTabGroupId: 's1',
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(
      page.locator('[data-drag-row-id="group:solo"]')
    ).toBeAttached();
    return page;
  }

  test('the window goes with its last tabs', async ({
    context,
    extensionId,
  }) => {
    const page = await openSolo(context, extensionId);

    const x = await grabGroup(page, 'solo');
    const b0 = await restingBox(page, 'tab:b0');
    await page.mouse.move(x, b0.top + b0.height - 4, { steps: 8 });
    await page.mouse.up();

    // THE STORED MOVE.
    await expect.poll(() => order(page, 'w2')).toBe('b0 s0* s1* b1');
    expect(await groupsOf(page, 'w2')).toEqual([
      { groupId: 'solo', title: 'Solo', color: 'purple' },
    ]);
    // THE CLAIM: w1 is gone, not just emptied.
    await expect(page.locator('[data-drop-window-id="w1"]')).toHaveCount(0);
    expect(await sessionShape(page)).toEqual({
      windowCount: 1,
      tabCount: 4,
      windows: [{ windowId: 'w2', tabCount: 4 }],
    });
  });
});

// Task 13 step 2. Every other fixture in this file gives its groups two
// members, which cannot tell "landed in the right place" apart from "landed
// with its members reordered" -- two members can only ever look the same
// forwards and backwards read as a pair, or a bug could drop a middle member
// silently and a two-member group would not have one. A THREE-tab group can.
test.describe('a three-tab group crossing windows', () => {
  async function openThreeTabGroup(
    context: BrowserContext,
    extensionId: string
  ): Promise<Page> {
    const session = buildSession({
      tabGroupId: 's1',
      title: 'Three tab group',
      isSelected: true,
      windowCount: 2,
      tabCount: 8,
      windows: [
        win(
          'w1',
          [
            tab('c0'),
            tab('gam0', 'gamma'),
            tab('gam1', 'gamma'),
            tab('gam2', 'gamma'),
            tab('c2'),
          ],
          [{ groupId: 'gamma', title: 'Gamma', color: 'green' }]
        ),
        win('w2', [tab('d0'), tab('d1'), tab('d2')], []),
      ],
    });
    await seedSessions(context, {
      ...buildContainer([session]),
      selectedTabGroupId: 's1',
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(
      page.locator('[data-drag-row-id="group:gamma"]')
    ).toBeAttached();
    return page;
  }

  test('its three tabs keep their order and stay contiguous', async ({
    context,
    extensionId,
  }) => {
    const page = await openThreeTabGroup(context, extensionId);

    const x = await grabGroup(page, 'gamma');
    const d0 = await restingBox(page, 'tab:d0');
    const d1 = await restingBox(page, 'tab:d1');
    // PREMISE: past tab:d0's midpoint and short of tab:d1's, same as the
    // two-member "into the middle" case.
    const y = d0.top + d0.height - 4;
    expect(y).toBeGreaterThan(d0.top + d0.height / 2);
    expect(y).toBeLessThan(d1.top + d1.height / 2);

    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();

    // THE CLAIM: gam0, gam1, gam2 arrive in that order, all three contiguous,
    // between d0 and d1 -- not reversed, not interleaved, none dropped.
    await expect
      .poll(() => order(page, 'w2'))
      .toBe('d0 gam0* gam1* gam2* d1 d2');
    expect(await order(page, 'w1')).toBe('c0 c2');
    expect(await groupsOf(page, 'w1')).toEqual([]);
    expect(await groupsOf(page, 'w2')).toEqual([
      { groupId: 'gamma', title: 'Gamma', color: 'green' },
    ]);
  });
});

// Task 13 step 4. The end-to-end counterpart of Task 10's store-level undo
// round trip: a real drag, through the DOM, undone through the same Ctrl+Z
// path a user presses (MainContainer's keydown handler), asserting both
// windows' stored orders and both windows' group lists -- not just one side
// of the move, which is exactly the asymmetry M1 in Task 12 showed can hide a
// wrong answer in the window the user dragged FROM.
test.describe('undoing a cross-window group move', () => {
  test('puts both windows back exactly as they were', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const sessionBefore = await sessionShape(page);

    const x = await grabGroup(page, 'alpha');
    const b0 = await restingBox(page, 'tab:b0');
    const b1 = await restingBox(page, 'tab:b1');
    const y = b0.top + b0.height - 4;
    expect(y).toBeGreaterThan(b0.top + b0.height / 2);
    expect(y).toBeLessThan(b1.top + b1.height / 2);

    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();

    // PREMISE: the move actually happened, so undo has something to reverse.
    await expect
      .poll(() => order(page, 'w2'))
      .toBe('be0* be1* b0 al0* al1* b1');
    expect(await order(page, 'w1')).toBe('a0 a2');

    // RowDragArea's own click suppression (the same 400ms the "into a
    // collapsed window" test above waits out before its Expand click) is a
    // capture-phase listener on `window`, not scoped to rows -- it swallows
    // the very next click ANYWHERE in the document after a drag ends. Undo
    // sits in the left pane, nowhere near the dragged row, and still eats it:
    // MEASURED by running this assertion without the wait below, which timed
    // out with w1 still 'a0 a2' -- the click landed on Undo (no error, no
    // navigation) but the drop's own suppression consumed it before
    // handleClickUndo ever ran, so nothing was dispatched. Waiting it out
    // first is the fixed product constant Task 12 concern 6 named, not a
    // race, and the same idiom this file already uses.
    await page.waitForTimeout(450);
    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).not.toHaveAttribute('aria-disabled', 'true');
    await undo.click();

    // THE ROUND TRIP: both windows' stored orders...
    await expect.poll(() => order(page, 'w1')).toBe(W1_START);
    await expect.poll(() => order(page, 'w2')).toBe(W2_START);
    // ...and both windows' group lists -- title, colour, and which window
    // each lives in -- are the pre-move ones.
    expect(await groupsOf(page, 'w1')).toEqual([ALPHA]);
    expect(await groupsOf(page, 'w2')).toEqual([BETA]);
    expect(await sessionShape(page)).toEqual(sessionBefore);
  });
});
