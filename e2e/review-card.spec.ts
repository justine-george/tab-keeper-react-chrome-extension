import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import {
  FULL_VIEW_PATH,
  openFullView,
  openPage,
  openPopup,
  storedSettings,
} from './fixtures/onboarding';
import { pressOpen, saveRowSaveAll } from './fixtures/sessionActions';

// KAN-653 on the real build: the review card's asks, its gap and its close.
// Every seed passes isNeverAskAgainToRate: false, since a seeded profile
// starts as a user who said never (fixtures/seed.ts).

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ASKABLE = { isNeverAskAgainToRate: false, isAutoSync: false };

const card = (page: Page, title: string) =>
  page.getByRole('complementary', { name: title, exact: true });
const anyCard = (page: Page) => page.getByTestId('review-card');

// Long enough for the open's own ask and the 300ms settle, many times over.
const settleLong = (page: Page) => page.waitForTimeout(2000);

const TRIP = buildSession({ tabGroupId: 'trip', title: 'Trip planning' });

// From document start: whether the card's centre hits the card while it
// rises, and once it has risen. Recorded in the page, where the timing is
// the card's own, not the harness's round trip.
async function watchRise(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (window !== window.top) return;
    const hits: { rising?: boolean; risen?: boolean } = {};
    Object.defineProperty(globalThis, '__riseHits', { value: hits });
    const hitsCard = (el: Element) => {
      const box = el.getBoundingClientRect();
      const at = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      return at !== null && el.contains(at);
    };
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="review-card"]');
      if (el === null || hits.rising !== undefined) return;
      hits.rising = hitsCard(el);
      // Read a frame on: the card turns pointer input on as it re-renders.
      el.addEventListener('animationend', () => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            hits.risen = hitsCard(el);
          })
        );
      });
    }).observe(document, { subtree: true, childList: true });
  });
}
const riseHits = (page: Page) =>
  page.evaluate(() => {
    const hits: unknown = Reflect.get(globalThis, '__riseHits');
    return typeof hits === 'object' && hits !== null
      ? {
          rising: Reflect.get(hits, 'rising'),
          risen: Reflect.get(hits, 'risen'),
        }
      : null;
  });

test('popup, a day after install: the time card, and a press during its rise is not the card’s', async ({
  context,
  extensionId,
}) => {
  await watchRise(context);
  await seedSessions(context, buildContainer([TRIP]));
  await seedSettings(context, {
    ...ASKABLE,
    extensionInstalledTime: Date.now() - 25 * HOUR,
  });
  const page = await openPopup(context, extensionId);

  await expect(card(page, 'Thanks for using Tab Keeper')).toBeVisible({
    timeout: 1000,
  });
  await expect
    .poll(() => riseHits(page))
    .toEqual({ rising: false, risen: true });
  // Not a dialog: nothing behind it is blocked, and it took no focus.
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document
        .querySelector('[data-testid="review-card"]')!
        .contains(document.activeElement)
    )
  ).toBe(false);
  const stored = await storedSettings(page);
  expect(stored.isTimeAskDone).toBe(true);
  expect(typeof stored.lastReviewRequestTime).toBe('number');
});

test('popup, not yet a day: no card', async ({ context, extensionId }) => {
  await seedSessions(context, buildContainer([TRIP]));
  await seedSettings(context, {
    ...ASKABLE,
    extensionInstalledTime: Date.now() - 23 * HOUR,
  });
  const page = await openPopup(context, extensionId);
  await settleLong(page);
  await expect(anyCard(page)).toHaveCount(0);
});

test('full view, the first save: "Your first session is saved", 440px wide', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer([]));
  await seedSettings(context, ASKABLE);
  const page = await openFullView(context, extensionId);
  await expect(anyCard(page)).toHaveCount(0);

  await saveRowSaveAll(page).click();

  const first = card(page, 'Your first session is saved');
  await expect(first).toBeVisible();
  expect((await first.boundingBox())?.width).toBe(440);
});

test('the gap: a first save a day after the last ask shows nothing', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer([]));
  await seedSettings(context, {
    ...ASKABLE,
    lastReviewRequestTime: Date.now() - DAY,
  });
  const page = await openFullView(context, extensionId);

  await saveRowSaveAll(page).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            JSON.parse(localStorage.getItem('tabContainerData') ?? '{}')
          )
        ).tabGroups?.length
    )
    .toBe(1);
  await settleLong(page);
  await expect(anyCard(page)).toHaveCount(0);
});

