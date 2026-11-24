import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import type { BrowserContext } from '@playwright/test';
import { seed, session, tab, win } from './fixtures/betweenSessions';
import { seedSettings } from './fixtures/seed';
import { boxOf, pickUp } from './fixtures/sessionDrag';
import { carryTo } from './fixtures/liveWindows';

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
