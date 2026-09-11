import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-153/154/155/156. Dragging a window folds every window shut, and a folded
// list is a different LAYOUT from the one the user picked the row up in. Every
// defect in this area was a coordinate read from the wrong one of those two
// layouts, and every one was invisible to jsdom, which has neither layout nor
// scrolling. So these run in the real popup, and every drag in a session long
// enough to scroll starts SCROLLED: scrollTop 0 is the one starting position
// where the stale-origin bugs cannot appear.
//
// "Where the user pointed" is read off the drag PREVIEW at the instant of
// release -- the rows shifted aside are the index the UI was showing -- rather
// than predicted from rects. Predicting from rects misread two KAN-129 probes;
// the preview is what the user actually saw.

const win = (i: number, tabs: number) => ({
  windowId: `w${i}`,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs,
  title: `Window ${i}`,
  tabs: Array.from({ length: tabs }, (_, t) => ({
    tabId: `w${i}-t${t}`,
    favicon: '',
    title: `W${i} tab ${t}`,
    url: `https://w${i}-${t}.test/`,
  })),
});

async function openSession(
  context: BrowserContext,
  extensionId: string,
  windows: number,
  tabsEach: number
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Drag session',
    isSelected: true,
    windowCount: windows,
    tabCount: windows * tabsEach,
    windows: Array.from({ length: windows }, (_, i) => win(i, tabsEach)),
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105); wait on the LAST window, which
  // is the one the pane has to be tall enough to hold.
  await expect(
    page.locator(`[data-drag-row-id="w${windows - 1}"]`)
  ).toBeAttached();
  return page;
}

// The pane: the bordered `overflow: auto` box holding the window list. Scrolls
// it, and records at the instant of release -- in capture, so before the
// engine's own pointerup runs -- what the preview was showing.
async function scrollPaneAndRecord(page: Page, scrollTop: number) {
  return page.evaluate((top) => {
    let el = document.querySelector('[data-drag-row-id="w0"]')!.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    const pane = el!;
    pane.scrollTop = top;
    (window as unknown as { __preview: number | null }).__preview = null;

    const windowRows = () =>
      [...document.querySelectorAll<HTMLElement>('[data-drag-row-id]')].filter(
        (r) => r.querySelector('[data-window-drag-handle]') !== null
      );
    window.addEventListener(
      'pointerup',
      () => {
        const rows = windowRows();
        const from = rows.findIndex((r) => r.style.boxShadow !== '');
        const shift = (r: HTMLElement) =>
          Number(
            /translateY\((-?[\d.]+)px\)/.exec(r.style.transform)?.[1] ?? 0
          );
        const up = rows.filter((r, i) => i !== from && shift(r) < 0).length;
        const down = rows.filter((r, i) => i !== from && shift(r) > 0).length;
        (window as unknown as { __preview: number }).__preview =
          from + up - down;
      },
      { capture: true, once: true }
    );

    const b = pane.getBoundingClientRect();
    return {
      scrollTop: pane.scrollTop,
      top: b.top,
      bottom: b.bottom,
    };
  }, scrollTop);
}

// The topmost window header wholly inside the pane -- the one a user scrolled
// to this position would actually grab.
async function topVisibleHeader(
  page: Page,
  pane: { top: number; bottom: number }
) {
  return page.evaluate(({ top, bottom }) => {
    for (const h of document.querySelectorAll('[data-window-drag-handle]')) {
      const r = h.getBoundingClientRect();
      if (r.top >= top && r.bottom <= bottom) {
        return {
          id: (h.closest('[data-drag-row-id]') as HTMLElement).dataset
            .dragRowId!,
          x: r.left + 60,
          y: r.top + r.height / 2,
        };
      }
    }
    throw new Error('no window header is visible in the pane');
  }, pane);
}

async function dragTo(page: Page, from: { x: number; y: number }, toY: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Past the activation distance, which is where the list folds.
  await page.mouse.move(from.x, from.y + 10, { steps: 3 });
  await page.mouse.move(from.x, toY, { steps: 12 });
  await page.mouse.up();
}

