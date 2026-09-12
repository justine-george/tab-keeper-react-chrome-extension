// KAN-166. A tab dropped on a group's TITLE row joins that group, and the
// preview has to show what that release will do.
//
// The test is in two halves, and the pairing is the point. The GROUND TRUTH
// half renders the arrangements moveTabInternal produces and measures them --
// no drag, so nothing races. The PREVIEW half drives the real drag and asserts
// the preview predicts those same numbers. A preview that is merely
// self-consistent cannot pass: it is checked against the layout the drop
// actually lands in.
//
// The defect this pins: dropping a loose tab on a group's title contradicted
// itself. Nothing stepped aside -- the tab keeps its row index, only its
// membership changes -- so its old slot stayed open as a hole while the dashed
// landing slot was drawn on top of the group's first member.

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

// Three loose tabs, a three-member group, one loose tab.
const BEFORE: Tab[] = [
  tab('a0'),
  tab('a1'),
  tab('a2'),
  tab('alpha0', 'alpha'),
  tab('alpha1', 'alpha'),
  tab('alpha2', 'alpha'),
  tab('a3'),
];

// The two post-drop arrangements, read out of moveTabInternal rather than
// guessed: it splices the tab out and back in at the landing index and sets
// chromeGroupId. a2 comes from directly above, so its index does not change
// and only its membership does; a3 comes from below and moves 6 -> 3.
const AFTER_FROM_ABOVE: Tab[] = [
  tab('a0'),
  tab('a1'),
  tab('a2', 'alpha'),
  tab('alpha0', 'alpha'),
  tab('alpha1', 'alpha'),
  tab('alpha2', 'alpha'),
  tab('a3'),
];

const AFTER_FROM_BELOW: Tab[] = [
  tab('a0'),
  tab('a1'),
  tab('a2'),
  tab('a3', 'alpha'),
  tab('alpha0', 'alpha'),
  tab('alpha1', 'alpha'),
  tab('alpha2', 'alpha'),
];

// alpha0 LEAVES Alpha, dragged up out of its band (KAN-168). Its row index is
// unchanged -- moveTabInternal splices it out and back in at 3 and drops the
// membership -- so alpha1 inherits the group and alpha0 sits loose above it.
const AFTER_LEAVING: Tab[] = [
  tab('a0'),
  tab('a1'),
  tab('a2'),
  tab('alpha0'),
  tab('alpha1', 'alpha'),
  tab('alpha2', 'alpha'),
  tab('a3'),
];

// a2 joins Alpha at its SECOND position (KAN-170), from directly above. Unlike
// the head case its row index DOES change -- 2 -> 3 -- because it now has to
// pass alpha0 as well as the title row.
const AFTER_SECOND_POSITION: Tab[] = [
  tab('a0'),
  tab('a1'),
  tab('alpha0', 'alpha'),
  tab('a2', 'alpha'),
  tab('alpha1', 'alpha'),
  tab('alpha2', 'alpha'),
  tab('a3'),
];

const ROWS = ['a0', 'a1', 'a2', 'a3', 'alpha0', 'alpha1', 'alpha2'] as const;

// Measured in the real popup at 790x550 on 2026-09-12, tops relative to a0.
// Pinned rather than derived so a layout change fails loudly here instead of
// quietly re-baselining the preview assertions that share these numbers.
const TRUTH = {
  before: {
    a0: 0,
    a1: 32,
    a2: 64,
    header: 98,
    alpha0: 130,
    alpha1: 162,
    alpha2: 194,
    a3: 228,
  },
  // a2 and the title row SWAP. Nothing below them moves at all -- which is why
  // the old preview drew the landing slot on an occupied row.
  fromAbove: {
    a0: 0,
    a1: 32,
    a2: 98,
    header: 66,
    alpha0: 130,
    alpha1: 162,
    alpha2: 194,
    a3: 228,
  },
  // KAN-168. alpha0 leaves Alpha upward. The exact inverse of fromAbove: the
  // tab and the title row swap back, and the members it leaves behind do not
  // move. PREDICTED from fromAbove and then measured -- if the prediction is
  // wrong this is the assertion that says so.
  leaving: {
    a0: 0,
    a1: 32,
    a2: 64,
    alpha0: 96,
    header: 130,
    alpha1: 162,
    alpha2: 194,
    a3: 228,
  },
  // KAN-170. a2 dropped on Alpha's SECOND slot, from above. The title row and
  // alpha0 both step up past it; everything below alpha0 holds still.
  secondPosition: {
    a0: 0,
    a1: 32,
    header: 66,
    alpha0: 98,
    a2: 130,
    alpha1: 162,
    alpha2: 194,
    a3: 228,
  },
  // The mirror image, and not a mirror of the shifts: here the MEMBERS move
  // down and the title row does not move.
  fromBelow: {
    a0: 0,
    a1: 32,
    a2: 64,
    header: 98,
    a3: 130,
    alpha0: 162,
    alpha1: 194,
    alpha2: 226,
  },
} as const;

