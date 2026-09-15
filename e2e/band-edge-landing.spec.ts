// KAN-167. A tab landing LOOSE beside a band's edge gets its landing slot
// exactly where the tab will rest.
//
// The slot is a distance between measured TOPS in the drawn list, and where
// the slot is a band's edge that edge includes the band's own margin -- which
// a loose tab does not pay. Before this the slot was 2px inside the band at
// either edge, and 6px at a title row that follows another band, where the
// wider KAN-179 gap is what the edge includes. The rows stepping aside were
// already exact (PR #255); this closes the slot.
//
// Same two halves as tab-group-join-preview.spec.ts: the arrangement the drop
// produces is seeded and measured, then the real drag is asserted against it.
// The leaving-upward case itself is asserted there; here are the other five
// edges, measured 2026-09-14 at 790x550, tops relative to the tab list.

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
  { groupId: 'alpha', title: 'Alpha', color: 'red' },
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
    title: 'Band edge landing',
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
  expect(
    await page.evaluate(() =>
      chrome.permissions.contains({ permissions: ['tabGroups'] })
    )
  ).toBe(true);
  return page;
}

// The top of every tab row, relative to the tab-list container.
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
    return out;
  });

// Where the landing slot is drawn while `rowId` is held at `toY`, plus which
// bands are lit -- the premise that the landing is LOOSE. Escape rather than
// release, so the layout being measured is not rewritten.
async function slotWhileDragging(page: Page, rowId: string, toY: number) {
  const from = (await page
    .locator(`[data-drag-row-id="${rowId}"]`)
    .boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 8);
  await page.mouse.move(from.x + 40, toY, { steps: 6 });
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const base = document
      .querySelector('[data-window-tabs]')!
      .getBoundingClientRect().top;
    return {
      slot: Math.round(
        document
          .querySelector('[data-drag-landing-slot]')!
          .getBoundingClientRect().top - base
      ),
      lit: [
        ...document.querySelectorAll<HTMLElement>(
          '[data-band-id][data-drop-target]'
        ),
      ].map((b) => b.dataset.bandId),
    };
  });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  return out;
}

const bandBox = async (page: Page, group: string) =>
  (await page.locator(`[data-band-id="${group}"]`).boundingBox())!;

// a0 a1 a2 [Alpha: x0 x1 x2] a3. Alpha's band spans 98..226.
const AROUND = [
  tab('a0'),
  tab('a1'),
  tab('a2'),
  tab('x0', 'alpha'),
  tab('x1', 'alpha'),
  tab('x2', 'alpha'),
  tab('a3'),
];
// a0 [Beta: b0 b1] [Gamma: g0 g1] a3. Gamma's band starts 138, 8px under Beta.
const SANDWICH = [
  tab('a0'),
  tab('b0', 'beta'),
  tab('b1', 'beta'),
  tab('g0', 'gamma'),
  tab('g1', 'gamma'),
  tab('a3'),
];

test('a loose tab from below, landing just above a band, rests flush under the row above it', async ({
  context,
  extensionId,
}) => {
  const truth = await tops(
    await open(context, extensionId, [
      tab('a0'),
      tab('a1'),
      tab('a2'),
      tab('a3'),
      tab('x0', 'alpha'),
      tab('x1', 'alpha'),
      tab('x2', 'alpha'),
    ])
  );
  expect(truth.a3).toBe(96);

  const page = await open(context, extensionId, AROUND);
  const { slot, lit } = await slotWhileDragging(
    page,
    'a3',
    (await bandBox(page, 'alpha')).y - 6
  );
  expect(lit).toEqual([]);
  expect(slot).toBe(truth.a3);
});

test('a loose tab from above, landing just past a band, rests a band margin under it', async ({
  context,
  extensionId,
}) => {
  const truth = await tops(
    await open(context, extensionId, [
      tab('a1'),
      tab('a2'),
      tab('x0', 'alpha'),
      tab('x1', 'alpha'),
      tab('x2', 'alpha'),
      tab('a0'),
      tab('a3'),
    ])
  );
  expect(truth.a0).toBe(196);

  const page = await open(context, extensionId, AROUND);
  const band = await bandBox(page, 'alpha');
  const { slot, lit } = await slotWhileDragging(
    page,
    'a0',
    band.y + band.height + 1
  );
  expect(lit).toEqual([]);
  expect(slot).toBe(truth.a0);
});