const storedOrder = (page: Page) =>
  page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem('tabContainerData')!) as {
        tabGroups: { windows: { windowId: string }[] }[];
      }
    ).tabGroups[0].windows.map((w) => w.windowId)
  );

test.describe('dragging a window from a scrolled position', () => {
  // KAN-156. Twenty windows fold to a list that STILL overflows, so the scroll
  // never reaches 0 and the browser re-anchors it when the windows unfold. The
  // drop was judged after unfolding and landed last whatever the preview said.
  test('in a long session, it lands where the preview showed', async ({
    context,
    extensionId,
  }) => {
    const page = await openSession(context, extensionId, 20, 3);
    const pane = await scrollPaneAndRecord(page, 1200);
    expect(pane.scrollTop).toBe(1200);
    const grab = await topVisibleHeader(page, pane);

    // Mid-pane: clear of both auto-scroll edge zones, and inside the rows.
    await dragTo(page, grab, (pane.top + pane.bottom) / 2);

    const preview = await page.evaluate(
      () => (window as unknown as { __preview: number | null }).__preview
    );
    // The control that the premise held: a real mid-list slot, not an end.
    // Both ends are where a mis-judged drop saturates.
    expect(preview).toBeGreaterThan(0);
    expect(preview).toBeLessThan(19);

    await expect
      .poll(async () => (await storedOrder(page)).indexOf(grab.id))
      .toBe(preview);
  });

  // KAN-155. Two windows never overflow the pane, so there is no scrolling
  // ancestor -- and the first cut of the clamp looked for one, and refused.
  test('in a short session, a release under the folded rows lands last', async ({
    context,
    extensionId,
  }) => {
    const page = await openSession(context, extensionId, 2, 3);
    const pane = await scrollPaneAndRecord(page, 0);
    const grab = await topVisibleHeader(page, pane);
    expect(grab.id).toBe('w0');

    // The bottom of the view: far below two folded headers.
    await dragTo(page, grab, pane.bottom - 8);

    await expect.poll(() => storedOrder(page)).toEqual(['w1', 'w0']);
  });

  // THE CONTROL for the one above: the pane is the bound, not the screen. Above
  // it are the session header and the save row.
  //
  // And KAN-157: nothing moved, so the view is back where it was. Folding five
  // windows clamps the scroll 300 -> 0, and before the fix it stayed there,
  // with the held window off screen below the pane.
  test('CONTROL: released above the pane, nothing moves and the view comes back', async ({
    context,
    extensionId,
  }) => {
    const page = await openSession(context, extensionId, 5, 6);
    const pane = await scrollPaneAndRecord(page, 300);
    const grab = await topVisibleHeader(page, pane);

    await dragTo(page, grab, pane.top - 30);
    // Long enough for a commit to have been written, were there one.
    await page.waitForTimeout(300);

    expect(await storedOrder(page)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
    expect(await paneState(page, grab.id)).toEqual({
      scrollTop: 300,
      headerVisible: true,
    });
  });

  // KAN-157. Escape means nothing happened, and that includes what you were
  // looking at.
  test('after Escape, the view is where the drag began', async ({
    context,
    extensionId,
  }) => {
    const page = await openSession(context, extensionId, 5, 6);
    const pane = await scrollPaneAndRecord(page, 300);
    const grab = await topVisibleHeader(page, pane);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y + 40, { steps: 6 });
    // The premise: the fold really did take the scroll away. Without it, a
    // restore that never ran would pass.
    expect((await paneState(page, grab.id)).scrollTop).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect
      .poll(() => paneState(page, grab.id))
      .toEqual({ scrollTop: 300, headerVisible: true });
    expect(await storedOrder(page)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
  });
});

// The pane's scroll, and whether the given window's header is wholly on screen.
const paneState = (page: Page, windowId: string) =>
  page.evaluate((id) => {
    const header = document.querySelector(
      `[data-drag-row-id="${id}"] [data-window-drag-handle]`
    )!;
    let el = header.parentElement;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      el = el.parentElement;
    const p = el!.getBoundingClientRect();
    const h = header.getBoundingClientRect();
    return {
      scrollTop: el!.scrollTop,
      headerVisible: h.top >= p.top && h.bottom <= p.bottom,
    };
  }, windowId);
