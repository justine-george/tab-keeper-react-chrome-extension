import type { Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { boxOf, pickUp } from './fixtures/sessionDrag';
import { CARD } from './fixtures/betweenSessions';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  strip,
  topOf,
} from './fixtures/liveWindows';
import { twoFrames } from './fixtures/onboarding';
import {
  FULL_RUN,
  card,
  cardAt,
  cardButton,
  centreOf,
  hitAt,
  landedAt,
  nextTo,
  openRunFromHelp,
  storedRun,
} from './fixtures/run';

// Round 2 of KAN-1023: the full view's drag step is something to try. A tab
// from the session onto a live window opens there; a live tab into the
// session saves a copy; each ticks in the card. Windows stay put: one let go
// over Currently open would open in front of the tour. The button is there
// all along, as a keyboard can't drag: Skip until a drag ticks, then Next.
// Skip tutorial is not on this card (round 4).

const ticked = (page: Page) =>
  card(page).locator('[data-coach-tick][data-done]');
const windowCount = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.windows.getAll()).length);

// The first saved tab row in the session on screen: not a window's, not a group's.
const savedTab = (page: Page) =>
  page
    .locator(
      '[data-pane="detail"] [data-drag-row-id]:not([data-drag-row-id^="group:"]):not(:has([data-window-drag-handle]))'
    )
    .first();

async function toDragStep(page: Page): Promise<void> {
  await nextTo(page, 2);
  await nextTo(page, 3);
  await cardButton(page, 'Use an example').click();
  await expect(cardAt(page, 4)).toBeVisible();
  for (const step of [5, 6, 7, 8, 9]) await nextTo(page, step);
  await landedAt(page, 9);
}

test('step 9: a tab dragged each way opens or saves, and ticks its line; Skip before either, Next after', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['Live A', 'Live B']);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  await expect(card(page)).toContainText(
    'Try it: drag a tab between this session and Currently open.'
  );
  await expect(card(page).getByRole('listitem')).toHaveText([
    /Left to right: onto a window in Currently open, to open it there$/,
    /Right to left: from Currently open into this session, to save a copy$/,
  ]);
  await expect(ticked(page)).toHaveCount(0);
  await expect(cardButton(page, 'Skip')).toBeEnabled();
  await expect(cardButton(page, 'Next')).toHaveCount(0);
  await expect(cardButton(page, 'Skip tutorial')).toHaveCount(0);
  // Both are live: neither is held still.
  const tab = savedTab(page);
  expect(await hitAt(page, ...(await centreOf(tab)))).not.toMatch(
    /^(dim|still)$/
  );
  await expect(liveRow(page, live.idOf('Live B'))).toBeVisible();
  expect(
    await hitAt(page, ...(await centreOf(liveRow(page, live.idOf('Live B')))))
  ).not.toMatch(/^(dim|still)$/);

  // Left to right: the saved tab opens in the live window, before Live B.
  const url = await tab.evaluate(
    (row) => row.querySelector('a[href]')?.getAttribute('href') ?? null
  );
  await pickUp(page, tab);
  await carryTo(page, await topOf(liveRow(page, live.idOf('Live B'))));
  await page.mouse.up();
  await expect
    .poll(async () => (await strip(worker, live.windowId)).length)
    .toBe(3);
  if (url !== null) {
    expect((await strip(worker, live.windowId))[1].url).toBe(url);
  }
  await expect(ticked(page)).toHaveCount(1);
  await expect(
    card(page).getByRole('listitem').first().getByRole('img', { name: 'Done' })
  ).toBeVisible();
  await expect(cardButton(page, 'Next')).toBeEnabled();
  await expect(cardButton(page, 'Skip')).toHaveCount(0);

  // Right to left: Live A saved into the session, as a copy.
  const a = await boxOf(liveRow(page, live.idOf('Live A')));
  await page.mouse.move(a.x + Math.min(60, a.width / 2), a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    a.x + Math.min(60, a.width / 2),
    a.y + a.height / 2 + 10,
    { steps: 3 }
  );
  const pane = await boxOf(page.locator('[data-pane="open-now"]'));
  await page.mouse.move(pane.x - 40, a.y + a.height / 2 + 10, { steps: 6 });
  await expect(page.locator(CARD)).toHaveCount(1);
  const target = await boxOf(savedTab(page));
  await page.mouse.move(target.x + 60, target.y + target.height * 0.25, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(
    page.locator('[data-pane="detail"]').getByText('Live A', { exact: true })
  ).toBeVisible();
  await expect(ticked(page)).toHaveCount(2);
  // A copy: Live A is still open.
  expect((await strip(worker, live.windowId)).map((t) => t.url)).toContain(
    dataUrl('Live A')
  );
  await expect(cardAt(page, 9)).toBeVisible();
  await nextTo(page, 10);
});

test('step 9: a window, saved or live, is not carried out: nothing opens in front of the tour', async ({
  context,
  extensionId,
  serviceWorker: worker,
}) => {
  const live = await openLiveWindow(worker, ['Live A']);
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  const windows = await windowCount(worker);
  const pane = await boxOf(page.locator('[data-pane="open-now"]'));

  // A saved window's header, carried over Currently open.
  await pickUp(
    page,
    page.locator('[data-pane="detail"] [data-window-drag-handle]').first()
  );
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2, {
    steps: 20,
  });
  await expect(page.locator(CARD)).toHaveCount(0);
  await page.mouse.up();

  // A live window's header, carried over the session.
  const handle = page.locator(
    `[data-open-window-id="${live.windowId}"] [data-open-window-drag-handle]`
  );
  const h = await boxOf(handle);
  await page.mouse.move(h.x + Math.min(40, h.width / 2), h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(pane.x - 200, h.y + h.height / 2, { steps: 20 });
  await expect(page.locator(CARD)).toHaveCount(0);
  await page.mouse.up();

  await twoFrames(page);
  expect(await windowCount(worker)).toBe(windows);
  await expect(card(page).locator('[data-coach-tick][data-done]')).toHaveCount(
    0
  );
  await expect(cardAt(page, 9)).toBeVisible();
});

test('step 9: Skip goes on to the pin card, not out of the tour; Esc still ends it', async ({
  context,
  extensionId,
}) => {
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  await toDragStep(page);
  await cardButton(page, 'Skip').click();
  await expect(cardAt(page, 10)).toBeVisible();
  expect(await storedRun(page)).toMatchObject({ step: 10, ended: null });
  await cardButton(page, 'Back').click();
  await expect(cardAt(page, 9)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'skipped' });
});
