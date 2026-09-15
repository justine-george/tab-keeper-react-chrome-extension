// KAN-187. Two adjacent bands SHARE one wide gap; a loose row between them
// makes each keep its own margin instead.
//
// KAN-179 gives a band that follows another band an 8px top margin, and
// adjacent margins collapse, so the pair sits 8px apart. Put a loose tab
// between them and neither is "after a group" any more: each keeps its own
// 2px. So such a tab needs 2 + 32 + 2 = 36px where 8px already existed -- 28,
// which is 4px LESS than its 32px footprint -- and frees the same 28 when it
// leaves. The preview moved everything by the footprint, so every row from
// the lower band down was 4px out, in both directions.
//
// Measured on main at 790x550, 2026-09-14. Two halves as elsewhere: the
// arrangement the drop produces is SEEDED and measured, then the real drag is
// asserted to predict exactly those numbers -- a preview that is merely
// self-consistent cannot pass.

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

// Every group any fixture here uses, registered in every window: a group id
// absent from chromeTabGroups renders no band at all, and the numbers below
// would then be measured on loose tabs.
const GROUPS = [
  { groupId: 'beta', title: 'Beta', color: 'blue' },
  { groupId: 'gamma', title: 'Gamma', color: 'green' },
];

async function open(
  context: BrowserContext,
  extensionId: string,
  tabs: Tab[]
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Band gap',
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
        chromeTabGroups: GROUPS,
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
  await expect(
    page.locator('[data-window-tabs] [data-drag-row-id]').first()
  ).toBeAttached();
  // PREMISE: the pane does not scroll. A session that overflows it auto-scrolls
  // under the held pointer, moving rows that were measured once at drag start.
  expect(
    await page.evaluate(() => {
      let el = document.querySelector<HTMLElement>(
        '[data-drag-row-id="w1"]'
      )!.parentElement;
      while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
        el = el.parentElement;
      return el!.scrollHeight <= el!.clientHeight;
    })
  ).toBe(true);
  return page;
}

// Every tab row's top and every band's title row, relative to the tab list.
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
      if (id.includes(':')) continue;
      out[id] = Math.round(el.getBoundingClientRect().top - base);
    }
    for (const band of document.querySelectorAll<HTMLElement>(
      '[data-band-id]'
    )) {
      const head = band.querySelector('[data-group-drag-handle]');
      if (head)
        out[`head:${band.dataset.bandId}`] = Math.round(
          head.getBoundingClientRect().top - base
        );
    }
    return out;
  });

// The same shape, previewed: each element's pre-drag top plus the transform
// the drag has COMMANDED (rows ease over 0.18s, so a rect read mid-flight
// describes a row still on its way), and for the held row the landing slot --
// where the preview PROMISES it will settle. `lit` is the premise that the
// landing is loose, or a join where one is intended.
async function previewOf(page: Page, rowId: string, toY: number) {
  const pre = await tops(page);
  const b = (await page
    .locator(`[data-drag-row-id="${rowId}"]`)
    .boundingBox())!;
  const dir = toY > b.y ? 1 : -1;
  await page.mouse.move(b.x + 60, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + b.height / 2 + dir * 8);
  await page.mouse.move(b.x + 60, toY, { steps: 8 });
  await page.waitForTimeout(400);
  const out = await page.evaluate(
    ([held, pre]: [string, Record<string, number>]) => {
      const shiftOf = (el: Element | null) =>
        el
          ? Number(
              /translateY\((-?[\d.]+)px\)/.exec(
                (el as HTMLElement).style.transform
              )?.[1] ?? 0
            )
          : NaN;
      const o: Record<string, number> = {};
      for (const [key, top] of Object.entries(pre)) {
        const el = key.startsWith('head:')
          ? document.querySelector(
              `[data-band-id="${key.slice(5)}"] [data-group-drag-handle]`
            )
          : document.querySelector(`[data-drag-row-id="${key}"]`);
        o[key] = top + shiftOf(el);
      }
      const base = document
        .querySelector('[data-window-tabs]')!
        .getBoundingClientRect().top;
      o[held] = Math.round(
        document
          .querySelector('[data-drag-landing-slot]')!
          .getBoundingClientRect().top - base
      );
      return o;
    },
    [rowId, pre] as [string, Record<string, number>]
  );
  const lit = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-band-id][data-drop-target]'
      ),
    ].map((b) => b.dataset.bandId)
  );
  // Escape rather than release: this asserts on the preview, and a commit
  // would rewrite the very layout being measured.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  return { preview: out, lit };
}

