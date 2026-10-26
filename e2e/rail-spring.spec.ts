import type { BrowserContext, Page } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  layout,
  openTabView,
  session,
  tab,
  win,
} from './fixtures/betweenSessions';
import { holdTimers } from './fixtures/dwell';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  strip,
  tabCount,
  topOf,
} from './fixtures/liveWindows';
import { boxOf, pickUp, stored, tabHandle } from './fixtures/sessionDrag';
import { SPRING_OPEN_MS } from '../src/components/common/springOpen';

// KAN-820 on the real artifact: where Currently open is a rail (narrow), a
// saved tab resting SPRING_OPEN_MS on it springs the drawer out, so it can be
// dropped into a live window. Live tabs are data: pages in unfocused windows.

const NARROW = { width: 1024, height: 700 };
const CARD = '[data-carry-card]';
const BADGE = `${CARD} [data-carry-card-badge]`;

// S1 w1: three loose tabs.
const SAVED = () =>
  session('S1', 'Trip', [win('w1', [tab('s0'), tab('s1'), tab('s2')])]);
const START = ['s0 s1 s2'];

async function setUp(context: BrowserContext, extensionId: string) {
  const page = await openTabView(
    context,
    extensionId,
    false,
    [SAVED()],
    NARROW
  );
  await expect(tabHandle(page, 's2')).toBeVisible();
  return page;
}

const railButton = (page: Page) =>
  page.locator('button[aria-expanded][aria-label^="Currently open"]');
// The rail's whole column: the button's parent, on main as on this branch.
const rail = (page: Page) => railButton(page).locator('..');
const drawer = (page: Page) => page.getByRole('dialog');

async function onRail(page: Page) {
  const b = await boxOf(rail(page));
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Rests on the rail until the drawer has sprung and its slide in has ended.
async function spring(page: Page) {
  await carryTo(page, await onRail(page));
  await expect(drawer(page)).toBeVisible();
  await expect(page.locator('[data-drawer-settling]')).toHaveCount(0);
}

// Back on the saved side, left of the drawer, on s0's row.
const savedSide = (page: Page) => topOf(tabHandle(page, 's0'));

// Sprung and still open: not sliding out.
async function expectDrawerStays(page: Page) {
  await expect(railButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).not.toHaveAttribute('data-leaving', '');
}

async function expectDrawerGone(page: Page) {
  await expect(railButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer(page)).toHaveCount(0);
}

test('resting a saved tab on the rail springs the drawer, and its rail outlines first', async ({
  context,
  extensionId,
}) => {
  const page = await setUp(context, extensionId);
  await pickUp(page, tabHandle(page, 's2'));
  await holdTimers(page);
  await carryTo(page, await onRail(page));

  await expect(rail(page)).toHaveAttribute('data-carry-target', '');
  expect(
    await rail(page).evaluate((el) => getComputedStyle(el).outlineWidth)
  ).toBe('2px');
  // PREMISE: before the dwell's end, nothing has sprung.
  await expect(drawer(page)).toHaveCount(0);

  await page.clock.runFor(SPRING_OPEN_MS);
  await page.clock.resume();
  await expect(drawer(page)).toBeVisible();
  await expect(page.locator('[data-drawer-settling]')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('let go on the rail before it opens: cancelled, no +, nothing opened', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  const before = await stored(page);
  const tabsBefore = await tabCount(worker);

  await pickUp(page, tabHandle(page, 's2'));
  await holdTimers(page);
  await carryTo(page, await onRail(page));
  // PREMISE: resting on the rail, the dwell running.
  await expect(rail(page)).toHaveAttribute('data-carry-target', '');
  await expect(page.locator(CARD)).toBeVisible();
  await expect(page.locator(BADGE)).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-carry-opens',
    ''
  );
  await page.mouse.up();

  await expect(page.locator(CARD)).toHaveCount(0);
  // Past the dwell: a timer the release left running would spring it now.
  await page.clock.runFor(SPRING_OPEN_MS * 2);
  await expect(drawer(page)).toHaveCount(0);
  expect(await tabCount(worker)).toBe(tabsBefore);
  expect(await stored(page)).toEqual(before);
});

test('in, out, in: springs again, and a drop in a window opens there with the drawer staying', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B', 'C']);
  const page = await setUp(context, extensionId);

  await pickUp(page, tabHandle(page, 's2'));
  await spring(page);
  await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
  await expect(page.locator(BADGE)).toBeVisible();
  await carryTo(page, await savedSide(page));
  await expect(drawer(page)).toBeHidden();

  await spring(page);
  await carryTo(page, await topOf(liveRow(page, live.idOf('C'))));
  await expect(page.locator(BADGE)).toBeVisible();
  await page.mouse.up();

  await expect
    .poll(async () => (await strip(worker, live.windowId)).map((t) => t.url))
    .toEqual([dataUrl('A'), dataUrl('B'), 'https://s2.test/', dataUrl('C')]);
  await expectDrawerStays(page);
});

// The spec's worst path.
test('worst path: spring, in, out, release on the saved side', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const before = await stored(page);
  const tabsBefore = await tabCount(worker);

  await pickUp(page, tabHandle(page, 's2'));
  await spring(page);
  await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
  await expect(page.locator(BADGE)).toBeVisible();
  await carryTo(page, await savedSide(page));
  await expect(drawer(page)).toBeHidden();
  await page.mouse.up();

  await expect(page.locator(CARD)).toHaveCount(0);
  await expectDrawerGone(page);
  // A move or an open would have landed by now.
  await page.waitForTimeout(800);
  expect(await stored(page)).toEqual(before);
  expect(await tabCount(worker)).toBe(tabsBefore);
  expect(errors).toEqual([]);
});

