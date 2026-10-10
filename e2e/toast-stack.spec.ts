import type {
  BrowserContext,
  ElementHandle,
  Locator,
  Page,
  Worker,
} from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { sessionHeaderMenu } from './fixtures/menus';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

// KAN-349 on the real artifact: toasts stack, newest at the bottom, older
// ones above, 8px apart, at most 3; each keeps its own time and a hover on
// any holds them all; a new one rises 12px and fades in over 220ms while the
// others move up; reduced motion fades only; and Cmd/Ctrl+Z follows Q1 C′.
// What jsdom cannot show: layout, transitions, and the key in a real page.
//
// Every toast here comes from the real UI: Open now's × ("Tab closed", with
// Reopen), Save window, Save all, and Copy all links. Once the pointer rests
// on the stack, the next toasts are fired by element.click() from the page,
// so the pointer never moves and the hold never lets go.

const TAB_VIEWPORT = { width: 1280, height: 800 };
const VIEW_TAB = 'index.html?view=tab';
const OPEN_NOW = '[data-pane="open-now"]';
// The stack's corner (Toast.tsx) and its gap (useToastStack.ts).
const EDGE = 20;
const GAP = 8;
const RISE = 12;

const TAB_CLOSED = 'Tab closed';
const WINDOW_SAVED = 'Window saved as a session.';
const ALL_SAVED = 'All open windows saved as a session.';
const LINKS_COPIED = 'Links copied';

async function openPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(TAB_VIEWPORT);
  await page.goto(`chrome-extension://${extensionId}/${VIEW_TAB}`);
  // Barrier: goto resolves before React mounts.
  await page
    .getByRole('button', { name: 'Sort sessions', exact: true })
    .waitFor();
  return page;
}

const dataUrl = (title: string) => `data:text/html,<title>${title}</title>`;

// A window the browser opens, unfocused so the tab view stays in front.
async function openWindow(worker: Worker, titles: string[]): Promise<number> {
  const windowId = await worker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ focused: false, url: urls });
    return win?.id ?? null;
  }, titles.map(dataUrl));
  if (windowId === null) throw new Error('Chrome gave no window id');
  return windowId;
}

const windowBlock = (page: Page, windowId: number): Locator =>
  page.locator(`${OPEN_NOW} [data-open-window-id="${windowId}"]`);

const rowsIn = (block: Locator): Locator =>
  block.getByRole('button', { name: /^Switch to tab: / });

const closeTabIn = (block: Locator, title: string): Locator =>
  block.getByRole('button', { name: `Close tab: ${title}`, exact: true });

const region = (page: Page): Locator => page.getByRole('status');

// The toasts a screen reader and the pointer can reach, oldest first. A
// leaving toast is aria-hidden while it fades.
const liveToasts = (page: Page): Locator =>
  page.locator('[role="status"] > div:not([aria-hidden="true"])');

const reopenButton = (page: Page): Locator =>
  region(page).getByRole('button', { name: 'Reopen', exact: true });

// A click that does not move the pointer, so a hold on the stack holds.
async function clickInPlace(target: Locator): Promise<void> {
  await target.evaluate((el: Element) => {
    if (!(el instanceof HTMLElement)) throw new Error('not an HTMLElement');
    el.click();
  });
}

// Every transition in the stack has finished: a box read mid-way is neither
// where the toast was nor where it goes.
async function settled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector('[role="status"]')
            ?.getAnimations({ subtree: true }).length ?? -1
      )
    )
    .toBe(0);
}

const storedSessionCount = async (page: Page): Promise<number> => {
  const raw = await page.evaluate(() =>
    localStorage.getItem('tabContainerData')
  );
  const parsed: unknown = JSON.parse(raw ?? 'null');
  return isValidTabMasterContainer(parsed) ? parsed.tabGroups.length : 0;
};

// A saved session, so its menu can offer Copy all links.
async function seedSession(context: BrowserContext): Promise<void> {
  await seedSessions(context, buildContainer([buildSession()]));
}

// The tab view draws a session's details, and its menu, once its row is
// clicked (measured: a stored selection alone draws none).
async function openSeededSession(page: Page): Promise<void> {
  await page
    .locator('[data-pane="sessions"]')
    .getByRole('button', { name: 'Research', exact: true })
    .click();
  await expect(sessionHeaderMenu(page)).toBeVisible();
}

