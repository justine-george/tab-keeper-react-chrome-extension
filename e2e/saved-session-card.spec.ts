import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import type { BrowserContext } from '@playwright/test';
import { seed, session, tab, win } from './fixtures/betweenSessions';
import { seedSettings } from './fixtures/seed';
import { boxOf, pickUp } from './fixtures/sessionDrag';
import { carryTo } from './fixtures/liveWindows';
import { samples, startSampling } from './fixtures/glideSamples';
import { pixelsAt, rgb } from './fixtures/pixels';
import {
  CHALK_THEME,
  CHARCOAL_THEME,
} from '../src/utils/constants/themePalettes';

// KAN-999 on the real artifact. Folded, the saved session keeps an outlined
// card between the list and Currently open: 44px wide, from the top of
// Currently open's header to the bottom of the list, 8px from both.

const WIDE = { width: 1400, height: 800 };
const SHORT = { width: 1000, height: 580 };
const SESSIONS = () => [
  session('S1', 'Trip', [win('w1', [tab('a0'), tab('a1')])]),
  session('S2', 'Work', [win('w2', [tab('b0')])]),
];

// The tab view, folded, with no row clicked: a click would peek, and a peek unfolds.
async function openTabView(
  context: BrowserContext,
  extensionId: string,
  folded: boolean,
  sessions: ReturnType<typeof session>[],
  viewport: { width: number; height: number },
  settings: Record<string, unknown> = {}
): Promise<Page> {
  await seed(context, sessions, 'S1');
  await seedSettings(context, {
    foldSavedSessionInTabView: folded,
    ...settings,
  });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await expect(page.locator('[data-drag-row-id="S1"]')).toBeVisible();
  return page;
}

const card = (page: Page) => page.locator('[data-saved-session-card]');
const header = (page: Page) =>
  page.locator('[data-pane="open-now"] [data-open-now-header]');
const listCard = (page: Page) =>
  page.locator('[data-pane="sessions"] [data-tour-anchor="sessions"]');

const edges = async (l: Locator) => {
  const b = await boxOf(l);
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
};

for (const [name, viewport] of [
  ['wide', WIDE],
  ['short and narrow', SHORT],
] as const) {
  test(`${name}: the card is 44px, from Currently open's header top to the list's bottom, 8px from both`, async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(
      context,
      extensionId,
      true,
      SESSIONS(),
      viewport
    );
    await expect(card(page)).toBeVisible();

    const c = await edges(card(page));
    const h = await edges(header(page));
    const l = await edges(listCard(page));
    expect(c.right - c.left).toBeCloseTo(44, 0);
    expect(Math.abs(c.top - h.top)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(c.bottom - l.bottom)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(c.left - l.right - 8)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(h.left - c.right - 8)).toBeLessThanOrEqual(0.5);
    // The list card's border and corners.
    const look = (el: Locator) =>
      el.evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.borderTopWidth, s.borderTopColor, s.borderTopLeftRadius];
      });
    expect(await look(card(page))).toEqual(await look(listCard(page)));
  });
}

test('Tab order: the list, its grip, then the card, then Currently open', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId, true, SESSIONS(), WIDE);
  await expect(card(page)).toBeVisible();

  // Reverse from Currently open's search: the card comes right before it,
  // past nothing else in Currently open.
  await page.locator('[data-pane="open-now"] input').first().focus();
  const order: (string | null)[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab');
    const at = await page.evaluate(() => {
      const el = document.activeElement;
      if (el?.closest('[data-saved-session-card]')) return 'card';
      if (el?.closest('[data-list-resize-grip]')) return 'list grip';
      return el?.closest('[data-pane]')?.getAttribute('data-pane') ?? null;
    });
    order.push(at);
    if (at === 'sessions') break;
  }
  const firstCard = order.indexOf('card');
  expect(firstCard).toBeGreaterThanOrEqual(0);
  // The list's resize grip sits on the list's edge, before the card.
  expect(order.slice(firstCard + 1)).toEqual(['list grip', 'sessions']);
});