async function open(
  context: BrowserContext,
  extensionId: string,
  tabs: Tab[]
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Join preview',
    isSelected: true,
    windowCount: 1,
    tabCount: tabs.length,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: tabs.length,
        title: 'w1',
        tabs,
        chromeTabGroups: [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }],
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
  // goto resolves before React mounts (KAN-105), and the bands need the grant.
  await expect(page.locator('[data-band-id="alpha"]')).toBeAttached();
  expect(
    await page.evaluate(() =>
      chrome.permissions.contains({ permissions: ['tabGroups'] })
    )
  ).toBe(true);
  return page;
}

// Every row's top plus the title row's, relative to a0 so the arrangements are
// comparable however the pane happens to be scrolled.
const tops = (page: Page) =>
  page.evaluate((rows: readonly string[]) => {
    const out: Record<string, number> = {};
    const at = (el: Element | null) =>
      el ? el.getBoundingClientRect().top : NaN;
    for (const id of rows) {
      out[id] = at(document.querySelector(`[data-drag-row-id="${id}"]`));
    }
    out.header = at(
      document.querySelector('[data-band-id="alpha"] [data-group-drag-handle]')
    );
    const base = out.a0;
    for (const k of Object.keys(out)) out[k] = Math.round(out[k] - base);
    return out;
  }, ROWS);

test.describe('ground truth: what the drop actually does', () => {
  test('before the drop', async ({ context, extensionId }) => {
    expect(await tops(await open(context, extensionId, BEFORE))).toEqual(
      TRUTH.before
    );
  });

  test('a2 joining Alpha from above swaps it with the title row', async ({
    context,
    extensionId,
  }) => {
    expect(
      await tops(await open(context, extensionId, AFTER_FROM_ABOVE))
    ).toEqual(TRUTH.fromAbove);
  });

  test('a3 joining Alpha from below pushes the members down', async ({
    context,
    extensionId,
  }) => {
    expect(
      await tops(await open(context, extensionId, AFTER_FROM_BELOW))
    ).toEqual(TRUTH.fromBelow);
  });

  test('a2 joining Alpha at its second position passes alpha0 too', async ({
    context,
    extensionId,
  }) => {
    expect(
      await tops(await open(context, extensionId, AFTER_SECOND_POSITION))
    ).toEqual(TRUTH.secondPosition);
  });

  test('alpha0 leaving Alpha upward swaps it back past the title row', async ({
    context,
    extensionId,
  }) => {
    expect(await tops(await open(context, extensionId, AFTER_LEAVING))).toEqual(
      TRUTH.leaving
    );
  });
});

// Drag `rowId` onto Alpha's title row and read the preview WITHOUT releasing,
// so the measurement is of the preview rather than of the committed drop.
//
// Returns each element's previewed top: its pre-drag top plus whatever the
// drag has translated it by, and for the held row the landing slot's own
// position -- which is where the preview PROMISES the row will settle.
//
// Read from the COMMANDED transform, never from the animating box: rows carry
// `transition: transform 0.18s`, so a rect read straight after the last
// pointer move catches them at the start of the ease and reports a row that is
// about to move as one that is not. Measured -- the members read 130 mid-flight
// where they settle at 164.
// The middle of Alpha's title row: inside the band, so a release joins Alpha.
const titleRowY = async (page: Page) => {
  const b = (await page
    .locator('[data-band-id="alpha"] [data-group-drag-handle]')
    .boundingBox())!;
  return b.y + b.height / 2;
};

