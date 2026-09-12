import type { BrowserContext, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-160 in the real popup size (790x550, measured 2026-09-10). Every drag
// starts SCROLLED, because scrollTop 0 is the one position where stale-origin
// bugs cannot appear. "Where the user pointed" is read off the preview at
// release, not predicted from rects.

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});
const loose = (p: string, n: number) =>
  Array.from({ length: n }, (_, i) => tab(`${p}${i}`));
const members = (g: string, n: number) =>
  Array.from({ length: n }, (_, i) => tab(`${g}${i}`, g));
const win = (
  id: string,
  tabs: ReturnType<typeof tab>[],
  groups: { groupId: string; title: string; color: string }[] = []
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

// w1 items: [tab:a0, group:alpha, tab:a1, group:beta, group:gamma]
const WINDOWS = [
  win('w0', loose('p', 10)),
  win(
    'w1',
    [
      tab('a0'),
      ...members('alpha', 3),
      tab('a1'),
      ...members('beta', 3),
      ...members('gamma', 3),
    ],
    [
      { groupId: 'alpha', title: 'Alpha', color: 'blue' },
      { groupId: 'beta', title: 'Beta', color: 'red' },
      { groupId: 'gamma', title: 'Gamma', color: 'green' },
    ]
  ),
  win(
    'w2',
    [...loose('q', 2), ...members('delta', 3)],
    [{ groupId: 'delta', title: 'Delta', color: 'grey' }]
  ),
];

async function open(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Group drag',
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
  // goto resolves before React mounts (KAN-105); the premise needs the grant.
  await expect(page.locator('[data-drag-row-id="group:gamma"]')).toBeAttached();
  expect(
    await page.evaluate(() =>
      chrome.permissions.contains({ permissions: ['tabGroups'] })
    )
  ).toBe(true);
  return page;
}

// Scroll the pane so the group about to be grabbed sits at its MIDDLE --
// scrolled, because scrollTop 0 hides the stale-origin bugs, and clear of both
// 48px auto-scroll zones, because a pick-up inside one scrolls the list under
// the held row and measures a moving target. Then install the release-time
// preview recorder. Returns the pane's box and scroll.
async function scrollToGroupAndRecord(page: Page, groupId: string) {
  return page.evaluate((groupId) => {
    const w1 = document.querySelector<HTMLElement>('[data-drag-row-id="w1"]')!;
    let pane = w1.parentElement;
    while (
      pane &&
      !['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)
    )
      pane = pane.parentElement;
    const handle = document
      .querySelector(
        `[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`
      )!
      .getBoundingClientRect();
    const paneBox = pane!.getBoundingClientRect();
    pane!.scrollTop +=
      handle.top + handle.height / 2 - (paneBox.top + paneBox.height / 2);

    const w = window as unknown as { __preview: number | null };
    w.__preview = null;
    window.addEventListener(
      'pointerup',
      () => {
        const rows = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-drag-row-id="w1"] [data-drag-row-id^="tab:"], [data-drag-row-id="w1"] [data-drag-row-id^="group:"]'
          ),
        ];
        const from = rows.findIndex((r) => r.style.boxShadow !== '');
        const shift = (r: HTMLElement) =>
          Number(
            /translateY\((-?[\d.]+)px\)/.exec(r.style.transform)?.[1] ?? 0
          );
        const up = rows.filter((r, i) => i !== from && shift(r) < 0).length;
        const down = rows.filter((r, i) => i !== from && shift(r) > 0).length;
        w.__preview = from + up - down;
      },
      { capture: true, once: true }
    );

    const b = pane!.getBoundingClientRect();
    return {
      scrollTop: pane!.scrollTop,
      top: b.top,
      bottom: b.bottom,
      left: b.left,
      right: b.right,
    };
  }, groupId);
}

const paneScrollTop = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector<HTMLElement>(
      '[data-drag-row-id="w1"]'
    )!.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    return el!.scrollTop;
  });