test.describe('a popup restore asks on the next open', () => {
  // The real popup closes when the restored windows take focus. Here it is a
  // tab that stays, so it is told it lost focus, as the popup would have, and
  // closed by hand.
  const restoreAndClose = async (page: Page) => {
    await page.evaluate(() => {
      document.hasFocus = () => false;
    });
    await pressOpen(page);
    await expect
      .poll(async () => (await storedSettings(page)).pendingReviewAsk)
      .toMatchObject({ moment: { kind: 'restored' } });
    await page.close();
  };

  test('within 30 minutes: "Your tabs are back"', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer([TRIP]));
    await seedSettings(context, ASKABLE);
    await restoreAndClose(await openPopup(context, extensionId));

    const next = await openPopup(context, extensionId);
    await expect(card(next, 'Your tabs are back')).toBeVisible();
  });

  test('31 minutes on: no card', async ({ context, extensionId }) => {
    await seedSessions(context, buildContainer([TRIP]));
    await seedSettings(context, {
      ...ASKABLE,
      pendingReviewAsk: {
        moment: { kind: 'restored' },
        at: Date.now() - 31 * 60 * 1000,
      },
    });
    const page = await openPopup(context, extensionId);
    await settleLong(page);
    await expect(anyCard(page)).toHaveCount(0);
  });
});

// C3: the restored windows open over the full view, and the card waits for
// the person to come back to it. Playwright pins focus as it pins visibility
// (measured: document.hasFocus() stays true once the restored window opens),
// so the page is told focus left as the restore began, and told it came back
// with the focus event a return fires. The hide path is useReviewAskRelease's
// unit test.
test('a full-view restore asks when the full view gets focus back', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer([TRIP]));
  await seedSettings(context, ASKABLE);
  const page = await openFullView(context, extensionId);
  // The full view shows a row's actions once the row is selected.
  await page.getByRole('button', { name: /^Trip planning/ }).click();
  await page.evaluate(() => {
    document.hasFocus = () => false;
  });

  await pressOpen(page);
  await expect
    .poll(async () => (await storedSettings(page)).pendingReviewAsk)
    .toMatchObject({ moment: { kind: 'restored' } });
  await settleLong(page);
  await expect(anyCard(page)).toHaveCount(0);

  await page.bringToFront();
  await page.evaluate(() => {
    document.hasFocus = () => true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(card(page, 'Your tabs are back')).toBeVisible();
});

test('✕ closes it as Not now, and the gap keeps it away on reload', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer([TRIP]));
  await seedSettings(context, {
    ...ASKABLE,
    extensionInstalledTime: Date.now() - 2 * DAY,
  });
  const page = await openPopup(context, extensionId);
  const time = card(page, 'Thanks for using Tab Keeper');
  await expect(time).toBeVisible();
  // CONTROL: a first card offers no "never".
  await expect(
    time.getByRole('button', { name: 'Never ask again' })
  ).toHaveCount(0);

  await time.getByRole('button', { name: 'Not now', exact: true }).click();

  await expect(anyCard(page)).toHaveCount(0);
  expect((await storedSettings(page)).isSkippedUserReviewOnce).toBe(true);
  await page.reload();
  await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  await settleLong(page);
  await expect(anyCard(page)).toHaveCount(0);
});

// Review I2. Below 1100px Open now is a drawer on the right, over the panes.
// The card opens there too, and must not sit under it, its ✕ hidden.
test('a narrow full view: the card stays over the Open now drawer', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer([TRIP]));
  await seedSettings(context, {
    ...ASKABLE,
    extensionInstalledTime: Date.now() - 2 * DAY,
  });
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, {
    width: 1000,
    height: 800,
  });
  const time = card(page, 'Thanks for using Tab Keeper');
  await expect(time).toBeVisible();

  // Narrow, the saved session and Open now share a pane; with the session
  // shown, Open now is the drawer behind the rail's button.
  await page
    .getByRole('button', { name: 'Show the saved session', exact: true })
    .click();
  await page.getByRole('button', { name: /^Open now/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const close = time.getByRole('button', { name: 'Not now', exact: true });
  const box = (await close.boundingBox())!;
  const onTop = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('[data-testid="review-card"]') !=
      null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  );
  expect(onTop).toBe(true);
});
