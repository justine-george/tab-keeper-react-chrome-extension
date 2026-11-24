import type { Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  detailPane,
  groupedWindow,
  header,
  openSaved,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import { documentLanded } from './fixtures/landed';
import {
  between,
  samples,
  startSampling,
  topOf,
} from './fixtures/glideSamples';

// KAN-993 (his picks, round 1: add C, undo B). An added tab or window comes
// out from under the row above, with every row below, as a new session does
// (KAN-988, KAN-991). Undoing the add closes up as a delete does; redoing it
// arrives again. From the keyboard and under Reduce motion it is instant.

const SESSIONS = [
  session('S1', 'Trip', [
    groupedWindow('w1', 'Flights', [
      { groupId: 'g1', title: 'Booked', color: 'green' },
      { groupId: 'g2', title: 'Explore', color: 'pink' },
    ]),
    savedWindow('w2', 'Food', 3),
    savedWindow('w3', 'Later', 6),
  ]),
  session('S2', 'Reading', [savedWindow('r1', 'Articles', 2)]),
];

const DETAIL = '[data-pane="detail"]';
// The added tab, loose in a window: the only "tab:" row not seeded (a new id is a uuid, never "tab:w…").
const NEW_TAB = `${DETAIL} [data-drag-row-id^="tab:"]:not([data-drag-row-id^="tab:w"])`;
// What it holds: that comes down inside the row's own clip.
const NEW_TAB_INSIDE = `${NEW_TAB} > [data-drag-row-id]`;
// The added tab in group g2: its only row not seeded (seeded ones are "g2-t…").
const NEW_GROUP_TAB = `${DETAIL} [data-band-id="g2"] [data-drag-row-id]:not([data-drag-row-id^="g"])`;
const NEW_GROUP_TAB_INSIDE = `${NEW_GROUP_TAB} > *`;
const tabRow = (id: string) => `${DETAIL} [data-drag-row-id="${id}"]`;
const windowBlock = (id: string) => `${DETAIL} [data-drag-row-id="${id}"]`;
// The added window: the only window block not seeded.
const NEW_WINDOW = `${DETAIL} [data-drop-window-id]:not([data-drop-window-id^="w"]):not([data-drop-window-id^="new-window"])`;
const sessionRow = (id: string) =>
  `[data-pane="sessions"] [data-drag-row-id="${id}"]`;

// Some frames strictly between `from` and `to`: it travelled, it did not jump.
const travelled = (tops: number[], from: number, to: number) =>
  between(tops, from, to).length >= 3;
const faded = (ops: number[]) => ops.some((v) => v > 0.05 && v < 0.95);

async function popup(
  context: Parameters<typeof openSaved>[0],
  extensionId: string,
  selected = 'S1'
): Promise<Page> {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
    selected,
    overOrdinaryTab: true,
  });
  await documentLanded(page);
  return page;
}

const addTab = (page: Page, windowId: string) =>
  header(page, windowId).getByRole('button', {
    name: 'Add current tab',
    exact: true,
  });
const addTabToGroup = (page: Page, groupId: string) =>
  page
    .locator(`${DETAIL} [data-band-id="${groupId}"]`)
    .getByRole('button', { name: 'Add current tab to group', exact: true });
const addWindow = (page: Page) =>
  page.getByRole('button', { name: 'Add current window', exact: true });
const undo = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true });
const redo = (page: Page) =>
  page.getByRole('button', { name: 'Redo', exact: true });