// w1's stored items, derived from the stored tab order.
const itemOrder = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tabContainerData')!) as {
      tabGroups: {
        tabGroupId: string;
        windows: {
          windowId: string;
          tabs: { tabId: string; chromeGroupId?: string }[];
        }[];
      }[];
    };
    const tabs = data.tabGroups
      .find((g) => g.tabGroupId === 's1')!
      .windows.find((w) => w.windowId === 'w1')!.tabs;
    const ids: string[] = [];
    for (const t of tabs) {
      const id = t.chromeGroupId
        ? `group:${t.chromeGroupId}`
        : `tab:${t.tabId}`;
      if (ids[ids.length - 1] !== id) ids.push(id);
    }
    return ids;
  });

const START = ['tab:a0', 'group:alpha', 'tab:a1', 'group:beta', 'group:gamma'];

async function grab(page: Page, groupId: string) {
  const b = (await page
    .locator(`[data-drag-row-id="group:${groupId}"] [data-group-drag-handle]`)
    .boundingBox())!;
  const at = { x: b.x + 40, y: b.y + b.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  // Sideways past the activation distance: zero vertical travel.
  await page.mouse.move(at.x + 8, at.y, { steps: 2 });
  return at;
}

test.describe('dragging a group', () => {
  test('from a scrolled position, compresses only the held group and lands where the preview showed', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const pane = await scrollToGroupAndRecord(page, 'gamma');
    expect(pane.scrollTop).toBeGreaterThan(0);

    const at = await grab(page, 'gamma');
    const mid = await page.evaluate(() => {
      const display = (sel: string) =>
        getComputedStyle(document.querySelector(sel)!).display;
      const alpha = document
        .querySelector('[data-drag-row-id="group:alpha"]')!
        .getBoundingClientRect();
      return {
        gamma: display('[data-drag-row-id="group:gamma"] [data-group-tabs]'),
        others: [
          display('[data-drag-row-id="group:alpha"] [data-group-tabs]'),
          display('[data-drag-row-id="group:beta"] [data-group-tabs]'),
        ],
        otherWindow: display('[data-drag-row-id="w2"] [data-group-tabs]'),
        alpha: { top: alpha.top, height: alpha.height },
      };
    });
    expect(mid.gamma).toBe('none');
    // Only the held group folds (KAN-161 kept main's pick-up rule).
    expect(mid.others).not.toContain('none');
    expect(mid.otherWindow).not.toBe('none');
    // KAN-135 for groups: the held title row is hovered for the whole drag.
    // Polled: this strip carries its own 0.1s opacity transition, so the
    // rule fades it out rather than cutting it -- read at once it is mid-fade.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            getComputedStyle(
              document.querySelector(
                // The strip INSIDE the title row: a bare [data-row-actions] under the
                // group also matches its members' delete strips, which the
                // rule already hides -- that passed with the group strip unmarked.
                '[data-drag-row-id="group:gamma"] [data-group-drag-handle] .group-rename-reveal'
              )!
            ).opacity
        )
      )
      .toBe('0');

    // Just above Alpha's midpoint: a real mid-list slot, not an end.
    await page.mouse.move(at.x + 8, mid.alpha.top + mid.alpha.height / 2 - 6, {
      steps: 12,
    });
    await page.mouse.up();

    const preview = await page.evaluate(
      () => (window as unknown as { __preview: number | null }).__preview
    );
    expect(preview).toBeGreaterThan(0);
    expect(preview).toBeLessThan(START.length - 1);
    await expect
      .poll(async () => (await itemOrder(page)).indexOf('group:gamma'))
      .toBe(preview);
  });

  // KAN-132: a group cannot move to another window, so a release over one is
  // refused. Three things make this a real control, each learnt the hard way:
  // - Over ANOTHER WINDOW, not "above the pane": with the list scrolled, rows
  //   above the pane still exist in content space, and a release there lands
  //   among them as auto-scroll brings them in (KAN-152, preview agreeing).
  // - Inside the pane, and asserted: a release outside it is refused whatever
  //   the list does, so it cannot tell refusal from a list that clamps drops
  //   to its ends.
  // - Alpha, the FIRST group: a clamp would pull it to the top, visibly. The
  //   last group clamped to the end would land in its own slot.
  test('CONTROL: released over the window above, nothing moves and the view comes back', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const pane = await scrollToGroupAndRecord(page, 'alpha');
    const at = await grab(page, 'alpha');
    const overW0 = await page.evaluate(() => {
      const r = document
        .querySelector('[data-drag-row-id="p9"]')!
        .getBoundingClientRect();
      return r.top + r.height / 2;
    });
    // PREMISE: inside the pane -- BOTH axes; x = 60 was over the session list
    // and refused a clamping mutant too -- and clear of both auto-scroll zones.
    expect(overW0).toBeGreaterThan(pane.top + 48);
    expect(overW0).toBeLessThan(pane.bottom - 48);
    expect(at.x + 8).toBeGreaterThan(pane.left);
    expect(at.x + 8).toBeLessThan(pane.right);
    await page.mouse.move(at.x + 8, overW0, { steps: 12 });
    await page.mouse.up();
    expect(await itemOrder(page)).toEqual(START);
    await expect.poll(() => paneScrollTop(page)).toBe(pane.scrollTop);
  });

  // Gamma has two open groups above it. With every group folding it would
  // open 128px below its own slot, REFUSED (measured, KAN-161), and a refused
  // release ALSO changes nothing, so the order alone cannot tell "home" from
  // "refused". The gap above the held row can: at home it sits against the
  // item above it, with only the band margin between.
  test('a zero-travel pick-up stays in its slot and changes nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await scrollToGroupAndRecord(page, 'gamma');
    const scrollBefore = await paneScrollTop(page);
    await grab(page, 'gamma');
    // PREMISE: no auto-scroll moved the list under the held row.
    expect(await paneScrollTop(page)).toBe(scrollBefore);
    const gapAbove = await page.evaluate(() => {
      const held = document
        .querySelector('[data-drag-row-id="group:gamma"]')!
        .getBoundingClientRect();
      const above = document
        .querySelector('[data-drag-row-id="group:beta"]')!
        .getBoundingClientRect();
      return held.top - above.bottom;
    });
    await page.mouse.up();
    expect(gapAbove).toBeLessThanOrEqual(4);
    expect(await itemOrder(page)).toEqual(START);
  });

  test('a move just past the open group above lands one slot up', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await scrollToGroupAndRecord(page, 'gamma');
    const at = await grab(page, 'gamma');
    const betaMid = await page.evaluate(() => {
      const b = document
        .querySelector('[data-drag-row-id="group:beta"]')!
        .getBoundingClientRect();
      return b.top + b.height / 2;
    });
    await page.mouse.move(at.x + 8, betaMid - 6, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(() => itemOrder(page))
      .toEqual([
        'tab:a0',
        'group:alpha',
        'tab:a1',
        'group:gamma',
        'group:beta',
      ]);
  });

  // CONTROL for the one above: the same gesture from the top group, past the
  // loose tab above it.
  test('CONTROL: the same move from the top group', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await scrollToGroupAndRecord(page, 'alpha');
    const at = await grab(page, 'alpha');
    const a0Mid = await page.evaluate(() => {
      const b = document
        .querySelector('[data-drag-row-id="tab:a0"]')!
        .getBoundingClientRect();
      return b.top + b.height / 2;
    });
    await page.mouse.move(at.x + 8, a0Mid - 6, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(() => itemOrder(page))
      .toEqual([
        'group:alpha',
        'tab:a0',
        'tab:a1',
        'group:beta',
        'group:gamma',
      ]);
  });

  // KAN-162 in a real browser: a real selection gesture in a real input.
  test('selecting text in a group rename field starts no drag', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await scrollToGroupAndRecord(page, 'beta');
    await page
      .locator('[data-drag-row-id="group:beta"] [aria-label="Rename group"]')
      .click();
    const input = page.locator('[data-drag-row-id="group:beta"] input');
    await expect(input).toBeFocused();
    const b = (await input.boundingBox())!;
    await page.mouse.move(b.x + 6, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 8 });
    const during = await page.evaluate(() => ({
      dragging: document.documentElement.getAttribute('data-dragging'),
      selection: (() => {
        const i = document.activeElement as HTMLInputElement;
        return (i.selectionEnd ?? 0) - (i.selectionStart ?? 0);
      })(),
    }));
    await page.mouse.up();
    expect(during.dragging).toBeNull();
    expect(during.selection).toBeGreaterThan(0);
    expect(await itemOrder(page)).toEqual(START);
  });
});