test('ja, short window: the stacked label stays inside the card', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(
    context,
    extensionId,
    true,
    SESSIONS(),
    {
      width: 1000,
      height: 420,
    },
    { language: 'ja' }
  );
  await expect(card(page)).toBeVisible();

  const c = await edges(card(page));
  const clipped = await card(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return s.overflow;
  });
  expect(clipped).toBe('hidden');
  // CONTROL: the label is the stacked one (a span per character run).
  await expect(card(page)).toContainText('保存済みのセッション');
  expect(c.bottom).toBeLessThanOrEqual(
    (await edges(listCard(page))).bottom + 0.5
  );
});

test('a session row carried over the card: the card is no drop target', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId, true, SESSIONS(), WIDE);
  await expect(card(page)).toBeVisible();

  await pickUp(page, page.locator('[data-drag-row-id="S2"]'));
  const c = await boxOf(card(page));
  await carryTo(page, { x: c.x + c.width / 2, y: c.y + c.height / 2 });
  // PREMISE: the row is held.
  await expect(page.locator('[data-drag-held]')).toHaveCount(1);

  await expect(page.locator('[data-carry-target]')).toHaveCount(0);
  expect(
    await card(page).evaluate((el) => getComputedStyle(el).backgroundColor)
  ).toBe('rgba(0, 0, 0, 0)');
  await page.mouse.up();
  // Nothing moved: the list keeps its order.
  await expect(
    page.locator('[data-pane="sessions"] [data-drag-row-id]')
  ).toHaveCount(2);
  await expect(
    page.locator('[data-pane="sessions"] [data-drag-row-id]').first()
  ).toHaveAttribute('data-drag-row-id', 'S1');
});

// KAN-999 (his round 4). Wherever Currently open folds to its rail, the rail is
// the same outlined card: 44px, the list card's border and corners, 8px in
// from the window's frame, from the panes' top inset to the list's bottom.
const railCard = (page: Page) => page.locator('[data-open-now-rail]');

for (const [name, viewport, settings] of [
  ['narrow', SHORT, {}],
  ['wide, folded by hand', WIDE, { foldOpenNowInTabView: true }],
] as const) {
  test(`${name}: Currently open's rail is the same card`, async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(
      context,
      extensionId,
      false,
      SESSIONS(),
      viewport,
      settings
    );
    await expect(railCard(page)).toBeVisible();

    const r = await edges(railCard(page));
    const pane = await edges(page.locator('[data-pane="open-now"]'));
    const l = await edges(listCard(page));
    expect(r.right - r.left).toBeCloseTo(44, 0);
    expect(pane.right - pane.left).toBeCloseTo(53, 0);
    // 8px inside the window's 1px frame, top and right; the list's bottom.
    expect(Math.abs(r.top - pane.top - 9)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(pane.right - r.right - 9)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.bottom - l.bottom)).toBeLessThanOrEqual(0.5);
    const look = (el: Locator) =>
      el.evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.borderTopWidth, s.borderTopColor, s.borderTopLeftRadius];
      });
    expect(await look(railCard(page))).toEqual(await look(listCard(page)));
  });
}

test('narrow and folded, then shown: the rail card in a 53px column', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId, true, SESSIONS(), SHORT);
  await card(page).click();

  await expect(railCard(page)).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  const pane = await edges(page.locator('[data-pane="open-now"]'));
  expect(pane.right - pane.left).toBeCloseTo(53, 0);
  expect(
    (await edges(railCard(page))).right - (await edges(railCard(page))).left
  ).toBeCloseTo(44, 0);
});

