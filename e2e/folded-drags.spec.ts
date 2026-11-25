import type { BrowserContext, Page } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  aimAt,
  CARD,
  carryTargets,
  chromeNow,
  onto,
  S1,
  S2,
  S3,
  seed,
  session,
  sessionOf,
  sessionRow,
  settled,
  tab,
  win,
} from './fixtures/betweenSessions';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  strip,
  topOf,
} from './fixtures/liveWindows';
import { boxOf, pickUp, stored, tabHandle } from './fixtures/sessionDrag';
import { seedSettings } from './fixtures/seed';
import { SPRING_OPEN_MS } from '../src/components/common/springOpen';

// KAN-999 on the real artifact: drags while one side is folded (one at a
// time). The saved session folded keeps a card that takes no drop; Currently
// open folded by hand is a rail a saved item springs open. Every live tab is
// a data: page in an unfocused window; Chrome is read before and after.

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 1000, height: 700 };

// The tab view as it loads, no row clicked: a click would peek.
async function open(
  context: BrowserContext,
  extensionId: string,
  viewport: { width: number; height: number },
  settings: Record<string, unknown>,
  sessions = [S1(), S2(), S3()]
): Promise<Page> {
  await seed(context, sessions, 'S1');
  await seedSettings(context, settings);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await expect(sessionRow(page, 'S1')).toBeVisible();
  return page;
}

const card = (page: Page) => page.locator('[data-saved-session-card]');
const rail = (page: Page) => page.locator('[data-open-now-rail]');
const railButton = (page: Page) => rail(page).locator('> button');
const drawer = (page: Page) => page.getByRole('dialog');
const centre = async (page: Page, selector: string) => {
  const b = await boxOf(page.locator(selector));
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const urlsOf = async (page: Page, id: string) =>
  sessionOf(await stored(page), id).windows.map((w) =>
    w.tabs.map((t) => t.url)
  );

test.describe('the saved session folded', () => {
  test('wide: a live tab let go on a session row copies there; the card stays and nothing unfolds', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await open(context, extensionId, WIDE, {
      foldSavedSessionInTabView: true,
    });
    const live = await openLiveWindow(serviceWorker, ['Live A', 'Live B']);
    await expect(liveRow(page, live.idOf('Live B'))).toBeVisible();
    const chromeBefore = await chromeNow(serviceWorker);

    await pickUp(page, liveRow(page, live.idOf('Live B')));
    const pane = await boxOf(page.locator('[data-pane="open-now"]'));
    await page.mouse.move(pane.x - 80, pane.y + 200, { steps: 6 });
    await expect(page.locator(CARD)).toHaveCount(1);
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(async () => (await urlsOf(page, 'S2'))[0])
      .toEqual([dataUrl('Live B')]);
    await expect(card(page)).toBeVisible();
    await expect(page.locator('[data-pane="detail"]')).toHaveCount(0);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
  });

  test('wide: a live tab let go on the card saves nothing and moves nothing; the card shows the spring target (KAN-1006)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await open(context, extensionId, WIDE, {
      foldSavedSessionInTabView: true,
    });
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    const before = await stored(page);
    const chromeBefore = await chromeNow(serviceWorker);

    await pickUp(page, liveRow(page, live.idOf('Live A')));
    await carryTo(page, await centre(page, '[data-saved-session-card]'));
    // PREMISE: carried out of Currently open, over the card.
    await expect(page.locator(CARD)).toHaveCount(1);
    // No session row is a target; the card is (it has no row id, so '?').
    expect(await carryTargets(page)).toEqual(['?']);
    // KAN-1006. Resting here peeks the saved session, so the card wears the carry target's look; let go before that.
    await expect(card(page)).toHaveAttribute('data-carry-target', '');
    await page.mouse.up();

    await expect(page.locator(CARD)).toHaveCount(0);
    expect(await stored(page)).toEqual(before);
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
    await expect(card(page)).toBeVisible();
  });

  // The worst path: the pane the drag started in becomes the rail mid-carry.
  test('narrow: a live tab resting on a row peeks it, Currently open turns rail mid-carry, and the copy lands at an exact spot', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await open(context, extensionId, NARROW, {
      foldSavedSessionInTabView: true,
    });
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    await expect(liveRow(page, live.idOf('Live A'))).toBeVisible();
    // PREMISE: narrow and folded, Currently open is a pane, not the rail.
    await expect(rail(page)).toHaveCount(0);
    const chromeBefore = await chromeNow(serviceWorker);

    await pickUp(page, liveRow(page, live.idOf('Live A')));
    const pane = await boxOf(page.locator('[data-pane="open-now"]'));
    await page.mouse.move(pane.x - 80, pane.y + 200, { steps: 6 });
    await onto(page, 'S1');
    await page.waitForTimeout(SPRING_OPEN_MS + 200);
    await expect(page.locator('[data-drag-row-id="w1"]')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expect(rail(page)).toBeVisible();
    // Still carried, through the swap.
    await expect(page.locator(CARD)).toHaveCount(1);
    await settled(page);
    await aimAt(page, 'a1', 0.25);
    await page.mouse.up();

    await expect
      .poll(async () => (await urlsOf(page, 'S1'))[0]?.[1])
      .toBe(dataUrl('Live A'));
    expect(await chromeNow(serviceWorker)).toBe(chromeBefore);
    const fold = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('settingsData') ?? '{}')
          .foldSavedSessionInTabView
    );
    expect(fold).toBe(true);
  });
});