// KAN-163 in the group list: the same defect at a different margin, which is
// why the fix reads the gap instead of naming it. Measured here, held group
// compressed: 32px tall, 34px apart -- a 2px gap, from the band's `margin:
// 2px 0`.
//
// Not the 4px the KAN-160 spec predicted. That figure came from an UNFOLDED
// group, 96px against a 100px pitch, and the drag never measures that layout:
// the rects are taken after the held group compresses. A prediction made in the
// wrong one of the two layouts, which is the standing hazard in this engine.
test.describe('the gap a group drag opens', () => {
  test('the item stepping aside lands on the vacated slot, margin included', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const pane = await scrollToGroupAndRecord(page, 'alpha');
    const at = await grab(page, 'alpha');

    // Down past the next item's midpoint in the compressed layout, so it steps.
    await page.mouse.move(at.x + 8, at.y + 50, { steps: 8 });
    // The step is animated (0.18s); measuring early reads it part-way.
    await page.waitForTimeout(320);

    const geom = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-drag-row-id="w1"] [data-drag-row-id^="tab:"], [data-drag-row-id="w1"] [data-drag-row-id^="group:"]'
        ),
      ];
      const shift = (r: HTMLElement) =>
        Number(/translateY\((-?[\d.]+)px\)/.exec(r.style.transform)?.[1] ?? 0);
      const layoutTop = (r: HTMLElement) =>
        r.getBoundingClientRect().top - shift(r);

      const from = rows.findIndex((r) => r.hasAttribute('data-drag-held'));
      const held = rows[from];
      const stepped = rows[from + 1];
      return {
        from,
        heldHeight: held.getBoundingClientRect().height,
        pitch: layoutTop(stepped) - layoutTop(held),
        slotTop: layoutTop(held),
        steppedTop: stepped.getBoundingClientRect().top,
        steppedShift: shift(stepped),
      };
    });

    await page.keyboard.press('Escape');
    await page.mouse.up();

    // PREMISES: the held row is the group, the pick-up scrolled nothing, there
    // is a margin to forget at all, and the row below really stepped.
    expect(geom.from).toBe(1);
    expect(await paneScrollTop(page)).toBe(pane.scrollTop);
    expect(geom.pitch).toBeGreaterThan(geom.heldHeight);
    expect(geom.steppedShift).toBeLessThan(0);

    // THE CLAIM.
    expect(geom.steppedTop).toBeCloseTo(geom.slotTop, 0);

    expect(await itemOrder(page)).toEqual(START);
  });
});