// KAN-999. Nothing snaps after a user action: folded, deleting the last
// session takes the card away and Currently open glides into its column;
// Undo brings the card back the same way.
test('folded, deleting the last session: the card leaves and Currently open glides; Undo brings both back', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(
    context,
    extensionId,
    true,
    [session('S1', 'Trip', [win('w1', [tab('a0')])])],
    WIDE
  );
  await expect(card(page)).toBeVisible();
  const from = (await edges(page.locator('[data-pane="open-now"]'))).left;

  const SAMPLE = {
    'openNow:x': '[data-pane="open-now"]',
    'card:op': '[data-saved-session-card]',
  };
  const row = page.locator('[data-drag-row-id="S1"]');
  const rb = await boxOf(row);
  await page.mouse.click(rb.x + 60, rb.y + 16, { button: 'right' });
  const del = page.getByRole('menuitem', { name: 'Delete session' });
  await expect(del).toBeVisible();
  await startSampling(page, SAMPLE, 700);
  await del.click();
  await page.waitForTimeout(750);
  const out = await samples(page);
  const xs = out['openNow:x'];
  // Lands 52px left, in the column the card had.
  expect(xs[xs.length - 1]).toBeCloseTo(from - 52, 0);
  // A glide: frames in between, not a jump.
  const between = xs.filter((x) => x < from - 2 && x > from - 50);
  expect(between.length).toBeGreaterThanOrEqual(3);
  // The card fades before it goes.
  const ops = out['card:op'].filter((o) => !Number.isNaN(o));
  expect(ops.some((o) => o > 0.05 && o < 0.95)).toBe(true);
  await expect(card(page)).toHaveCount(0);

  await startSampling(page, SAMPLE, 700);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(750);
  const back = await samples(page);
  const bx = back['openNow:x'];
  expect(bx[bx.length - 1]).toBeCloseTo(from, 0);
  expect(
    bx.filter((x) => x < from - 2 && x > from - 50).length
  ).toBeGreaterThanOrEqual(3);
  await expect(card(page)).toBeVisible();
});

// KAN-999. A load is no user action: the card is there from its first frame,
// at full width and opacity, not moving in.
test('folded, on load: the card is drawn whole from its first frame', async ({
  context,
  extensionId,
}) => {
  await context.addInitScript(() => {
    const frames: [number, number][] = [];
    Object.defineProperty(window, '__cardFrames', { value: frames });
    const sample = () => {
      const card = document.querySelector('[data-saved-session-card]');
      if (card !== null) {
        frames.push([
          card.getBoundingClientRect().width,
          Number(getComputedStyle(card).opacity),
        ]);
      }
      if (frames.length < 20) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const page = await openTabView(context, extensionId, true, SESSIONS(), WIDE);
  await expect
    .poll(() =>
      page.evaluate(
        () => (Reflect.get(window, '__cardFrames') as unknown[]).length
      )
    )
    .toBe(20);
  const frames = (await page.evaluate(() =>
    Reflect.get(window, '__cardFrames')
  )) as [number, number][];
  for (const [width, opacity] of frames) {
    expect(width).toBeCloseTo(44, 0);
    expect(opacity).toBe(1);
  }
});

// KAN-999. Another page's write is no action on this one: deleting the last
// session there takes the card away here at once, with no glide.
test('folded, another page deletes the last session: the card goes at once', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(
    context,
    extensionId,
    true,
    [session('S1', 'Trip', [win('w1', [tab('a0')])])],
    WIDE
  );
  await expect(card(page)).toBeVisible();
  const from = (await edges(page.locator('[data-pane="open-now"]'))).left;
  await startSampling(page, { 'openNow:x': '[data-pane="open-now"]' }, 700);
  // As another page writes: storage, then the shared channel (KAN-925).
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('tabContainerData') ?? '');
    stored.tabGroups = [];
    localStorage.setItem('tabContainerData', JSON.stringify(stored));
    new BroadcastChannel('tab-keeper-stored').postMessage('tabContainerData');
  });
  await page.waitForTimeout(750);
  const xs = (await samples(page))['openNow:x'];
  // PREMISE: it moved into the card's column.
  expect(xs[xs.length - 1]).toBeCloseTo(from - 52, 0);
  expect(xs.filter((x) => x < from - 2 && x > from - 50)).toEqual([]);
  await expect(card(page)).toHaveCount(0);
});