// Just ABOVE the band, in the lower part of the last loose tab over it. A
// release here is outside every band, so it leaves the group -- and the window
// is narrow on purpose: higher passes a2's midpoint and changes the row index
// too, which is a different case (KAN-168 covers only the index-preserving one).
const aboveBandY = async (page: Page) => {
  const band = (await page.locator('[data-band-id="alpha"]').boundingBox())!;
  return band.y - 6;
};

// Inside the band, but PAST alpha0's midpoint -- so the landing index names
// the second slot rather than the first. The strip between alpha0's midpoint
// and the band's bottom edge is where "which member does it land beside?" has
// to be answered by the index rather than by the band (KAN-170).
const secondSlotY = async (page: Page) => {
  const b = (await page.locator('[data-drag-row-id="alpha0"]').boundingBox())!;
  return b.y + b.height * 0.75;
};

async function previewOfDragging(
  page: Page,
  rowId: string,
  toY: number,
  opts: { settle?: boolean } = {}
) {
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
  // The frame's own parts carry a 0.18s transition (KAN-165), so anything read
  // from a RECT rather than from a commanded transform has to wait it out.
  if (opts.settle) await page.waitForTimeout(400);

  const preview = await page.evaluate(
    ([rows, held, pre]: [
      readonly string[],
      string,
      Record<string, number>,
    ]) => {
      const shiftOf = (el: HTMLElement | null) =>
        el
          ? Number(
              /translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0
            )
          : NaN;
      const rowEl = (id: string) =>
        document.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`);

      // Where the preview says each element will settle: its pre-drag slot
      // plus the translate the drag has commanded.
      const out: Record<string, number> = {};
      for (const id of rows) out[id] = pre[id] + shiftOf(rowEl(id));
      out.header =
        pre.header +
        shiftOf(
          document.querySelector<HTMLElement>(
            '[data-band-id="alpha"] [data-group-drag-handle]'
          )
        );

      // The held row tracks the pointer, so its own box says nothing about
      // where it lands. The landing slot does -- and it carries no transition,
      // so its box is the commanded position already.
      const slot = document.querySelector<HTMLElement>(
        '[data-drag-landing-slot]'
      );
      const a0 = rowEl('a0')!;
      out[held] = slot
        ? Math.round(
            slot.getBoundingClientRect().top -
              (a0.getBoundingClientRect().top - shiftOf(a0))
          )
        : NaN;
      return out;
    },
    [ROWS, rowId, before] as [readonly string[], string, Record<string, number>]
  );

  if (opts.settle) return preview;
  // Escape rather than release: this asserts on the preview, and a commit
  // would rewrite the very layout being measured.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  return preview;
}

// The band's painted box, its title row and its colour strip, relative to a0.
// KAN-171: these three have to describe the group the DROP will make, and the
// band's own box never moves on its own -- a transform on the title row cannot
// change its parent's layout box.
const framePaint = (page: Page) =>
  page.evaluate(() => {
    const base = document
      .querySelector('[data-drag-row-id="a0"]')!
      .getBoundingClientRect().top;
    const at = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top - base),
        bottom: Math.round(r.bottom - base),
      };
    };
    return {
      band: at(document.querySelector('[data-band-id="alpha"]')),
      strip: at(
        document.querySelector(
          '[data-band-id="alpha"] [data-group-color-strip]'
        )
      ),
    };
  });

// The painted extent a group's frame should show, which is NOT its layout box
// once the preview has moved anything. Measured from the tint and the strip.
const framePreview = (page: Page) =>
  page.evaluate(() => {
    const base = document
      .querySelector('[data-drag-row-id="a0"]')!
      .getBoundingClientRect().top;
    const paint = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const before = getComputedStyle(el, '::before');
      // The paint layer, where there is one, is what carries the extent.
      const top = parseFloat(before.top);
      const bottom = parseFloat(before.bottom);
      if (before.content === 'none' || Number.isNaN(top)) {
        return {
          top: Math.round(r.top - base),
          bottom: Math.round(r.bottom - base),
        };
      }
      return {
        top: Math.round(r.top - base + top),
        bottom: Math.round(r.bottom - base - bottom),
      };
    };
    return {
      band: paint('[data-band-id="alpha"]'),
      strip: paint('[data-band-id="alpha"] [data-group-color-strip]'),
    };
  });

test.describe('the preview predicts the drop', () => {
  test('a2 dropped on the title: the title row rises and the members hold still', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, BEFORE);
    const preview = await previewOfDragging(page, 'a2', await titleRowY(page));

    // The members and the tab below the group do not move, and the landing
    // slot therefore must NOT be drawn on top of any of them.
    expect(preview.alpha0).toBe(TRUTH.fromAbove.alpha0);
    expect(preview.alpha1).toBe(TRUTH.fromAbove.alpha1);
    expect(preview.alpha2).toBe(TRUTH.fromAbove.alpha2);
    expect(preview.a3).toBe(TRUTH.fromAbove.a3);

    // The slot the held tab is promised is exactly where it lands.
    expect(preview.a2).toBe(TRUTH.fromAbove.a2);

    // The title row rises to make that room. Quantised to the held row's
    // footprint (34) where the truth is 32, because a tab joining a group also
    // stops paying the 2px margin beside the band -- KAN-167. Asserted as the
    // number the engine actually produces, with the 2px named rather than
    // hidden behind a tolerance.
    expect(preview.header).toBe(TRUTH.before.header - 34);
    expect(preview.header).toBeLessThan(TRUTH.before.header);
  });

  test('a3 dropped on the title: the members move down and the title row holds still', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, BEFORE);
    const preview = await previewOfDragging(page, 'a3', await titleRowY(page));

    // The frame does NOT travel, though every one of its members moves alike.
    // That is the case the unanimity rule could not express.
    expect(preview.header).toBe(TRUTH.before.header);

    expect(preview.alpha0).toBe(TRUTH.before.alpha0 + 34);
    expect(preview.alpha1).toBe(TRUTH.before.alpha1 + 34);
    expect(preview.alpha2).toBe(TRUTH.before.alpha2 + 34);

    // Exact, in the direction the index alone already described.
    expect(preview.a3).toBe(TRUTH.fromBelow.a3);
  });

  // KAN-171, reported from the shipped build. A group's frame changes LENGTH
  // when a tab joins it, and a transform can only express POSITION -- so the
  // tinted box kept its resting extent while the title row moved out of the
  // top of it, and the strip moved up rigidly and fell short at the bottom.
  test('a2 dropped on the title: the band and its strip cover the group the drop will make', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, BEFORE);

    const rest = await framePaint(page);
    expect(rest.band).toEqual({ top: 98, bottom: 226 });
    expect(rest.strip).toEqual({ top: 98, bottom: 226 });

    await previewOfDragging(page, 'a2', await titleRowY(page), {
      settle: true,
    });
    const painted = await framePreview(page);

    // The drop makes the band 66..226. The preview is allowed the usual 2px of
    // KAN-167 at the moving edge; the fixed edge has to be exact.
    expect(painted.band!.top).toBe(TRUTH.fromAbove.header - 2);
    expect(painted.band!.bottom).toBe(rest.band!.bottom);

    // And the strip covers the same extent, rather than keeping its length.
    expect(painted.strip!.top).toBe(painted.band!.top);
    expect(painted.strip!.bottom).toBe(painted.band!.bottom);

    // THE HIT AREA MUST NOT MOVE. Growing the frame previews the RESULT; it
    // does not make the target bigger. bandAt reads this box on every pointer
    // move, so a band that grew its own hit area would keep the pointer inside
    // itself and LATCH as the drop target -- measured in CI, where a pointer
    // moved clear of every band left one still marked.
    // PREMISE: the band's painted box really did grow past its resting top,
    // so the strip of screen tested below exists at all.
    expect(painted.band!.top).toBeLessThan(rest.band!.top);
  });

  // KAN-171, found by CI rather than by the eye. Growing the band previews the
  // RESULT; it must not enlarge the TARGET. It did, and the result was a latch:
  // marking a band grew its box, the grown box kept the pointer inside it, and
  // bandAt went on naming it however far the pointer moved out. A first attempt
  // at this asserted the geometry instead and could not see the bug at all --
  // restoring the border box left it green.
  test('a band that has grown does not capture the pointer in the space it grew into', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, BEFORE);
    const restTop = (await page
      .locator('[data-band-id="alpha"]')
      .boundingBox())!.y;

    await previewOfDragging(page, 'a2', await titleRowY(page), {
      settle: true,
    });
    const isTarget = () =>
      page.evaluate(() =>
        document
          .querySelector('[data-band-id="alpha"]')!
          .hasAttribute('data-drop-target')
      );

    // PREMISE: it is the drop target, and it grew upward past its resting top.
    expect(await isTarget()).toBe(true);
    const grownTop = (await page
      .locator('[data-band-id="alpha"]')
      .boundingBox())!.y;
    expect(grownTop).toBeLessThan(restTop - 4);

    // Into the strip the band grew into: above where it rests, inside where it
    // now paints. Released here the tab lands ungrouped, so the band must let
    // the pointer go.
    const box = (await page.locator('[data-drag-row-id="a2"]').boundingBox())!;
    await page.mouse.move(box.x + 40, (grownTop + restTop) / 2, { steps: 4 });

    await expect.poll(isTarget).toBe(false);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  // KAN-170, reported from the shipped build. Aiming at the group's SECOND
  // slot from above drew the slot in its FIRST, because the rule that spots a
  // tab landing at the head compared two indices counted in different lists:
  // toIndex counts the rows with the held one lifted out, groupFirstIndex
  // counts all of them, and those agree only when the held row is BELOW the
  // group. The drop was right the whole time; only the preview lied.
  test('a2 dropped on the second slot: the slot goes there, not to the head', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, BEFORE);
    const preview = await previewOfDragging(
      page,
      'a2',
      await secondSlotY(page)
    );

    // Below alpha0, not above it. This is the assertion the screenshot failed.
    expect(preview.a2).toBe(TRUTH.secondPosition.a2);
    expect(preview.a2).toBeGreaterThan(preview.alpha0);

    // alpha0 steps up past the held row as well as the title row does.
    expect(preview.alpha0).toBe(TRUTH.secondPosition.alpha0 - 2);
    expect(preview.header).toBe(TRUTH.secondPosition.header - 2);

    // Nothing below the slot moves.
    expect(preview.alpha1).toBe(TRUTH.secondPosition.alpha1);
    expect(preview.alpha2).toBe(TRUTH.secondPosition.alpha2);
    expect(preview.a3).toBe(TRUTH.secondPosition.a3);
  });

  // KAN-168, reported from the shipped build. Leaving a group changes the tab's
  // membership without changing its row index, which is the same blind spot
  // KAN-166 fixed for joining -- so the slot was drawn at the tab's own origin,
  // INSIDE the band and under the title row, while the drop put it above.
  test('alpha0 dragged out: the title row drops below it and the slot leaves the band', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, BEFORE);
    const preview = await previewOfDragging(
      page,
      'alpha0',
      await aboveBandY(page)
    );

    // The promised slot is ABOVE the title row, not under it. This is the
    // assertion the screenshot failed: the slot sat at 130, its own origin,
    // inside the band.
    expect(preview.alpha0).toBeLessThan(preview.header);

    // 2px below where it lands, and this direction is where KAN-167 shows up
    // in the SLOT rather than only in the shifts: leaving the band stops the
    // tab paying the band's 2px margin, which the measured tops cannot know in
    // advance. Asserted as the number the engine produces, with the 2px named.
    expect(preview.alpha0).toBe(TRUTH.leaving.alpha0 + 2);

    // The title row drops to make way, and the members left behind hold still.
    expect(preview.header).toBe(TRUTH.leaving.header);
    expect(preview.alpha1).toBe(TRUTH.leaving.alpha1);
    expect(preview.alpha2).toBe(TRUTH.leaving.alpha2);
    expect(preview.a3).toBe(TRUTH.leaving.a3);
  });
});