// KAN-163, the case the window and item lists cannot show. The `tabs` scope is
// a FLAT list of every tab in the window, so two consecutive rows in it are not
// necessarily consecutive in the LAYOUT: between the last tab before a group
// and that group's first member sits the group's band header, 32px belonging to
// neither row. Measuring a footprint as "the distance to the next row's top"
// swallows it, and the held tab reports 66px instead of its own 34.
//
// The oracle is built from rows the held one is not involved in: a tab's
// footprint is its own height plus the gap the item list puts between items,
// measured between the group above and the tab below it.
test.describe('a tab dragged across a group boundary', () => {
  test('steps the rows below it by its own footprint, not across the band', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    // Centre the tab in the pane: clear of both 48px auto-scroll zones, so the
    // pick-up cannot measure a list that is moving under it.
    const before = await page.evaluate(() => {
      const w1 = document.querySelector<HTMLElement>(
        '[data-drag-row-id="w1"]'
      )!;
      let pane = w1.parentElement;
      while (
        pane &&
        !['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)
      )
        pane = pane.parentElement;
      const held = document.querySelector<HTMLElement>(
        '[data-drag-row-id="a0"]'
      )!;
      const hb = held.getBoundingClientRect();
      const pb = pane!.getBoundingClientRect();
      pane!.scrollTop += hb.top + hb.height / 2 - (pb.top + pb.height / 2);

      const box = (sel: string) =>
        document.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
      const h = box('[data-drag-row-id="a0"]');
      return {
        heldHeight: h.height,
        // The item list's own separation, measured away from the held row.
        itemGap:
          box('[data-drag-row-id="tab:a1"]').top -
          box('[data-drag-row-id="group:alpha"]').bottom,
        grabX: h.left + 80,
        grabY: h.top + h.height / 2,
      };
    });

    await page.mouse.move(before.grabX, before.grabY);
    await page.mouse.down();
    await page.mouse.move(before.grabX, before.grabY + 10, { steps: 3 });
    // Past the first group member's midpoint, so it has to step up. That
    // midpoint is a band header further down than the tab pitch suggests.
    await page.mouse.move(before.grabX, before.grabY + 110, { steps: 10 });
    // The step is animated (0.18s); measuring early reads it part-way.
    await page.waitForTimeout(320);

    const shifted = await page.evaluate(() => {
      const shift = (el: HTMLElement) =>
        Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);
      const first = document.querySelector<HTMLElement>(
        '[data-drag-row-id="alpha0"]'
      )!;
      return {
        heldIsTab: !!document.querySelector(
          '[data-drag-row-id="a0"][data-drag-held]'
        ),
        steppedBy: Math.abs(shift(first)),
      };
    });

    await page.keyboard.press('Escape');
    await page.mouse.up();

    // PREMISES: the tab really is the held row, and the row below really moved.
    expect(shifted.heldIsTab).toBe(true);
    expect(shifted.steppedBy).toBeGreaterThan(0);

    // THE CLAIM. Its own footprint -- never the band header's 32px as well.
    expect(shifted.steppedBy).toBeCloseTo(
      before.heldHeight + before.itemGap,
      1
    );

    expect(await itemOrder(page)).toEqual(START);
  });
});