test('a member leaving downward past its band rests a band margin under it', async ({
  context,
  extensionId,
}) => {
  const truth = await tops(
    await open(context, extensionId, [
      tab('a0'),
      tab('a1'),
      tab('a2'),
      tab('x0', 'alpha'),
      tab('x1', 'alpha'),
      tab('x2'),
      tab('a3'),
    ])
  );
  expect(truth.x2).toBe(196);

  const page = await open(context, extensionId, AROUND);
  const band = await bandBox(page, 'alpha');
  const { slot, lit } = await slotWhileDragging(
    page,
    'x2',
    band.y + band.height + 1
  );
  expect(lit).toEqual([]);
  expect(slot).toBe(truth.x2);
});

test('a member leaving upward from a band that follows another band: the wide gap less a margin', async ({
  context,
  extensionId,
}) => {
  const truth = await tops(
    await open(context, extensionId, [
      tab('a0'),
      tab('b0', 'beta'),
      tab('b1', 'beta'),
      tab('g0'),
      tab('g1', 'gamma'),
      tab('a3'),
    ])
  );
  expect(truth.g0).toBe(132);

  const page = await open(context, extensionId, SANDWICH);
  const { slot, lit } = await slotWhileDragging(
    page,
    'g0',
    (await bandBox(page, 'gamma')).y - 3
  );
  expect(lit).toEqual([]);
  // This was 138 -- six pixels, not two: the title row sits KAN-179's 8px
  // under the band above, and a loose tab keeps only 2 of it.
  expect(slot).toBe(truth.g0);
});

test('a loose tab from above landing between two bands rests a margin under the upper one', async ({
  context,
  extensionId,
}) => {
  const truth = await tops(
    await open(context, extensionId, [
      tab('b0', 'beta'),
      tab('b1', 'beta'),
      tab('a0'),
      tab('g0', 'gamma'),
      tab('g1', 'gamma'),
      tab('a3'),
    ])
  );
  expect(truth.a0).toBe(100);

  const page = await open(context, extensionId, SANDWICH);
  const { slot, lit } = await slotWhileDragging(
    page,
    'a0',
    (await bandBox(page, 'gamma')).y - 3
  );
  expect(lit).toEqual([]);
  expect(slot).toBe(truth.a0);
});

test('a band leading its window: a loose tab from below rests at the top of the list', async ({
  context,
  extensionId,
}) => {
  const truth = await tops(
    await open(context, extensionId, [
      tab('a1'),
      tab('x0', 'alpha'),
      tab('x1', 'alpha'),
      tab('a2'),
    ])
  );
  expect(truth.a1).toBe(0);

  const page = await open(context, extensionId, [
    tab('x0', 'alpha'),
    tab('x1', 'alpha'),
    tab('a1'),
    tab('a2'),
  ]);
  // Over the window's header, above the band: index 0, outside every band.
  const { slot, lit } = await slotWhileDragging(
    page,
    'a1',
    (await bandBox(page, 'alpha')).y - 6
  );
  expect(lit).toEqual([]);
  expect(slot).toBe(truth.a1);
});

// Without this a slot drawn a constant 2px higher everywhere would pass the
// tests above that need -2 and fail only the ones that need +2 -- and a join
// is where such a constant would show first.
test('CONTROL: joining at the head from above is exact, and stays exact', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, AROUND);
  const title = (await page
    .locator('[data-band-id="alpha"] [data-group-drag-handle]')
    .boundingBox())!;
  const { slot, lit } = await slotWhileDragging(
    page,
    'a2',
    title.y + title.height / 2
  );
  expect(lit).toEqual(['alpha']);
  // TRUTH.fromAbove.a2 in tab-group-join-preview.spec.ts.
  expect(slot).toBe(98);
});