test('Esc after the spring closes the drawer, and nothing opens', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['A', 'B']);
  const page = await setUp(context, extensionId);
  const before = await stored(page);
  const tabsBefore = await tabCount(worker);

  await pickUp(page, tabHandle(page, 's2'));
  await spring(page);
  const slot = await topOf(liveRow(page, live.idOf('B')));
  await carryTo(page, slot);
  await expect(page.locator(BADGE)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(page.locator(CARD)).toHaveCount(0);
  await expectDrawerGone(page);
  await page.waitForTimeout(800);
  expect(await tabCount(worker)).toBe(tabsBefore);
  expect(await stored(page)).toEqual(before);
});

test('a refused release in the drawer leaves it open', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['Alpha', 'Beta']);
  const page = await setUp(context, extensionId);
  // A held search refuses every drop (O14c): typed in the drawer, then closed.
  await railButton(page).click();
  await drawer(page).locator('input').fill('Alpha');
  await expect(liveRow(page, live.idOf('Beta'))).toHaveCount(0);
  await drawer(page)
    .getByRole('button', { name: 'Close the Currently open panel' })
    .click();
  await expectDrawerGone(page);
  const tabsBefore = await tabCount(worker);

  await pickUp(page, tabHandle(page, 's2'));
  await spring(page);
  await carryTo(page, await topOf(liveRow(page, live.idOf('Alpha'))));
  // PREMISE: refused there.
  await expect(page.locator(CARD)).toBeVisible();
  await expect(page.locator(BADGE)).toHaveCount(0);
  await page.mouse.up();

  await expect(page.locator(CARD)).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await tabCount(worker)).toBe(tabsBefore);
  await expectDrawerStays(page);
});

test('on the rail the card stays inside the window', async ({
  context,
  extensionId,
}) => {
  const page = await setUp(context, extensionId);
  const railBox = await boxOf(rail(page));

  await pickUp(page, tabHandle(page, 's2'));
  await carryTo(page, await onRail(page));
  // Either card: the flip is the drag card's too (2B).
  const card = page.locator(`${CARD}, [data-drag-card]`);
  await expect(card).toBeVisible();
  // Polled: the card is drawn a render after the move.
  await expect
    .poll(async () => {
      const b = await boxOf(card);
      return b.x + b.width;
    })
    .toBeLessThanOrEqual(NARROW.width);
  expect((await boxOf(card)).x).toBeLessThan(railBox.x);
  await page.keyboard.press('Escape');
});

test('passing over the rail under 600ms, then a drop on the saved side still moves', async ({
  context,
  extensionId,
}) => {
  const page = await setUp(context, extensionId);
  expect(await layout(page, 'S1')).toEqual(START);

  await pickUp(page, tabHandle(page, 's2'));
  // Held, so the pass is under the dwell however slow the run.
  await holdTimers(page);
  await carryTo(page, await onRail(page));
  // PREMISE: the pass was over the rail as its target.
  await expect(rail(page)).toHaveAttribute('data-carry-target', '');
  await carryTo(page, await topOf(tabHandle(page, 's1')));
  await expect(rail(page)).not.toHaveAttribute('data-carry-target', '');
  await page.clock.resume();
  await expect(drawer(page)).toHaveCount(0);
  await page.mouse.up();

  await expect.poll(() => layout(page, 'S1')).toEqual(['s0 s2 s1']);
});