async function copyLinksInPlace(page: Page): Promise<void> {
  await clickInPlace(sessionHeaderMenu(page));
  await clickInPlace(page.getByRole('menuitem', { name: 'Copy all links' }));
}

// Closes one tab of a two-tab window: the Reopen toast. The pointer ends on
// the ×, which is not on the stack.
async function offerFromClose(
  page: Page,
  worker: Worker
): Promise<{ block: Locator }> {
  const windowId = await openWindow(worker, ['Keep', 'Drop']);
  const block = windowBlock(page, windowId);
  await expect(rowsIn(block)).toHaveCount(2);
  await closeTabIn(block, 'Drop').click();
  await expect(reopenButton(page)).toBeVisible();
  return { block };
}

const saveWindowIn = (block: Locator): Locator =>
  block.getByRole('button', { name: /^Save window as a session: / });

const saveAll = (page: Page): Locator =>
  page
    .locator(OPEN_NOW)
    .getByRole('button', { name: 'Save all open windows as a session' });

test.describe('toasts stack (KAN-349)', () => {
  test('1. three toasts stack newest at the bottom, 8px apart, in the corner', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const { block } = await offerFromClose(page, serviceWorker);
    // Held from here on, so the 3s toasts wait to be measured.
    await liveToasts(page).first().hover();
    await clickInPlace(saveWindowIn(block));
    await clickInPlace(saveAll(page));

    const toasts = liveToasts(page);
    await expect(toasts).toHaveCount(3);
    await expect(toasts.nth(0)).toContainText(TAB_CLOSED);
    await expect(toasts.nth(1)).toHaveText(WINDOW_SAVED);
    await expect(toasts.nth(2)).toHaveText(ALL_SAVED);
    await settled(page);

    const boxes = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const box = await toasts.nth(i).boundingBox();
        if (box === null) throw new Error(`toast ${i} has no box`);
        return box;
      })
    );
    console.log(`[stack] ${JSON.stringify(boxes)}`);
    // Newest at the bottom, in the corner the toast has always used.
    expect(boxes[2].y + boxes[2].height).toBeCloseTo(
      TAB_VIEWPORT.height - EDGE,
      0
    );
    for (const box of boxes) expect(box.x).toBeCloseTo(EDGE, 0);
    // Older ones above, 8px apart.
    for (const i of [1, 2]) {
      const gap = boxes[i].y - (boxes[i - 1].y + boxes[i - 1].height);
      expect(gap, `gap above toast ${i}`).toBeCloseTo(GAP, 0);
    }
    // Every toast in full: a plain one 300px, the offer 300px to 30rem.
    expect(boxes[1].width).toBeCloseTo(300, 0);
    expect(boxes[2].width).toBeCloseTo(300, 0);
    expect(boxes[0].width).toBeGreaterThanOrEqual(300);
    expect(boxes[0].width).toBeLessThanOrEqual(480);

    // A gap belongs to the toast below it, so the pointer crossing it stays
    // on the stack.
    const hit = (x: number, y: number) =>
      page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return {
            inStack: el?.closest('[role="status"]') !== null,
            text: el?.closest('[role="status"] > div')?.textContent ?? null,
          };
        },
        { x, y }
      );
    expect(
      await hit(boxes[1].x + 150, boxes[1].y + boxes[1].height + GAP / 2)
    ).toEqual({ inStack: true, text: ALL_SAVED });
  });

  test('2. a fourth toast pushes the oldest out, and its Reopen offer with it', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSession(context);
    const page = await openPage(context, extensionId);
    await openSeededSession(page);
    const { block } = await offerFromClose(page, serviceWorker);
    await liveToasts(page).first().hover();
    await clickInPlace(saveWindowIn(block));
    await clickInPlace(saveAll(page));
    await expect(liveToasts(page)).toHaveCount(3);

    await copyLinksInPlace(page);

    const toasts = liveToasts(page);
    await expect(toasts).toHaveCount(3);
    await expect(toasts.nth(0)).toHaveText(WINDOW_SAVED);
    await expect(toasts.nth(1)).toHaveText(ALL_SAVED);
    await expect(toasts.nth(2)).toHaveText(LINKS_COPIED);
    await expect(reopenButton(page)).toHaveCount(0);

    // Dropped, not only hidden: Ctrl+Z no longer reopens the closed tab. It
    // undoes the latest saved change instead (Save all).
    const before = await storedSessionCount(page);
    await page.keyboard.press('Control+z');
    await expect.poll(() => storedSessionCount(page)).toBe(before - 1);
    await page.waitForTimeout(500);
    await expect(rowsIn(block)).toHaveCount(1);
  });

  test('3. each toast leaves on its own time, and hovering any holds them all', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // 8s + 3s + 10s held, plus polls: past the 30s default.
    test.setTimeout(60_000);
    const page = await openPage(context, extensionId);
    const { block } = await offerFromClose(page, serviceWorker);
    await saveWindowIn(block).click();
    await expect(liveToasts(page)).toHaveCount(2);

    // The saved toast's 3s runs out first; the offer's 8s is still going.
    await expect(liveToasts(page)).toHaveCount(1, { timeout: 4500 });
    await expect(liveToasts(page).first()).toContainText(TAB_CLOSED);

    // A second saved toast, then the pointer on the stack -- collapsed, the
    // newer toast in front (KAN-488) -- opens it, and the OLDER one, the
    // offer, takes the pointer: both hold, past either's time.
    await saveWindowIn(block).click();
    await expect(liveToasts(page)).toHaveCount(2);
    await liveToasts(page).last().hover();
    await liveToasts(page).first().hover();
    await page.waitForTimeout(10_000);
    await expect(liveToasts(page)).toHaveCount(2);

    // CONTROL: away, they go.
    await page.mouse.move(TAB_VIEWPORT.width - 10, 10);
    await expect(liveToasts(page)).toHaveCount(0, { timeout: 9000 });
  });

  test('3b. the pointer resting in a gap holds the stack; beside a narrow toast it does not', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    test.setTimeout(60_000);
    const page = await openPage(context, extensionId);
    // Chrome's Font size "Large" (a 20px root, as open-now-close 11b sets
    // it): the offer grows with its line, the plain toasts stay 300px.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
    // The longer offer: a whole window closed, "Window closed (3 tabs)".
    const block = windowBlock(
      page,
      await openWindow(serviceWorker, ['Keep', 'Drop'])
    );
    const gone = windowBlock(
      page,
      await openWindow(serviceWorker, ['One', 'Two', 'Three'])
    );
    await expect(rowsIn(block)).toHaveCount(2);
    await expect(rowsIn(gone)).toHaveCount(3);
    await gone
      .getByRole('button', { name: /^Close window: Window \d+$/ })
      .click();
    await expect(reopenButton(page)).toBeVisible();
    await liveToasts(page).first().hover();
    await clickInPlace(saveWindowIn(block));
    await clickInPlace(saveAll(page));
    await expect(liveToasts(page)).toHaveCount(3);
    await settled(page);
    const offer = await liveToasts(page).nth(0).boundingBox();
    const saved = await liveToasts(page).nth(1).boundingBox();
    if (offer === null || saved === null) throw new Error('no box');
    // PREMISE: the offer is wider than the saved toast below it, so there is
    // a strip beside the saved toast that only the offer's width reaches.
    expect(offer.width - saved.width).toBeGreaterThan(20);
    const besideSaved = {
      x: saved.x + (saved.width + offer.width) / 2,
      y: saved.y + saved.height / 2,
    };
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('[role="status"]') === null,
        besideSaved
      )
    ).toBe(true);

    // In the gap below "Window saved": past both saved toasts' 3s.
    await page.mouse.move(saved.x + 150, saved.y + saved.height + GAP / 2);
    await page.waitForTimeout(4000);
    await expect(liveToasts(page)).toHaveCount(3);

    // Beside it, where only the offer above is that wide: not the stack, so
    // the saved toasts' time runs out.
    await page.mouse.move(besideSaved.x, besideSaved.y);
    await expect(liveToasts(page)).toHaveCount(1, { timeout: 4500 });
  });

  test('3c. the status region announces each toast alone (not atomic)', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId);
    const cdp = await context.newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const status = nodes.filter((n) => n.role?.value === 'status');
    expect(status).toHaveLength(1);
    const atomic = status[0].properties?.find((p) => p.name === 'atomic');
    console.log(`[a11y] ${JSON.stringify(status[0].properties)}`);
    expect(atomic?.value.value).toBe(false);
  });

  // Fires a new toast and reads the two toasts on every frame for 400ms:
  // where each sits (translateY) and how clear the new one is. `moving` is
  // what the new toast's transitions animate, read on the first frame that
  // has any.
  async function sampleArrival(page: Page, trigger: ElementHandle) {
    return page.evaluate(async (button) => {
      const live = () =>
        Array.from(
          document.querySelector('[role="status"]')?.children ?? []
        ).filter((el) => el.getAttribute('aria-hidden') !== 'true');
      const y = (el: Element) =>
        new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
      const olderBefore = y(live()[0]);
      if (!(button instanceof HTMLElement)) throw new Error('no button');
      button.click();
      const frames: { older: number; newer: number; opacity: number }[] = [];
      let moving: string[] = [];
      const start = performance.now();
      while (performance.now() - start < 400) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        const [older, newer] = live();
        if (newer === undefined) continue;
        if (moving.length === 0) {
          moving = newer
            .getAnimations()
            .map((a) =>
              a instanceof CSSTransition ? a.transitionProperty : ''
            )
            .sort();
        }
        frames.push({
          older: y(older),
          newer: y(newer),
          opacity: Number(getComputedStyle(newer).opacity),
        });
      }
      return { olderBefore, frames, moving, end: frames[frames.length - 1] };
    }, trigger);
  }

  test('4. a new toast rises 12px and fades in, and the one above moves up with it', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const { block } = await offerFromClose(page, serviceWorker);
    await liveToasts(page).first().hover();
    await settled(page);
    const button = await saveWindowIn(block).elementHandle();
    if (button === null) throw new Error('no Save window button');

    const s = await sampleArrival(page, button);
    console.log(`[rise] ${JSON.stringify(s)}`);
    const between = (v: number, from: number, to: number) =>
      v > Math.min(from, to) && v < Math.max(from, to);

    expect(s.moving).toEqual(['opacity', 'transform']);
    // Some frame shows each of them part-way: the new toast below its place
    // and part-clear, the one above part-way up.
    expect(s.frames.some((f) => between(f.newer, RISE, 0))).toBe(true);
    expect(s.frames.some((f) => between(f.opacity, 0, 1))).toBe(true);
    expect(
      s.frames.some((f) => between(f.older, s.olderBefore, s.end.older))
    ).toBe(true);
    // The new toast only ever rises: never below its start, never past its
    // place.
    for (const f of s.frames) {
      expect(f.newer).toBeGreaterThanOrEqual(0);
      expect(f.newer).toBeLessThanOrEqual(RISE);
    }
    // At rest: in place, opaque, the one above moved up by the new one's
    // height and the gap.
    expect(s.end.newer).toBe(0);
    expect(s.end.opacity).toBe(1);
    const newerHeight = await liveToasts(page)
      .nth(1)
      .evaluate((el: Element) => el.getBoundingClientRect().height);
    expect(s.olderBefore - s.end.older).toBeCloseTo(newerHeight + GAP, 0);
  });

  test('5. with reduced motion, toasts only fade: nothing moves', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { block } = await offerFromClose(page, serviceWorker);
    await liveToasts(page).first().hover();
    await settled(page);
    const button = await saveWindowIn(block).elementHandle();
    if (button === null) throw new Error('no Save window button');

    const s = await sampleArrival(page, button);
    console.log(`[reduced] ${JSON.stringify(s)}`);

    expect(s.moving).toEqual(['opacity']);
    // Every frame has both in place: nothing moves while the new one fades
    // in, and some frame shows it part-clear.
    for (const f of s.frames) {
      expect(f.newer).toBe(0);
      expect(f.older).toBe(s.end.older);
    }
    expect(s.frames.some((f) => f.opacity > 0 && f.opacity < 1)).toBe(true);
    expect(s.end.opacity).toBe(1);
  });

  test('6. Ctrl+Z after a saved change undoes it and leaves the offer; its hint goes (Q1 C′)', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const { block } = await offerFromClose(page, serviceWorker);
    const hint = reopenButton(page).locator('[data-key-hint]');
    // PREMISE: the offer shows the key while it has it.
    await expect(hint).toBeVisible();
    const before = await storedSessionCount(page);

    await saveWindowIn(block).click();
    await expect(liveToasts(page).nth(1)).toHaveText(WINDOW_SAVED);
    await expect.poll(() => storedSessionCount(page)).toBe(before + 1);
    await expect(hint).toHaveCount(0);

    await page.keyboard.press('Control+z');

    // The save is undone...
    await expect.poll(() => storedSessionCount(page)).toBe(before);
    // ...the closed tab is not back, and the offer is still there to take.
    await page.waitForTimeout(500);
    await expect(rowsIn(block)).toHaveCount(1);
    await expect(reopenButton(page)).toBeVisible();
  });

  test('7. CONTROL: Ctrl+Z after Links copied still reopens the closed tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSession(context);
    const page = await openPage(context, extensionId);
    await openSeededSession(page);
    const { block } = await offerFromClose(page, serviceWorker);
    await liveToasts(page).first().hover();
    await copyLinksInPlace(page);
    await expect(liveToasts(page).nth(1)).toHaveText(LINKS_COPIED);
    const before = await storedSessionCount(page);

    await page.keyboard.press('Control+z');

    await expect(rowsIn(block)).toHaveCount(2);
    expect(await storedSessionCount(page)).toBe(before);
  });
});