// a0 [Beta: b0 b1] [Gamma: g0 g1] a3 -- the two bands are adjacent.
const ADJACENT = [
  tab('a0'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('g0', 'gamma'),
  tab('g1', 'gamma'),
  tab('a3'),
];
// a0 [Beta: b0 b1] a1 [Gamma: g0 g1] a3 -- a1 holds the two bands apart.
const SEPARATED = [
  tab('a0'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('a1'),
  tab('g0', 'gamma'),
  tab('g1', 'gamma'),
  tab('a3'),
];

const intoTheGap = async (page: Page) =>
  (await page.locator('[data-band-id="gamma"]').boundingBox())!.y - 3;
const belowRow = async (page: Page, id: string) => {
  const b = (await page.locator(`[data-drag-row-id="${id}"]`).boundingBox())!;
  return b.y + b.height - 2;
};

// Drives one case end to end: seed what the drop produces, measure it, then
// assert the drag predicts exactly that.
async function predicts(
  context: BrowserContext,
  extensionId: string,
  opts: {
    before: Tab[];
    after: Tab[];
    held: string;
    aim: (page: Page) => Promise<number>;
    lit?: string[];
  }
) {
  const truth = await tops(await open(context, extensionId, opts.after));
  const page = await open(context, extensionId, opts.before);
  const { preview, lit } = await previewOf(
    page,
    opts.held,
    await opts.aim(page)
  );
  expect(lit).toEqual(opts.lit ?? []);
  expect(preview).toEqual(truth);
}

test.describe('a row arriving between two adjacent bands', () => {
  test('a member leaving the lower band into the gap above it', async ({
    context,
    extensionId,
  }) => {
    await predicts(context, extensionId, {
      before: ADJACENT,
      after: [
        tab('a0'),
        tab('b0', 'beta'),
        tab('b1', 'beta'),
        tab('g0'),
        tab('g1', 'gamma'),
        tab('a3'),
      ],
      held: 'g0',
      aim: intoTheGap,
    });
  });

  test('a loose tab from below', async ({ context, extensionId }) => {
    await predicts(context, extensionId, {
      before: ADJACENT,
      after: [
        tab('a0'),
        tab('b0', 'beta'),
        tab('b1', 'beta'),
        tab('a3'),
        tab('g0', 'gamma'),
        tab('g1', 'gamma'),
      ],
      held: 'a3',
      aim: intoTheGap,
    });
  });

  test('a loose tab from above', async ({ context, extensionId }) => {
    await predicts(context, extensionId, {
      before: ADJACENT,
      after: [
        tab('b0', 'beta'),
        tab('b1', 'beta'),
        tab('a0'),
        tab('g0', 'gamma'),
        tab('g1', 'gamma'),
        tab('a3'),
      ],
      held: 'a0',
      aim: intoTheGap,
    });
  });
});

test.describe('the row between two bands leaving, wherever it goes', () => {
  test('upward, above both bands', async ({ context, extensionId }) => {
    await predicts(context, extensionId, {
      before: SEPARATED,
      after: [
        tab('a0'),
        tab('a1'),
        tab('b0', 'beta'),
        tab('b1', 'beta'),
        tab('g0', 'gamma'),
        tab('g1', 'gamma'),
        tab('a3'),
      ],
      held: 'a1',
      aim: (page) => belowRow(page, 'a0'),
    });
  });

  // The landing sits BELOW the band whose gap changed, so the slot has to move
  // with the rows that closed up -- measured 4px out before this.
  test('downward, to the end of the list', async ({ context, extensionId }) => {
    await predicts(context, extensionId, {
      before: SEPARATED,
      after: [
        tab('a0'),
        tab('b0', 'beta'),
        tab('b1', 'beta'),
        tab('g0', 'gamma'),
        tab('g1', 'gamma'),
        tab('a3'),
        tab('a1'),
      ],
      held: 'a1',
      aim: (page) => belowRow(page, 'a3'),
    });
  });

  // INSIDE the lower band: the gap still closes behind it, and here the row
  // DOES travel with the band -- the one case where landing "at" the band
  // means below its title row rather than in the gap above it.
  test('into the lower band, at its head', async ({ context, extensionId }) => {
    await predicts(context, extensionId, {
      before: SEPARATED,
      after: [
        tab('a0'),
        tab('b0', 'beta'),
        tab('b1', 'beta'),
        tab('a1', 'gamma'),
        tab('g0', 'gamma'),
        tab('g1', 'gamma'),
        tab('a3'),
      ],
      held: 'a1',
      lit: ['gamma'],
      aim: async (page) => {
        const t = (await page
          .locator('[data-band-id="gamma"] [data-group-drag-handle]')
          .boundingBox())!;
        return t.y + t.height / 2;
      },
    });
  });
});

// Without this, a rule that shifted by 4 wherever a band was involved would
// pass everything above. Only a band ABOVE another band shares the wide gap.
test('CONTROL: a band whose neighbour above is a loose tab is unaffected', async ({
  context,
  extensionId,
}) => {
  await predicts(context, extensionId, {
    before: [
      tab('a0'),
      tab('a1'),
      tab('g0', 'gamma'),
      tab('g1', 'gamma'),
      tab('a3'),
    ],
    after: [
      tab('a0'),
      tab('a1'),
      tab('a3'),
      tab('g0', 'gamma'),
      tab('g1', 'gamma'),
    ],
    held: 'a3',
    aim: intoTheGap,
  });
});