// KAN-164. Dragging a tab changes its GROUP MEMBERSHIP, and the rule is
// invisible: "the band decides" (dropRules.bandAt) -- a tab released while the
// pointer is inside a group's band joins that group, anywhere else it lands
// ungrouped. Measured before the fix, the band was byte-identical during the
// drag: same outline, same background, same height. You found out by letting go.
//
// The band under the pointer is therefore marked while the drag is live, and
// the mark has to track the pointer, including back to nothing.
test.describe('a tab drag says which group it will join', () => {
  test('marks the band under the pointer, and only that one', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);

    const start = await page.evaluate(() => {
      const w1 = document.querySelector<HTMLElement>(
        '[data-drag-row-id="w1"]'
      )!;
      let pane = w1.parentElement;
      while (
        pane &&
        !['auto', 'scroll'].includes(getComputedStyle(pane).overflowY)
      )
        pane = pane.parentElement;
      const held = document.querySelector<HTMLElement>(
        '[data-drag-row-id="a0"]'
      )!;
      const hb = held.getBoundingClientRect();
      const pb = pane!.getBoundingClientRect();
      pane!.scrollTop += hb.top + hb.height / 2 - (pb.top + pb.height / 2);
      const h = document
        .querySelector<HTMLElement>('[data-drag-row-id="a0"]')!
        .getBoundingClientRect();
      return { x: h.left + 80, y: h.top + h.height / 2 };
    });

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 10, { steps: 3 });

    // The bands move as rows step aside, so aim at where alpha is NOW.
    const intoBand = async (id: string) => {
      const y = await page.evaluate((bandId) => {
        const r = document
          .querySelector(`[data-band-id="${bandId}"]`)!
          .getBoundingClientRect();
        return r.top + r.height / 2;
      }, id);
      await page.mouse.move(start.x, y, { steps: 6 });
      await page.waitForTimeout(120);
    };

    const marked = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-band-id][data-drop-target]')].map(
          (b) => (b as HTMLElement).dataset.bandId
        )
      );

    await intoBand('alpha');
    // PREMISE: the pointer really is inside alpha, which is what decides the drop.
    expect(
      await page.evaluate(() => {
        const r = document
          .querySelector('[data-band-id="alpha"]')!
          .getBoundingClientRect();
        const held = document
          .querySelector('[data-drag-row-id="a0"]')!
          .getBoundingClientRect();
        const x = held.left + 80;
        const y = held.top + held.height / 2;
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      })
    ).toBe(true);

    // THE CLAIM: alpha is marked, and nothing else is.
    await expect.poll(marked).toEqual(['alpha']);

    // And the mark is actually DRAWN. The attribute alone would pass with no
    // stylesheet behind it, which is precisely the state this ticket found:
    // measured before the fix, the band's outline read `3px none`.
    //
    // The group answers in ITS OWN colour rather than in a ring: the strip
    // widens, the band fills with a wash of its colour, and the held tab takes
    // the stripe. The WIDTH is the one that carries the meaning for anyone who
    // cannot separate the wash from the page -- a shape change, not a hue.
    const drawn = await page.evaluate(() => {
      const strip = (id: string) =>
        document
          .querySelector(`[data-band-id="${id}"] [data-group-color-strip]`)!
          .getBoundingClientRect().width;
      const band = document.querySelector<HTMLElement>(
        '[data-band-id="alpha"]'
      )!;
      const held = document.querySelector<HTMLElement>('[data-drag-held]')!;
      return {
        markedStrip: Math.round(strip('alpha')),
        unmarkedStrip: Math.round(strip('gamma')),
        bandFill: getComputedStyle(band).backgroundColor,
        bandColourVar: band.style.getPropertyValue('--band-color'),
        heldStripe: getComputedStyle(document.documentElement)
          .getPropertyValue('--drop-target-color')
          .trim(),
        heldShadow: getComputedStyle(held).boxShadow,
        // The strip grows into its own margin, so the rows beside it must not
        // move. The group's content edge is the thing that would give.
        contentLeft: Math.round(
          document
            .querySelector('[data-band-id="alpha"] [data-group-drag-handle]')!
            .getBoundingClientRect().left
        ),
      };
    });

    // The non-colour signal: wider than an unmarked group's strip.
    expect(drawn.markedStrip).toBeGreaterThan(drawn.unmarkedStrip);
    // And it answers in the group's own colour, not a generic accent.
    expect(drawn.bandColourVar).not.toBe('');
    expect(drawn.bandFill).not.toBe('rgba(0, 0, 0, 0)');
    // The held tab wears the colour of the group it would join.
    expect(drawn.heldStripe).toBe(drawn.bandColourVar);
    expect(drawn.heldShadow).toContain('inset');

    // The footprint rule from GroupColorPicker: the strip grows into its own
    // margin, so widening it must not push the group's rows sideways.
    const restingLeft = await page.evaluate(() =>
      Math.round(
        document
          .querySelector('[data-band-id="gamma"] [data-group-drag-handle]')!
          .getBoundingClientRect().left
      )
    );
    expect(drawn.contentLeft).toBe(restingLeft);

    // And it follows the pointer to another group.
    await intoBand('beta');
    await expect.poll(marked).toEqual(['beta']);

    // Back to no group at all: released here the tab would land ungrouped, and
    // the marks must say so rather than leaving the last one lit.
    //
    // Aimed at the WINDOW'S OWN title row, which is a row in the window list
    // and so does not move while a tab is dragged. A point picked from any row
    // inside the window would: the bands travel as rows step aside, which can
    // carry one back under a pointer that was clear of it a moment earlier.
    const aboveBands = await page.evaluate(() => {
      const r = document
        .querySelector('[data-drag-row-id="w1"] [data-window-drag-handle]')!
        .getBoundingClientRect();
      return r.top + r.height / 2;
    });
    await page.mouse.move(start.x, aboveBands, { steps: 6 });

    // PREMISE: the pointer really is clear of every band, which is the whole
    // condition under test. Without it a band that drifted back under the
    // pointer would read as a failure to clear.
    await expect
      .poll(() =>
        page.evaluate((y) => {
          const bands = [...document.querySelectorAll('[data-band-id]')];
          return bands.some((b) => {
            const r = b.getBoundingClientRect();
            return y >= r.top && y <= r.bottom;
          });
        }, aboveBands)
      )
      .toBe(false);

    await expect.poll(marked).toEqual([]);

    // End the drag while a band IS marked, so the cleanup is what clears it --
    // releasing over empty space would pass whether or not finish clears.
    await intoBand('beta');
    await expect.poll(marked).toEqual(['beta']);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // Nothing survives the drag, cancelled or not.
    await expect.poll(marked).toEqual([]);
    expect(await itemOrder(page)).toEqual(START);
  });
});