test.describe('an add', () => {
  test('Add current tab: the row comes out from under the window row, with the rows below', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const below = tabRow('g1-t0');
    const from = await topOf(page.locator(below));

    await startSampling(page, {
      below,
      inside: NEW_TAB_INSIDE,
      'new:ov': NEW_TAB,
      'new:op': NEW_TAB,
    });
    await addTab(page, 'w1').click();
    const s = await samples(page);
    const to = await topOf(page.locator(below));
    const place = await topOf(page.locator(NEW_TAB));

    expect(to - from).toBeGreaterThan(20);
    expect(travelled(s.below, from, to)).toBe(true);
    expect(travelled(s.inside, place - (to - from), place)).toBe(true);
    expect(s['new:ov']).toContain(1);
    expect(faded(s['new:op'])).toBe(false);
  });

  test('Add current tab to group: the row comes out from under the band', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const below = tabRow('g2-t0');
    const from = await topOf(page.locator(below));
    const nextWindow = windowBlock('w2');
    const windowFrom = await topOf(page.locator(nextWindow));

    await startSampling(page, {
      below,
      nextWindow,
      inside: NEW_GROUP_TAB_INSIDE,
      'new:op': NEW_GROUP_TAB,
    });
    await page.locator(`${DETAIL} [data-band-id="g2"]`).first().hover();
    await addTabToGroup(page, 'g2').click();
    const s = await samples(page);
    const to = await topOf(page.locator(below));
    const place = await topOf(page.locator(NEW_GROUP_TAB));

    expect(to - from).toBeGreaterThan(20);
    expect(travelled(s.below, from, to)).toBe(true);
    expect(
      travelled(s.nextWindow, windowFrom, await topOf(page.locator(nextWindow)))
    ).toBe(true);
    expect(travelled(s.inside, place - (to - from), place)).toBe(true);
    expect(faded(s['new:op'])).toBe(false);
  });

  test("Add current window: the window comes down from under the pane's top edge, with the windows below", async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const below = windowBlock('w1');
    const from = await topOf(page.locator(below));

    await startSampling(page, {
      below,
      new: NEW_WINDOW,
      'new:op': NEW_WINDOW,
    });
    await addWindow(page).click();
    const s = await samples(page);
    const to = await topOf(page.locator(below));

    expect(to - from).toBeGreaterThan(40);
    expect(travelled(s.below, from, to)).toBe(true);
    expect(travelled(s.new, from - (to - from), from)).toBe(true);
    expect(faded(s['new:op'])).toBe(false);
  });

  test("from a session row's menu, the session is shown first and the window then comes down", async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId, 'S2');
    await page.locator(sessionRow('S1')).click({ button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: 'Add current window' })
    ).toBeVisible();

    await startSampling(page, {
      below: windowBlock('w1'),
      new: NEW_WINDOW,
    });
    await page.getByRole('menuitem', { name: 'Add current window' }).click();
    const s = await samples(page);
    const from = s.below.find((v) => !Number.isNaN(v)) ?? NaN;
    const to = await topOf(page.locator(windowBlock('w1')));

    // The pane showed S1 before the window came: w1 was drawn at its old place first.
    expect(to - from).toBeGreaterThan(40);
    expect(travelled(s.below, from, to)).toBe(true);
    expect(travelled(s.new, from - (to - from), from)).toBe(true);
  });

  test('with the pane scrolled down, Add current window first brings its top into view', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    await page.evaluate(() => {
      let el = document.querySelector(
        '[data-pane="detail"] [data-drop-window-id]'
      )?.parentElement;
      while (el && getComputedStyle(el).overflowY !== 'auto')
        el = el.parentElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
    expect((await detailPane(page)).scrollTop).toBeGreaterThan(0);

    await startSampling(page, { new: NEW_WINDOW });
    await addWindow(page).click();
    const s = await samples(page);

    expect((await detailPane(page)).scrollTop).toBe(0);
    const place = await topOf(page.locator(NEW_WINDOW));
    expect(between(s.new, place - 200, place).length).toBeGreaterThanOrEqual(3);
  });

  test('on a folded window, the unfold brings the new row with the rest, as a fold does', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    await header(page, 'w1')
      .getByRole('button', { name: 'Collapse: Flights', exact: true })
      .click();
    await expect(page.locator(tabRow('g1-t0'))).toBeHidden();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    const nextWindow = windowBlock('w2');
    const from = await topOf(page.locator(nextWindow));

    await startSampling(page, { nextWindow, 'new:op': NEW_TAB });
    await addTab(page, 'w1').click();
    const s = await samples(page);
    const to = await topOf(page.locator(nextWindow));

    expect(to - from).toBeGreaterThan(40);
    expect(travelled(s.nextWindow, from, to)).toBe(true);
    // A fold's rows fade in as the rows below clear them.
    expect(faded(s['new:op'])).toBe(true);
  });

  test('from the keyboard it is instant', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    const below = tabRow('g1-t0');
    const from = await topOf(page.locator(below));
    await addTab(page, 'w1').focus();

    await startSampling(page, { below, inside: NEW_TAB_INSIDE });
    await page.keyboard.press('Enter');
    const s = await samples(page);
    const to = await topOf(page.locator(below));

    expect(to - from).toBeGreaterThan(20);
    expect(between(s.below, from, to)).toEqual([]);
  });

  test('with Reduce motion it is instant', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const below = windowBlock('w1');
    const from = await topOf(page.locator(below));

    await startSampling(page, { below, new: NEW_WINDOW });
    await addWindow(page).click();
    const s = await samples(page);
    const to = await topOf(page.locator(below));

    expect(to - from).toBeGreaterThan(40);
    expect(between(s.below, from, to)).toEqual([]);
  });
});