test.describe('Currently open folded by hand, wide', () => {
  const SAVED = () =>
    session('S1', 'Trip', [win('w1', [tab('s0'), tab('s1'), tab('s2')])]);

  async function openRail(context: BrowserContext, extensionId: string) {
    const page = await open(
      context,
      extensionId,
      WIDE,
      { foldSavedSessionInTabView: false, foldOpenNowInTabView: true },
      [SAVED(), S2()]
    );
    await expect(rail(page)).toBeVisible();
    await expect(tabHandle(page, 's2')).toBeVisible();
    return page;
  }

  test('a saved tab resting on the rail springs the drawer; a drop in a window opens it there', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await openLiveWindow(worker, ['A', 'B']);
    const page = await openRail(context, extensionId);

    await pickUp(page, tabHandle(page, 's2'));
    await carryTo(page, await centre(page, '[data-open-now-rail]'));
    await expect(rail(page)).toHaveAttribute('data-carry-target', '');
    await expect(drawer(page)).toBeVisible();
    await expect(page.locator('[data-drawer-settling]')).toHaveCount(0);
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();

    await expect
      .poll(async () => (await strip(worker, live.windowId)).map((t) => t.url))
      .toEqual([dataUrl('A'), 'https://s2.test/', dataUrl('B')]);
  });

  // The rail takes saved items only: a session row's drag over it lights nothing.
  test('a session row dragged over the rail: no hover fill, no darker outline, nothing opens', async ({
    context,
    extensionId,
  }) => {
    const page = await openRail(context, extensionId);
    const border = await rail(page).evaluate(
      (el) => getComputedStyle(el).borderTopColor
    );

    await pickUp(page, sessionRow(page, 'S2'));
    const on = await centre(page, '[data-open-now-rail]');
    await page.mouse.move(on.x, on.y, { steps: 20 });
    // PREMISE: the row is held, the pointer on the rail.
    await expect(page.locator('[data-drag-held]')).toHaveCount(1);
    await page.waitForTimeout(SPRING_OPEN_MS + 200);
    expect(
      await railButton(page).evaluate(
        (el) => getComputedStyle(el).backgroundColor
      )
    ).toBe('rgba(0, 0, 0, 0)');
    expect(
      await rail(page).evaluate((el) => getComputedStyle(el).borderTopColor)
    ).toBe(border);
    await expect(drawer(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(
      page.locator('[data-pane="sessions"] [data-drag-row-id]').first()
    ).toHaveAttribute('data-drag-row-id', 'S1');
  });
});