// KAN-999 (his picks H2, W1). Both rail cards are one button, card-wide: a
// hover anywhere takes a session row's hover fill and darkens the outline, a
// press its pressed fill; the tooltip sits under the label, not at the
// window's bottom, and names what the card holds.
const THEMES = [
  ['Chalk', CHALK_THEME],
  ['Charcoal', CHARCOAL_THEME],
] as const;
const CARDS = [
  {
    name: 'the Saved session card',
    folded: true,
    viewport: WIDE,
    outline: (page: Page) => card(page),
    tip: 'Trip, 2 Tabs',
  },
  {
    name: "Currently open's rail",
    folded: false,
    viewport: SHORT,
    outline: (page: Page) => railCard(page),
    tip: /^Currently open, \d+ Tabs?$/,
  },
] as const;

for (const [theme, COLORS] of THEMES) {
  for (const c of CARDS) {
    test(`${theme}, ${c.name}: a hover low on the card fills it whole as a row's hover, darkens its outline; a press there acts`, async ({
      context,
      extensionId,
    }) => {
      const page = await openTabView(
        context,
        extensionId,
        c.folded,
        SESSIONS(),
        c.viewport,
        { theme }
      );
      const outline = c.outline(page);
      await expect(outline).toBeVisible();
      const b = await boxOf(outline);
      const x = b.x + b.width / 2;
      const spots: Array<[number, number]> = [
        [x, b.y + 6],
        [x, b.y + b.height / 2],
        [x, b.y + b.height - 6],
      ];
      const borderOf = () =>
        outline.evaluate((e) => getComputedStyle(e).borderTopColor);
      await page.mouse.move(5, b.y + b.height / 2);
      const rest = await pixelsAt(page, spots);
      // CONTROL: at rest the card isn't already the hover fill.
      expect(rest[1]).not.toBe(COLORS.HOVER_COLOR);
      expect(await borderOf()).toBe(rgb(COLORS.PANEL_BORDER_COLOR));

      await page.mouse.move(x, b.y + b.height - 20);
      await expect
        .poll(() => pixelsAt(page, spots))
        .toEqual([COLORS.HOVER_COLOR, COLORS.HOVER_COLOR, COLORS.HOVER_COLOR]);
      expect(await borderOf()).toBe(rgb(COLORS.LABEL_L2_COLOR));

      await page.mouse.down();
      await expect
        .poll(() => pixelsAt(page, spots))
        .toEqual([
          COLORS.ACTIVE_COLOR,
          COLORS.ACTIVE_COLOR,
          COLORS.ACTIVE_COLOR,
        ]);
      await page.mouse.up();
      // The press low on the card does the card's job.
      if (c.folded) await expect(card(page)).toHaveCount(0);
      else await expect(page.getByRole('dialog')).toBeVisible();
    });
  }
}

for (const c of CARDS) {
  test(`${c.name}: the tooltip sits under the label wherever the pointer is on the card, and names what it holds`, async ({
    context,
    extensionId,
  }) => {
    const page = await openTabView(
      context,
      extensionId,
      c.folded,
      SESSIONS(),
      c.viewport
    );
    const outline = c.outline(page);
    await expect(outline).toBeVisible();
    const b = await boxOf(outline);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 20);
    const chip = page.locator('[data-tooltip-chip]');
    await expect(chip).toHaveText(c.tip);
    const label = await boxOf(outline.locator('[data-tooltip-near]'));
    const tip = await boxOf(chip);
    expect(Math.abs(tip.y - (label.y + label.height) - 6)).toBeLessThanOrEqual(
      1
    );
  });
}

test('the Saved session card keeps its action as its name', async ({
  context,
  extensionId,
}) => {
  const page = await openTabView(context, extensionId, true, SESSIONS(), WIDE);
  await expect(
    page.getByRole('button', { name: 'Show the saved session' })
  ).toBeVisible();
});
