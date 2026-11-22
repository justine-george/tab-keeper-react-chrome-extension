import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP } from './fixtures/savedWindows';
import { NEEDS_YOU_TOAST_MS } from '../src/redux/toastDuration';

// KAN-979 (pick A) on the real artifact: a line along each toast's bottom edge
// shrinks as its time runs out, stops while the stack is held, carries on when
// released, hides with a folded toast's content, keeps its place when a toast
// loses its Undo, and is not drawn at all with reduced motion.
// Toasts come from ⌫ on a focused session row ("Session deleted.", with Undo,
// NEEDS_YOU_TOAST_MS), so no pointer has to cross the stack to make one.

const SESSIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) =>
  buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
);
const AWAY = { x: 700, y: 60 };

async function openPopup(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer(SESSIONS),
    selectedTabGroupId: 's-alpha',
  });
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts. Locale-free.
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const toasts = (page: Page): Locator =>
  page.locator('[role="status"] > [data-toast]:not([aria-hidden="true"])');

// Deletes the session in the focused row with ⌫, the pointer kept off the stack.
async function deleteFocused(page: Page): Promise<void> {
  await page.keyboard.press('Backspace');
  await page.mouse.move(AWAY.x, AWAY.y);
}

// How much of a toast's line is left: the bar's drawn width over the line's.
const leftOf = (toast: Locator): Promise<number> =>
  toast.evaluate((el) => {
    const line = el.querySelector('[data-time-left]');
    const bar = line?.firstElementChild;
    if (!line || !bar) throw new Error('no time-left line');
    return (
      bar.getBoundingClientRect().width / line.getBoundingClientRect().width
    );
  });

const lineOpacity = (toast: Locator): Promise<string> =>
  toast.evaluate((el) => {
    const line = el.querySelector('[data-time-left]');
    if (!line) throw new Error('no time-left line');
    return getComputedStyle(line).opacity;
  });

async function startWithOne(page: Page): Promise<Locator> {
  await page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: 'Alpha', exact: true })
    .focus();
  await deleteFocused(page);
  await expect(toasts(page)).toHaveCount(1);
  return toasts(page).first();
}

test('the line shrinks, stops while the stack is held, and carries on after', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const toast = await startWithOne(page);

  const first = await leftOf(toast);
  await page.waitForTimeout(600);
  const later = await leftOf(toast);
  // 600ms of 8s is 0.075 of the line.
  expect(later).toBeLessThan(first - 0.04);

  const box = await toast.boundingBox();
  if (box === null) throw new Error('no toast box');
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const held = await leftOf(toast);
  await page.waitForTimeout(900);
  expect(Math.abs((await leftOf(toast)) - held)).toBeLessThan(0.005);

  await page.mouse.move(AWAY.x, AWAY.y);
  await page.waitForTimeout(600);
  const released = await leftOf(toast);
  expect(released).toBeLessThan(held - 0.04);
  // It carried on from where it stopped: the hold took nothing off.
  expect(released).toBeGreaterThan(held - 0.12);
});

test('folded, only the front line shows; the older one keeps its time after losing Undo', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await startWithOne(page);
  await page.waitForTimeout(1500);
  // Focus is on the row now in Alpha's place: ⌫ deletes it too.
  await deleteFocused(page);
  await expect(toasts(page)).toHaveCount(2);
  const [older, front] = [toasts(page).nth(0), toasts(page).nth(1)];
  // PREMISE: the newer step took the older toast's Undo.
  await expect(older.getByRole('button')).toHaveCount(0);
  await expect(front.getByRole('button', { name: 'Undo' })).toBeVisible();

  await page.waitForTimeout(400);
  expect(await lineOpacity(older)).toBe('0');
  expect(await lineOpacity(front)).toBe('1');

  // Open the stack to read the older line: it has run ~2s of its 8s, not restarted.
  const box = await front.boundingBox();
  if (box === null) throw new Error('no toast box');
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.waitForTimeout(400);
  const olderLeft = await leftOf(older);
  const used = 1 - olderLeft;
  expect(used).toBeGreaterThan(1500 / NEEDS_YOU_TOAST_MS);
  expect(olderLeft).toBeLessThan(await leftOf(front));
});

test('with reduced motion there is no line, and the toast still leaves on time', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const toast = await startWithOne(page);

  const shown = await toast.evaluate((el) => {
    const line = el.querySelector('[data-time-left]');
    return line === null ? 'none' : getComputedStyle(line).display;
  });
  expect(shown).toBe('none');
  await expect(toasts(page)).toHaveCount(0, {
    timeout: NEEDS_YOU_TOAST_MS + 2000,
  });
});