test.describe('undo and redo of an add', () => {
  test('Undo closes up like a delete; Redo comes out from under the row above again', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const below = tabRow('g1-t0');
    const rest = await topOf(page.locator(below));
    await addTab(page, 'w1').click();
    await expect(page.locator(NEW_TAB)).toBeVisible();
    await page.waitForTimeout(400);
    const added = await topOf(page.locator(below));

    await startSampling(page, { below });
    await undo(page).click();
    const u = await samples(page);
    await expect(page.locator(NEW_TAB)).toHaveCount(0);
    expect(travelled(u.below, added, rest)).toBe(true);
    // The row left as a copy that faded where it stood.
    expect(Math.max(...u.copies)).toBeGreaterThan(0);

    await startSampling(page, { below, inside: NEW_TAB_INSIDE });
    await redo(page).click();
    const r = await samples(page);
    await expect(page.locator(NEW_TAB)).toBeVisible();
    expect(travelled(r.below, rest, added)).toBe(true);
    const place = await topOf(page.locator(NEW_TAB));
    expect(travelled(r.inside, place - (added - rest), place)).toBe(true);
  });

  test('Undo of an added window closes up the same way', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const below = windowBlock('w1');
    const rest = await topOf(page.locator(below));
    await addWindow(page).click();
    await expect(page.locator(NEW_WINDOW)).toBeVisible();
    await page.waitForTimeout(400);
    const added = await topOf(page.locator(below));

    await startSampling(page, { below });
    await undo(page).click();
    const u = await samples(page);
    await expect(page.locator(NEW_WINDOW)).toHaveCount(0);
    expect(travelled(u.below, added, rest)).toBe(true);
    expect(Math.max(...u.copies)).toBeGreaterThan(0);
  });

  test('Undo of a new session closes up the sessions list like a delete', async ({
    context,
    extensionId,
  }) => {
    const page = await popup(context, extensionId);
    const below = sessionRow('S1');
    const rest = await topOf(page.locator(below));
    await page
      .getByRole('button', {
        name: 'Save all open windows as a session',
        exact: true,
      })
      .click();
    await expect(
      page.locator('[data-pane="sessions"] [data-drag-row-id]')
    ).toHaveCount(3);
    await page.waitForTimeout(400);
    const added = await topOf(page.locator(below));
    expect(added - rest).toBeGreaterThan(40);

    await startSampling(page, { below });
    await undo(page).click();
    const u = await samples(page);
    await expect(
      page.locator('[data-pane="sessions"] [data-drag-row-id]')
    ).toHaveCount(2);
    expect(travelled(u.below, added, rest)).toBe(true);
    expect(Math.max(...u.copies)).toBeGreaterThan(0);
  });

  test('⌘Z undoes an add at once', async ({ context, extensionId }) => {
    const page = await popup(context, extensionId);
    const below = tabRow('g1-t0');
    const rest = await topOf(page.locator(below));
    await addTab(page, 'w1').click();
    await expect(page.locator(NEW_TAB)).toBeVisible();
    await page.waitForTimeout(400);
    const added = await topOf(page.locator(below));
    await page.mouse.move(0, 0);

    await startSampling(page, { below });
    await page.keyboard.press('ControlOrMeta+z');
    const u = await samples(page);
    await expect(page.locator(NEW_TAB)).toHaveCount(0);
    expect(between(u.below, added, rest)).toEqual([]);
  });
});
