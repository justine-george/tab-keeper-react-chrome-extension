// KAN-169. A group with exactly ONE member. Drag that member out of the band
// and the reducer prunes the emptied group: title row, colour strip, padding
// and margins all disappear. The preview has to say so.
//
// It could not. Every other case in this family is an element MOVING, and the
// drawn list the preview works over is measured once at drag start with every
// entry surviving to the drop -- so the title row was shown sliding aside as if
// the group were still there, and every row below the band was drawn where the
// drop would not put it: 36px low, the band's whole chrome.
//
// Two halves, as in tab-group-join-preview.spec.ts. The GROUND TRUTH half seeds
// the arrangement moveTabInternal produces and measures it; the PREVIEW half
// drives the real drag and asserts the preview predicts those numbers. The
// numbers are pinned rather than derived, so a layout change fails here
// loudly instead of quietly re-baselining the preview assertions.

import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

type Tab = ReturnType<typeof tab>;

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

const GROUPS = [
  { groupId: 'solo', title: 'Solo', color: 'red' },
  { groupId: 'beta', title: 'Beta', color: 'blue' },
  { groupId: 'gamma', title: 'Gamma', color: 'green' },
];

interface SeedWindow {
  windowId: string;
  tabs: Tab[];
}

async function open(
  context: BrowserContext,
  extensionId: string,
  windows: SeedWindow[]
): Promise<Page> {
  const tabCount = windows.reduce((n, w) => n + w.tabs.length, 0);
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Vanish preview',
    isSelected: true,
    windowCount: windows.length,
    tabCount,
    windows: windows.map((w) => ({
      windowId: w.windowId,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: w.tabs.length,
      title: w.windowId,
      tabs: w.tabs,
      chromeTabGroups: GROUPS,
    })),
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105), and the bands need the grant.
  await expect(page.locator('[data-drag-row-id]').first()).toBeAttached();
  expect(
    await page.evaluate(() =>
      chrome.permissions.contains({ permissions: ['tabGroups'] })
    )
  ).toBe(true);
  return page;
}

const one = (tabs: Tab[]): SeedWindow[] => [{ windowId: 'w1', tabs }];

// Every row's top and every band's title row, relative to the first window's
// tab-list container so arrangements compare however the pane is scrolled.
// Keys are row ids and `head:<group>`.
const tops = (page: Page) =>
  page.evaluate(() => {
    const base = document
      .querySelector('[data-window-tabs]')!
      .getBoundingClientRect().top;
    const out: Record<string, number> = {};
    for (const el of document.querySelectorAll<HTMLElement>(
      '[data-window-tabs] [data-drag-row-id]'
    )) {
      const id = el.dataset.dragRowId!;
      // Only the `tabs` rows; the `items` list wraps them under prefixed ids.
      if (id.includes(':')) continue;
      out[id] = Math.round(el.getBoundingClientRect().top - base);
    }
    for (const band of document.querySelectorAll<HTMLElement>(
      '[data-band-id]'
    )) {
      out[`head:${band.dataset.bandId}`] = Math.round(
        band.querySelector('[data-group-drag-handle]')!.getBoundingClientRect()
          .top - base
      );
    }
    return out;
  });

