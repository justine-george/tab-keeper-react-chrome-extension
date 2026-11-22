import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { POPUP } from './fixtures/savedWindows';
import { sessionHeaderMenu } from './fixtures/menus';
import { CHALK_THEME } from '../src/hooks/useThemeColors';
import { rgb } from './fixtures/pixels';
import { NEEDS_YOU_TOAST_MS } from '../src/redux/toastDuration';

// KAN-979 (pick A) on the real artifact: a line along each toast's bottom edge
// shrinks as its time runs out, stops while the stack is held, carries on when
// released, shows on the front toast only, keeps its time when a toast comes
// forward, and is not drawn at all with reduced motion.
// Toasts come from ⌫ on a focused session row ("Session deleted.", with Undo,
// NEEDS_YOU_TOAST_MS), so no pointer has to cross the stack to make one.

const SESSIONS = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) =>
  buildSession({ tabGroupId: `s-${t.toLowerCase()}`, title: t })
);
const AWAY = { x: 700, y: 60 };

// Pick D: the front toast is 4px taller, so its text or chip has the same gap
// down to the line as above it; a toast with no line keeps today's 48px.
const TODAY_PX = 48;
const FRONT_PX = 52;

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

// Whether a toast's line can be seen: drawn, and not hidden with its content.
const lineShows = (toast: Locator): Promise<boolean> =>
  toast.evaluate((el) => {
    const line = el.querySelector('[data-time-left]');
    if (!line) throw new Error('no time-left line');
    const style = getComputedStyle(line);
    return style.display !== 'none' && style.opacity !== '0';
  });

// Where a toast's contents sit (CSS px): its text, its chip if it has one,
// and the top of its line's 3px strip.
const geometry = (toast: Locator) =>
  toast.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('span') as Node);
    const text = range.getBoundingClientRect();
    const chip = el.querySelector('button')?.getBoundingClientRect() ?? null;
    const strip = box.bottom - 1 - 3;
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      height: r(box.height),
      textTop: r(text.top - box.top),
      textToLine: r(strip - text.bottom),
      chipTop: chip && r(chip.top - box.top),
      chipToLine: chip && r(strip - chip.bottom),
      chipToBottom: chip && r(box.bottom - chip.bottom),
    };
  });

async function copyAllLinks(page: Page): Promise<void> {
  await sessionHeaderMenu(page).click();
  await page.getByRole('menuitem', { name: 'Copy all links' }).click();
  await page.mouse.move(AWAY.x, AWAY.y);
}

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

test('only the front toast shows its line, folded or open; the one behind comes forward with its time used', async ({
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

  await page.waitForTimeout(400);
  expect(await lineShows(older)).toBe(false);
  expect(await lineShows(front)).toBe(true);

  // Open (the pointer on the stack): still only the front line.
  const box = await front.boundingBox();
  if (box === null) throw new Error('no toast box');
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.waitForTimeout(400);
  expect(await lineShows(older)).toBe(false);
  expect(await lineShows(front)).toBe(true);

  // Undo closes the front; the older one comes forward, ~2s of its 8s used, not restarted.
  await front.getByRole('button', { name: 'Undo' }).click();
  await expect(toasts(page)).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await lineShows(older)).toBe(true);
  expect(1 - (await leftOf(older))).toBeGreaterThan(1500 / NEEDS_YOU_TOAST_MS);
});

test('the front toast makes room for its line over a track; one behind keeps 48px', async ({
  context,
  extensionId,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await openPopup(context, extensionId);
  const undo = await startWithOne(page);
  await page.waitForTimeout(400);
  // The Undo chip: as far from the line as from the top (6px padding + 1px border).
  expect(await geometry(undo)).toMatchObject({
    height: FRONT_PX,
    chipTop: 7,
    chipToLine: 7,
  });
  // The track: the line's full width, under the shrinking bar.
  const track = await undo.evaluate((el) => {
    const line = el.querySelector('[data-time-left]') as Element;
    const before = getComputedStyle(line, '::before');
    return {
      height: before.height,
      width: before.width,
      lineWidth: `${line.getBoundingClientRect().width}px`,
      colour: before.backgroundColor,
    };
  });
  expect(track).toEqual({
    height: '3px',
    width: track.lineWidth,
    lineWidth: track.lineWidth,
    colour: rgb(CHALK_THEME.DIVIDER_COLOR),
  });

  await copyAllLinks(page);
  await expect(toasts(page)).toHaveCount(2);
  const [behind, plain] = [toasts(page).nth(0), toasts(page).nth(1)];
  await page.waitForTimeout(400);
  // Plain text: as far from the line as from the top.
  const front = await geometry(plain);
  expect(front.height).toBe(FRONT_PX);
  expect(Math.abs(front.textTop - front.textToLine)).toBeLessThanOrEqual(0.5);

  // Opened, the Undo toast behind has no line, and is today's 48px, chip centred.
  const box = await plain.boundingBox();
  if (box === null) throw new Error('no toast box');
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.waitForTimeout(400);
  expect(await geometry(behind)).toMatchObject({
    height: TODAY_PX,
    chipTop: 7,
    chipToBottom: 7,
  });
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
  // With no line, no room for one: today's 48px.
  expect((await geometry(toast)).height).toBe(TODAY_PX);
  await expect(toasts(page)).toHaveCount(0, {
    timeout: NEEDS_YOU_TOAST_MS + 2000,
  });
});