// KAN-488. At rest the stack collapses: the newest toast in front, the older
// ones peeking above it, narrower, content hidden. Hover opens it into test
// 1's layout; leaving closes it again.
test.describe('the stack collapses until hovered (KAN-488)', () => {
  const boxesOf = (toasts: Locator) =>
    Promise.all(
      [0, 1, 2].map(async (i) => {
        const box = await toasts.nth(i).boundingBox();
        if (box === null) throw new Error(`toast ${i} has no box`);
        return box;
      })
    );
  const contentOpacity = (toasts: Locator) =>
    Promise.all(
      [0, 1, 2].map((i) =>
        toasts
          .nth(i)
          .evaluate((el: Element) =>
            Number(
              el.firstElementChild === null
                ? NaN
                : getComputedStyle(el.firstElementChild).opacity
            )
          )
      )
    );

  test('8. the newest in front, the older two peek above it; hovering opens the stack, leaving closes it', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openPage(context, extensionId);
    const { block } = await offerFromClose(page, serviceWorker);
    // The pointer stays on Open now's ×, off the stack.
    await clickInPlace(saveWindowIn(block));
    await clickInPlace(saveAll(page));
    const toasts = liveToasts(page);
    await expect(toasts).toHaveCount(3);
    await settled(page);

    const shut = await boxesOf(toasts);
    console.log(`[collapsed] ${JSON.stringify(shut)}`);
    const [oldest, middle, newest] = shut;
    // The newest in the corner, where the toast has always been.
    expect(newest.y + newest.height).toBeCloseTo(TAB_VIEWPORT.height - EDGE, 0);
    expect(newest.x).toBeCloseTo(EDGE, 0);
    // Each older toast peeks above the one in front of it and ends behind it.
    expect(middle.y).toBeLessThan(newest.y);
    expect(oldest.y).toBeLessThan(middle.y);
    for (const older of [oldest, middle]) {
      expect(older.y + older.height).toBeLessThanOrEqual(
        newest.y + newest.height
      );
      // Behind it, not above it: its bottom is under the front toast.
      expect(older.y + older.height).toBeGreaterThan(newest.y);
    }
    // A peek is at most 8px, less what its narrowing takes off its top.
    expect(newest.y - middle.y).toBeLessThanOrEqual(8);
    expect(middle.y - oldest.y).toBeLessThanOrEqual(8);
    expect(await contentOpacity(toasts)).toEqual([0, 0, 1]);
    // The pointer on a peek is on the stack, so it opens it like the front toast.
    const onPeek = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('[role="status"]') !== null,
      { x: newest.x + newest.width / 2, y: (oldest.y + middle.y) / 2 }
    );
    expect(onPeek).toBe(true);

    // Hovering the front toast opens test 1's stack: every toast in full, 8px apart.
    await page.mouse.move(newest.x + 20, newest.y + newest.height / 2);
    await settled(page);
    const opened = await boxesOf(toasts);
    for (const i of [1, 2]) {
      const gap = opened[i].y - (opened[i - 1].y + opened[i - 1].height);
      expect(gap, `gap above toast ${i}`).toBeCloseTo(GAP, 0);
    }
    expect(await contentOpacity(toasts)).toEqual([1, 1, 1]);
    // Collapsed, each was its full width less 5% per toast in front of it.
    expect(shut[0].width / opened[0].width).toBeCloseTo(0.9, 2);
    expect(shut[1].width / opened[1].width).toBeCloseTo(0.95, 2);
    expect(shut[2].width).toBeCloseTo(opened[2].width, 0);

    // Leaving closes it again.
    await page.mouse.move(TAB_VIEWPORT.width - 10, 10);
    await settled(page);
    const again = await boxesOf(toasts);
    expect(again.map((b) => Math.round(b.y))).toEqual(
      shut.map((b) => Math.round(b.y))
    );
  });
});