// Drive the drag and read the preview WITHOUT releasing. Each element's
// previewed top is its pre-drag top plus the transform the drag has COMMANDED
// (rows carry a 0.18s transition, so a rect mid-flight lies); the held row's is
// where the landing slot is drawn, which carries no transition. `removed` is
// which bands are marked as going.
async function previewOfDragging(page: Page, rowId: string, toY: number) {
  const before = await tops(page);
  const from = (await page
    .locator(`[data-drag-row-id="${rowId}"]`)
    .boundingBox())!;

  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  // Clear ACTIVATION_DISTANCE_PX before travelling, then step so the engine
  // sees a real gesture rather than one jump.
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 8);
  await page.mouse.move(from.x + 40, toY, { steps: 6 });
  // The fade the removed chrome carries is 0.18s; let it finish before the
  // opacities below are read.
  await page.waitForTimeout(400);

  const preview = await page.evaluate(
    ([held, pre]: [string, Record<string, number>]) => {
      const shiftOf = (el: Element | null) =>
        el
          ? Number(
              /translateY\((-?[\d.]+)px\)/.exec(
                (el as HTMLElement).style.transform
              )?.[1] ?? 0
            )
          : NaN;
      const out: Record<string, number> = {};
      for (const [key, top] of Object.entries(pre)) {
        const el = key.startsWith('head:')
          ? document.querySelector(
              `[data-band-id="${key.slice(5)}"] [data-group-drag-handle]`
            )
          : document.querySelector(`[data-drag-row-id="${key}"]`);
        out[key] = top + shiftOf(el);
      }
      const base = document
        .querySelector('[data-window-tabs]')!
        .getBoundingClientRect().top;
      const slot = document.querySelector('[data-drag-landing-slot]');
      out[held] = slot
        ? Math.round(slot.getBoundingClientRect().top - base)
        : NaN;

      const removed: Record<string, { header: number; strip: number }> = {};
      for (const band of document.querySelectorAll<HTMLElement>(
        '[data-band-id][data-drag-removed]'
      )) {
        removed[band.dataset.bandId!] = {
          header: Number(
            getComputedStyle(band.querySelector('[data-group-drag-handle]')!)
              .opacity
          ),
          strip: Number(
            getComputedStyle(band.querySelector('[data-group-color-strip]')!)
              .opacity
          ),
        };
      }
      return { tops: out, removed };
    },
    [rowId, before] as [string, Record<string, number>]
  );

  // Escape rather than release: this asserts on the preview, and a commit
  // would rewrite the very layout being measured.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  return preview;
}

const rowY = async (page: Page, id: string, fraction: number) => {
  const b = (await page.locator(`[data-drag-row-id="${id}"]`).boundingBox())!;
  return b.y + b.height * fraction;
};
// Just above a band: outside it, in the lower part of the row over it, so the
// index is unchanged and only the membership goes (KAN-168's case).
const aboveBandY = async (page: Page, group: string) =>
  (await page.locator(`[data-band-id="${group}"]`).boundingBox())!.y - 6;
const titleRowY = async (page: Page, group: string) => {
  const b = (await page
    .locator(`[data-band-id="${group}"] [data-group-drag-handle]`)
    .boundingBox())!;
  return b.y + b.height / 2;
};

// ---------------------------------------------------------------------------
// The ticket's arrangement: a0 a1 a2 [Solo: s0] a3 a4.
const LOOSE = one([
  tab('a0'),
  tab('a1'),
  tab('a2'),
  tab('s0', 'solo'),
  tab('a3'),
  tab('a4'),
]);
const LOOSE_LEFT_UP = one([
  tab('a0'),
  tab('a1'),
  tab('a2'),
  tab('s0'),
  tab('a3'),
  tab('a4'),
]);
const LOOSE_LEFT_DOWN = one([
  tab('a0'),
  tab('a1'),
  tab('a2'),
  tab('a3'),
  tab('s0'),
  tab('a4'),
]);

// Measured in the real popup at 790x550 on 2026-09-14, tops relative to the
// tab-list container. The band's chrome is 36px: title row 32, margin 2 above
// and below.
const LOOSE_TRUTH = {
  before: { a0: 0, a1: 32, a2: 64, 'head:solo': 98, s0: 130, a3: 164, a4: 196 },
  // s0 leaves upward: its index is unchanged, the band is gone, and everything
  // below it comes up by the band's whole chrome.
  leftUp: { a0: 0, a1: 32, a2: 64, s0: 96, a3: 128, a4: 160 },
  // s0 leaves past a3: a3 comes up by the held row AND the chrome.
  leftDown: { a0: 0, a1: 32, a2: 64, a3: 96, s0: 128, a4: 160 },
} as const;

