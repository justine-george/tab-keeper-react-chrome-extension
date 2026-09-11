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
