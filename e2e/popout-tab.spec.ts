import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildSession, seedSessions, seedSettings } from './fixtures/seed';

// KAN-279 D1/D2. The tab view (`?view=tab`) fills the window instead of
// sitting in the popup's fixed 790x550 box: MainContainer switches to a
// three-column grid (356px / 1fr / 0, the last reserved and empty for the
// Active Session pane -- KAN-280) and each pane's height becomes 100vh. The
// popup itself must not move by a single pixel.
//
// Panes are found by `data-pane="sessions"|"detail"` on the two container
// divs MainContainer already renders. No existing hook reaches them: an
// aria-labelled row's nearest bordered ancestor is TabGroupEntryContainer (an
// inset framed box, margin: 8px 0 inside LeftPane's own 8px padding), not the
// leftPaneStyle/rightPaneStyle div this task changes the width of -- walking
// up from it stops two levels too early. The attribute carries no layout of
// its own, so it is inert for every other spec.
const TAB_VIEWPORT = { width: 1280, height: 800 };
const POPUP_VIEWPORT = { width: 790, height: 550 };

// CONTROL literals. Measured on this branch's HEAD (57c8b5e), before any of
// this task's changes, at 790x550, via `[data-pane]` added temporarily for
// the measurement only (see the task report for the exact steps):
//   HOME sessions pane:     {left: 0,     right: 355.5, width: 355.5, bottom: 550}
//   HOME detail pane:       {left: 355.5, right: 790,   width: 434.5, bottom: 550}
//   SETTINGS sessions pane: {left: 0,     right: 237,   width: 237,   bottom: 550}
//   SETTINGS detail pane:   {left: 237,   right: 790,   width: 553,   bottom: 550}
// 355.5 = 45% of 790, 434.5 = 55% of 790, 237 = 30% of 790 (rounded down by
// the browser), 553 = 70% of 790. These must be bit-for-bit unchanged after
// this task's change, since the popup's own styles are untouched.
const CONTROL = {
  home: {
    sessions: { left: 0, right: 355.5, width: 355.5, bottom: 550 },
    detail: { left: 355.5, right: 790, width: 434.5, bottom: 550 },
  },
  settings: {
    sessions: { left: 0, right: 237, width: 237, bottom: 550 },
    detail: { left: 237, right: 790, width: 553, bottom: 550 },
  },
};

async function paneBox(page: Page, pane: 'sessions' | 'detail') {
  return page.evaluate((p: string) => {
    const el = document.querySelector(`[data-pane="${p}"]`);
    if (!el) throw new Error(`no [data-pane="${p}"] element`);
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, bottom: r.bottom };
  }, pane);
}

async function seedAndOpen(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  viewport: { width: number; height: number },
  path: string
): Promise<Page> {
  const session = buildSession({ isSelected: true });
  await seedSessions(context, {
    lastModified: 1,
    selectedTabGroupId: session.tabGroupId,
    tabGroups: [session],
  });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  // Barrier: goto resolves before React mounts. "Sort sessions" is the
  // header control every home-view test above waits on; it only exists once
  // the app has rendered.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

test('tab view at 1280x800: the sessions pane is 356px and the detail pane fills the rest', async ({
  context,
  extensionId,
}) => {
  // KAN-280 O5. Folded by default, there is no detail pane to measure; side
  // by side, it fills what the sessions pane and Open now leave.
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await seedAndOpen(
    context,
    extensionId,
    TAB_VIEWPORT,
    'index.html?view=tab'
  );

  const sessions = await paneBox(page, 'sessions');
  const detail = await paneBox(page, 'detail');

  expect(sessions.width).toBeGreaterThanOrEqual(355);
  expect(sessions.width).toBeLessThanOrEqual(357);

  // KAN-280 O1: Open now's column is 340px below 1600px wide.
  const expectedDetailWidth = TAB_VIEWPORT.width - 356 - 340;
  expect(detail.width).toBeGreaterThanOrEqual(expectedDetailWidth - 2);
  expect(detail.width).toBeLessThanOrEqual(expectedDetailWidth + 2);

  expect(detail.bottom).toBeGreaterThanOrEqual(TAB_VIEWPORT.height - 2);
  expect(detail.bottom).toBeLessThanOrEqual(TAB_VIEWPORT.height + 2);

  // Headless Playwright hides scrollbars (--hide-scrollbars, KAN-188), so a
  // visible scrollbar in a real browser could shave a few px off these
  // widths without this assertion moving. The layout itself does not depend
  // on that: the grid's columns are fixed/fr tracks, not measured against
  // content.
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );
  expect(scrollWidth).toBeLessThanOrEqual(TAB_VIEWPORT.width);
});

test('tab view settings: the sessions pane is 238px', async ({
  context,
  extensionId,
}) => {
  const page = await seedAndOpen(
    context,
    extensionId,
    TAB_VIEWPORT,
    'index.html?view=tab'
  );
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Themes').waitFor();

  const sessions = await paneBox(page, 'sessions');
  expect(sessions.width).toBeGreaterThanOrEqual(237);
  expect(sessions.width).toBeLessThanOrEqual(239);
});

test('CONTROL: popup at 790x550 keeps its current pane widths, home view', async ({
  context,
  extensionId,
}) => {
  const page = await seedAndOpen(
    context,
    extensionId,
    POPUP_VIEWPORT,
    'index.html'
  );

  const sessions = await paneBox(page, 'sessions');
  const detail = await paneBox(page, 'detail');

  expect(sessions).toEqual(CONTROL.home.sessions);
  expect(detail).toEqual(CONTROL.home.detail);
});

test('CONTROL: popup at 790x550 keeps its current pane widths, settings view', async ({
  context,
  extensionId,
}) => {
  const page = await seedAndOpen(
    context,
    extensionId,
    POPUP_VIEWPORT,
    'index.html'
  );
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Themes').waitFor();

  const sessions = await paneBox(page, 'sessions');
  const detail = await paneBox(page, 'detail');

  expect(sessions).toEqual(CONTROL.settings.sessions);
  expect(detail).toEqual(CONTROL.settings.detail);
});