// Between two loose tabs, a one-member group followed by another group:
// a0 [Solo: s0] [Beta: b0 b1] a3. Beta keeps the wider adjacent-group margin
// (KAN-179) while Solo stands, and the ordinary one once it is gone.
const GROUP_BELOW = one([
  tab('a0'),
  tab('s0', 'solo'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('a3'),
]);
const GROUP_BELOW_JOINED = one([
  tab('a0'),
  tab('s0', 'beta'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('a3'),
]);
const GROUP_BELOW_TRUTH = {
  before: {
    a0: 0,
    'head:solo': 34,
    s0: 66,
    'head:beta': 106,
    b0: 138,
    b1: 170,
    a3: 204,
  },
  // s0 joins Beta at its head. Solo goes; Beta and everything under it come
  // up 40 -- 36 of chrome plus the 6px its own margin shrinks by.
  joined: { a0: 0, 'head:beta': 34, s0: 66, b0: 98, b1: 130, a3: 164 },
} as const;

// A one-member group LEADING its window: [Solo: s0] a1 a2. Nothing sits above
// the band in the drawn list; what closes up against a1 is the list's top.
const LEADING = one([tab('s0', 'solo'), tab('a1'), tab('a2')]);
const LEADING_LEFT_DOWN = one([tab('a1'), tab('s0'), tab('a2')]);
const LEADING_TRUTH = {
  before: { 'head:solo': 2, s0: 34, a1: 68, a2: 100 },
  leftDown: { a1: 0, s0: 32, a2: 64 },
} as const;

// A one-member group AFTER another group: [Beta: b0 b1] [Solo: s0] a3 a4. The
// slot above the span is Beta's zero-height tail marker.
const GROUP_ABOVE = one([
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('s0', 'solo'),
  tab('a3'),
  tab('a4'),
]);
const GROUP_ABOVE_LEFT_DOWN = one([
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('a3'),
  tab('s0'),
  tab('a4'),
]);
const GROUP_ABOVE_TRUTH = {
  before: {
    'head:beta': 2,
    b0: 34,
    b1: 66,
    'head:solo': 106,
    s0: 138,
    a3: 172,
    a4: 204,
  },
  leftDown: { 'head:beta': 2, b0: 34, b1: 66, a3: 100, s0: 132, a4: 164 },
} as const;

// Between two groups: a0 [Beta: b0 b1] [Solo: s0] [Gamma: g0 g1] a3, and s0
// dropped loose IN PLACE. Both bands then have a loose tab for a neighbour, so
// each keeps a band margin rather than the adjacent-group gap between them.
const SANDWICH = one([
  tab('a0'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('s0', 'solo'),
  tab('g0', 'gamma'),
  tab('g1', 'gamma'),
  tab('a3'),
]);
const SANDWICH_LEFT_IN_PLACE = one([
  tab('a0'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('s0'),
  tab('g0', 'gamma'),
  tab('g1', 'gamma'),
  tab('a3'),
]);
const SANDWICH_TRUTH = {
  before: {
    a0: 0,
    'head:beta': 34,
    b0: 66,
    b1: 98,
    'head:solo': 138,
    s0: 170,
    'head:gamma': 210,
    g0: 242,
    g1: 274,
    a3: 308,
  },
  // Gamma and everything under it come up 44: the chrome, plus the gap between
  // the two groups shrinking from 8 to 2 + 2.
  leftInPlace: {
    a0: 0,
    'head:beta': 34,
    b0: 66,
    b1: 98,
    s0: 132,
    'head:gamma': 166,
    g0: 198,
    g1: 230,
    a3: 264,
  },
} as const;

// Into ANOTHER window: w1 a0 [Solo: s0] a1, w2 c0 c1; s0 dropped after c0.
const ACROSS: SeedWindow[] = [
  { windowId: 'w1', tabs: [tab('a0'), tab('s0', 'solo'), tab('a1')] },
  { windowId: 'w2', tabs: [tab('c0'), tab('c1')] },
];
const ACROSS_LEFT: SeedWindow[] = [
  { windowId: 'w1', tabs: [tab('a0'), tab('a1')] },
  { windowId: 'w2', tabs: [tab('c0'), tab('s0'), tab('c1')] },
];
// w2's rows are relative to w1's container like everything else; the source
// block shrinks by 68 in truth, and the preview holds it (KAN-184: the source
// keeps its box), so only the SOURCE rows are compared against truth here.
const ACROSS_TRUTH = {
  before: { a0: 0, 'head:solo': 34, s0: 66, a1: 100, c0: 172, c1: 204 },
  left: { a0: 0, a1: 32, c0: 104, s0: 136, c1: 168 },
} as const;

// ---------------------------------------------------------------------------
test.describe('ground truth: what the drop actually does', () => {
  test('between loose tabs, before and after either exit', async ({
    context,
    extensionId,
  }) => {
    expect(await tops(await open(context, extensionId, LOOSE))).toEqual(
      LOOSE_TRUTH.before
    );
    expect(await tops(await open(context, extensionId, LOOSE_LEFT_UP))).toEqual(
      LOOSE_TRUTH.leftUp
    );
    expect(
      await tops(await open(context, extensionId, LOOSE_LEFT_DOWN))
    ).toEqual(LOOSE_TRUTH.leftDown);
  });

  test('with a group below, before and after joining it', async ({
    context,
    extensionId,
  }) => {
    expect(await tops(await open(context, extensionId, GROUP_BELOW))).toEqual(
      GROUP_BELOW_TRUTH.before
    );
    expect(
      await tops(await open(context, extensionId, GROUP_BELOW_JOINED))
    ).toEqual(GROUP_BELOW_TRUTH.joined);
  });

  test('leading the window, before and after leaving downward', async ({
    context,
    extensionId,
  }) => {
    expect(await tops(await open(context, extensionId, LEADING))).toEqual(
      LEADING_TRUTH.before
    );
    expect(
      await tops(await open(context, extensionId, LEADING_LEFT_DOWN))
    ).toEqual(LEADING_TRUTH.leftDown);
  });

  test('after another group, before and after leaving downward', async ({
    context,
    extensionId,
  }) => {
    expect(await tops(await open(context, extensionId, GROUP_ABOVE))).toEqual(
      GROUP_ABOVE_TRUTH.before
    );
    expect(
      await tops(await open(context, extensionId, GROUP_ABOVE_LEFT_DOWN))
    ).toEqual(GROUP_ABOVE_TRUTH.leftDown);
  });

  test('between two groups, before and after landing loose in place', async ({
    context,
    extensionId,
  }) => {
    expect(await tops(await open(context, extensionId, SANDWICH))).toEqual(
      SANDWICH_TRUTH.before
    );
    expect(
      await tops(await open(context, extensionId, SANDWICH_LEFT_IN_PLACE))
    ).toEqual(SANDWICH_TRUTH.leftInPlace);
  });

  test('into another window, before and after', async ({
    context,
    extensionId,
  }) => {
    expect(await tops(await open(context, extensionId, ACROSS))).toEqual(
      ACROSS_TRUTH.before
    );
    expect(await tops(await open(context, extensionId, ACROSS_LEFT))).toEqual(
      ACROSS_TRUTH.left
    );
  });
});

test.describe('the preview predicts the drop', () => {
  // The screenshot in the ticket. The band was drawn sliding down, a3 and a4
  // were drawn where they were, and the drop lifted them all.
  test('leaving upward: the band goes and the rows below close up', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, LOOSE);
    const { tops: p, removed } = await previewOfDragging(
      page,
      's0',
      await aboveBandY(page, 'solo')
    );

    expect(p.a3).toBe(LOOSE_TRUTH.leftUp.a3);
    expect(p.a4).toBe(LOOSE_TRUTH.leftUp.a4);
    expect(p.a2).toBe(LOOSE_TRUTH.leftUp.a2);
    expect(p.s0).toBe(LOOSE_TRUTH.leftUp.s0);

    // And no phantom title row: the band is marked, and its chrome is gone.
    expect(removed.solo).toEqual({ header: 0, strip: 0 });
  });

  test('leaving downward: the rows it passes close up by the row AND the band', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, LOOSE);
    const { tops: p, removed } = await previewOfDragging(
      page,
      's0',
      await rowY(page, 'a3', 0.9)
    );

    expect(p.a3).toBe(LOOSE_TRUTH.leftDown.a3);
    expect(p.s0).toBe(LOOSE_TRUTH.leftDown.s0);
    expect(p.a4).toBe(LOOSE_TRUTH.leftDown.a4);
    expect(removed.solo).toEqual({ header: 0, strip: 0 });
  });

  test('joining the group below: that group comes up by the band it replaces', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, GROUP_BELOW);
    const { tops: p, removed } = await previewOfDragging(
      page,
      's0',
      await titleRowY(page, 'beta')
    );

    expect(p['head:beta']).toBe(GROUP_BELOW_TRUTH.joined['head:beta']);
    expect(p.s0).toBe(GROUP_BELOW_TRUTH.joined.s0);
    expect(p.b0).toBe(GROUP_BELOW_TRUTH.joined.b0);
    expect(p.b1).toBe(GROUP_BELOW_TRUTH.joined.b1);
    expect(p.a3).toBe(GROUP_BELOW_TRUTH.joined.a3);
    expect(Object.keys(removed)).toEqual(['solo']);
  });

  test('leading the window: the rows below close up to the list’s top', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, LEADING);
    const { tops: p } = await previewOfDragging(
      page,
      's0',
      await rowY(page, 'a1', 0.9)
    );

    expect(p.a1).toBe(LEADING_TRUTH.leftDown.a1);
    expect(p.s0).toBe(LEADING_TRUTH.leftDown.s0);
    expect(p.a2).toBe(LEADING_TRUTH.leftDown.a2);
  });

  test('after another group: measured from that group’s tail', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, GROUP_ABOVE);
    const { tops: p } = await previewOfDragging(
      page,
      's0',
      await rowY(page, 'a3', 0.9)
    );

    expect(p.a3).toBe(GROUP_ABOVE_TRUTH.leftDown.a3);
    expect(p.s0).toBe(GROUP_ABOVE_TRUTH.leftDown.s0);
    expect(p.a4).toBe(GROUP_ABOVE_TRUTH.leftDown.a4);
    // The group above is untouched.
    expect(p['head:beta']).toBe(GROUP_ABOVE_TRUTH.leftDown['head:beta']);
    expect(p.b1).toBe(GROUP_ABOVE_TRUTH.leftDown.b1);
  });

  test('between two groups, landing loose in place: the gap closes to a margin each side', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, SANDWICH);
    const { tops: p } = await previewOfDragging(
      page,
      's0',
      (await page.locator('[data-band-id="solo"]').boundingBox())!.y - 4
    );

    expect(p['head:gamma']).toBe(SANDWICH_TRUTH.leftInPlace['head:gamma']);
    expect(p.g0).toBe(SANDWICH_TRUTH.leftInPlace.g0);
    expect(p.g1).toBe(SANDWICH_TRUTH.leftInPlace.g1);
    expect(p.a3).toBe(SANDWICH_TRUTH.leftInPlace.a3);
    expect(p.b1).toBe(SANDWICH_TRUTH.leftInPlace.b1);
    // Exact, including the adjacent-group margin the slot is measured under
    // (KAN-167).
    expect(p.s0).toBe(SANDWICH_TRUTH.leftInPlace.s0);
  });

  test('into another window: the source closes up, the destination is untouched', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, ACROSS);
    const { tops: p, removed } = await previewOfDragging(
      page,
      's0',
      await rowY(page, 'c0', 0.9)
    );

    expect(p.a1).toBe(ACROSS_TRUTH.left.a1);
    expect(removed.solo).toEqual({ header: 0, strip: 0 });
    // In the destination's own frame (KAN-132): c1 steps down a row for it,
    // and the slot is drawn where c1 was.
    expect(p.c1).toBe(ACROSS_TRUTH.before.c1 + 32);
    expect(p.s0).toBe(ACROSS_TRUTH.before.c1);
  });

  // Without this, a preview that removed EVERY band a member left would pass
  // everything above.
  test('CONTROL: a member of a larger group leaving is not a removal', async ({
    context,
    extensionId,
  }) => {
    const page = await open(
      context,
      extensionId,
      one([tab('a0'), tab('s0', 'solo'), tab('s1', 'solo'), tab('a3')])
    );
    const { tops: p, removed } = await previewOfDragging(
      page,
      's0',
      await aboveBandY(page, 'solo')
    );

    expect(removed).toEqual({});
    // KAN-168: the title row drops past it, and s1 holds still.
    expect(p['head:solo']).toBe(66);
    expect(p.s1).toBe(98);
    expect(
      await page
        .locator('[data-band-id="solo"] [data-group-drag-handle]')
        .evaluate((el) => getComputedStyle(el).opacity)
    ).toBe('1');
  });
});
