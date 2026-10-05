import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettingsIfAbsent } from './fixtures/seed';
import {
  FULL_VIEW_PATH,
  THEMES,
  openFullView,
  openPage,
  openPopup,
  pageGround,
  storedSettings,
} from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';
import { boxOf } from './fixtures/savedWindows';
import {
  OPEN_BLOCKED,
  SAMPLE_TITLE,
  TOUR_VIEWS,
  coach,
  coachAt,
  coachButton,
  coachSeen,
  dragFirstTabDown,
  expectAimedAndClear,
  keepSavedSessionShown,
  nextTo,
  peekSample,
  startTour,
  storedTitles,
  storedTour,
  tabCount,
  tabCountsOver,
  toastsSeen,
  tourCheck,
  twoFrames,
  watchCoachMarks,
  watchToasts,
} from './fixtures/tour';
import { COACH } from '../src/components/tour/coachMarkPlacement';

// KAN-413. The sample tour on the real build, in the popup and the full view.

const FULL_CASE = TOUR_VIEWS[1];
const FIRST_TAB = 'Open in new tab: Flights to Lisbon - Google Flights';
const SAMPLE_TABS = 5;

// From now on in this page: whether Switch's confirmation ever opened.
const watchFocusConfirm = (page: Page) =>
  page.evaluate(() => {
    const seen = { opened: false };
    Object.defineProperty(globalThis, '__focusConfirmSeen', { value: seen });
    new MutationObserver(() => {
      if (
        document.querySelector(
          'dialog[open][aria-labelledby="focus-confirm-title"]'
        ) !== null
      ) {
        seen.opened = true;
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
const focusConfirmSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__focusConfirmSeen');
    return typeof seen === 'object' && seen !== null
      ? Reflect.get(seen, 'opened') === true
      : null;
  });

for (const view of TOUR_VIEWS) {
  test.describe(view.name, () => {
    test('the whole tour by doing every step; the menu’s Delete ends it with no toast', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      await watchToasts(page);
      expect(await storedTour(page)).toMatchObject({
        step: 1,
        view: view.view,
      });

      await page
        .getByRole('button', { name: 'Collapse: Getting there', exact: true })
        .click();
      await expect(coachAt(page, 2)).toBeVisible();

      await nextTo(page, 3);

      await page
        .getByRole('button', {
          name: `Rename session: ${SAMPLE_TITLE}`,
          exact: true,
        })
        .click();
      const field = page.locator(
        '[data-pane="detail"] input[data-tour-anchor="title"]'
      );
      await field.fill('Lisbon in May');
      await field.press('Enter');
      await expect(coachAt(page, 4)).toBeVisible();
      // The window folded at step 1 opens again, so step 4 points at its first tab.
      await expect(
        page.getByRole('button', {
          name: 'Collapse: Getting there',
          exact: true,
        })
      ).toBeVisible();

      await dragFirstTabDown(page);
      await expect(coachAt(page, 5)).toBeVisible();

      const del = page.getByRole('menuitem', {
        name: 'Delete session',
        exact: true,
      });
      await expect(del).toBeVisible();
      await del.click();

      await expect(coach(page)).toHaveCount(0);
      await expect.poll(() => storedTitles(page)).toEqual([]);
      expect(await storedTour(page)).toBeNull();
      await twoFrames(page);
      expect(await toastsSeen(page)).toEqual([]);
      expect((await storedSettings(page)).lastValueMomentTime ?? '').toBe('');
    });

    test('the whole tour by Next only: each mark aimed at its anchor, clear of it, on its side; Finish removes the sample', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      for (const step of [1, 2, 3, 4, 5] as const) {
        await expect(coachAt(page, step)).toBeVisible();
        await expectAimedAndClear(page, view, step);
        if (step < 5) await nextTo(page, step + 1);
      }
      await expect(
        page.getByRole('menuitem', { name: 'Delete session', exact: true })
      ).toBeVisible();
      await coachButton(page, 'Finish').click();
      await expect(coach(page)).toHaveCount(0);
      await expect.poll(() => storedTitles(page)).toEqual([]);
      expect(await storedTour(page)).toBeNull();
    });

    test('Skip tutorial at step 2 removes the sample', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      await nextTo(page, 2);
      await coachButton(page, 'Skip tutorial').click();
      await expect(coach(page)).toHaveCount(0);
      await expect.poll(() => storedTitles(page)).toEqual([]);
      expect(await storedTour(page)).toBeNull();
    });

    test('Esc ends the tour as Skip does', async ({ context, extensionId }) => {
      const page = await startTour(context, extensionId, view);
      await page.keyboard.press('Escape');
      await expect(coach(page)).toHaveCount(0);
      await expect.poll(() => storedTitles(page)).toEqual([]);
      expect(await storedTour(page)).toBeNull();
    });

    test('Undo just after the start ends the tour', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(coach(page)).toHaveCount(0);
      await expect.poll(() => storedTour(page)).toBeNull();
      expect(await storedTitles(page)).toEqual([]);
    });

    // Never drawn, watched from document start; and the cleanup is no undo step.
    test('closing the page mid-tour: the next open removes the sample, draws no mark, and ⌘Z brings nothing back', async ({
      context,
      extensionId,
    }) => {
      await watchCoachMarks(context);
      const page = await startTour(context, extensionId, view);
      await nextTo(page, 2);
      expect(await coachSeen(page)).toEqual(['1', '2']);
      // A full view opens folded; unfolded for good, the next one draws the sample as it loads.
      if (view.view === 'full') await keepSavedSessionShown(page);
      await page.close();
      const next = await openPage(
        context,
        extensionId,
        view.path,
        view.viewport
      );
      await tourCheck(next, 'ended');
      await twoFrames(next);
      expect(await coachSeen(next)).toEqual([]);
      expect(await storedTitles(next)).toEqual([]);
      expect(await storedTour(next)).toBeNull();
      await next.keyboard.press('ControlOrMeta+z');
      await twoFrames(next);
      expect(await storedTitles(next)).toEqual([]);
    });

    // CONTROL for the ⌘Z above: after the user's own end, ⌘Z does bring it back.
    test('⌘Z right after Finish brings the sample back as an ordinary session', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      for (const step of [2, 3, 4, 5]) await nextTo(page, step);
      await coachButton(page, 'Finish').click();
      await expect.poll(() => storedTitles(page)).toEqual([]);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => storedTitles(page)).toEqual([SAMPLE_TITLE]);
      expect(await storedTour(page)).toBeNull();
      await twoFrames(page);
      await expect(coach(page)).toHaveCount(0);
    });

    // Finish pressed at human speed; the mark must not move between press and release.
    test('Finish pressed and released two frames apart ends the tour', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      for (const step of [2, 3, 4, 5]) await nextTo(page, step);
      await expect(
        page.getByRole('menuitem', { name: 'Delete session', exact: true })
      ).toBeVisible();
      const box = await boxOf(coachButton(page, 'Finish'));
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await twoFrames(page);
      await page.mouse.up();
      await expect(coach(page)).toHaveCount(0);
      await expect.poll(() => storedTitles(page)).toEqual([]);
      expect(await storedTour(page)).toBeNull();
    });

    // The drawn rows, not the box that scrolls them.
    test('step 1’s ring wraps the window rows, not the box that scrolls them', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      await expect
        .poll(() =>
          page.evaluate((inset) => {
            const ring = document.querySelector('[data-coach-ring]');
            const anchor = document.querySelector(
              '[data-pane="detail"] [data-tour-anchor="windows"]'
            );
            const scroller = anchor?.parentElement;
            if (!ring || !anchor || !scroller) return 'missing';
            const rows = [...anchor.querySelectorAll('[data-drag-row-id]')]
              .map((row) => row.getBoundingClientRect())
              .filter((b) => b.width > 0 && b.height > 0);
            const r = ring.getBoundingClientRect();
            const top = Math.min(...rows.map((b) => b.top));
            const bottom = Math.max(...rows.map((b) => b.bottom));
            // 2/64px: a LayoutUnit each side of the inline px the ring is placed at.
            const near = (a: number, b: number) => Math.abs(a - b) <= 2 / 64;
            const box = scroller.getBoundingClientRect();
            return near(r.top + inset, top) &&
              near(r.bottom - inset, bottom) &&
              r.height - 2 * inset < box.height
              ? 'ok'
              : JSON.stringify({ ring: r, top, bottom, box });
          }, COACH.RING_INSET)
        )
        .toBe('ok');
    });

    // CONTROL: after Finish and ⌘Z the same tab click opens a tab, and the row's Open and Switch work.
    test('the sample’s opens are dimmed and open nothing during the tour, while a tab still drags at step 4', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await startTour(context, extensionId, view);
      await nextTo(page, 2);
      const open = page
        .locator('[data-pane="detail"] [data-tour-anchor="open"]')
        .getByRole('button', { name: OPEN_BLOCKED, exact: true });
      await expect(open).toHaveAttribute('aria-disabled', 'true');
      await expect(open).toHaveCSS('opacity', '0.3');
      // The saved list row's Open, and Switch where drawn; by key, as the popup's mark sits over the list.
      const sessions = page.locator('[data-pane="sessions"]');
      const rowOpens = sessions
        .getByRole('button', { name: 'Open', exact: true })
        .or(sessions.getByRole('button', { name: 'Switch', exact: true }));
      await expect(rowOpens).toHaveCount(view.view === 'popup' ? 2 : 1);
      await watchFocusConfirm(page);
      const rowBefore = await tabCount(serviceWorker);
      const rowDuring = tabCountsOver(serviceWorker, 1000);
      for (const button of await rowOpens.all()) {
        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await expect(button).toHaveAttribute('title', OPEN_BLOCKED);
        await expect(button).toHaveCSS('filter', 'opacity(0.3)');
        await button.focus();
        await button.press('Enter');
      }
      expect(new Set(await rowDuring)).toEqual(new Set([rowBefore]));
      expect(await focusConfirmSeen(page)).toBe(false);
      for (const step of [3, 4]) await nextTo(page, step);

      const tab = page
        .locator('[data-pane="detail"]')
        .getByRole('button', { name: FIRST_TAB, exact: true });
      await expect(tab).toHaveAttribute('title', OPEN_BLOCKED);
      const before = await tabCount(serviceWorker);
      const during = tabCountsOver(serviceWorker, 1000);
      // A real click: Playwright waits forever for an aria-disabled element to become enabled.
      await tab.click({ force: true });
      expect(new Set(await during)).toEqual(new Set([before]));
      await expect(coachAt(page, 4)).toBeVisible();

      await dragFirstTabDown(page);
      await expect(coachAt(page, 5)).toBeVisible();

      await coachButton(page, 'Finish').click();
      await expect.poll(() => storedTitles(page)).toEqual([]);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => storedTitles(page)).toEqual([SAMPLE_TITLE]);
      await expect(tab).not.toHaveAttribute('title', OPEN_BLOCKED);
      const after = tabCountsOver(serviceWorker, 1000);
      await tab.click();
      expect(Math.max(...(await after))).toBe(before + 1);

      const rowOpen = sessions.getByRole('button', {
        name: 'Open',
        exact: true,
      });
      await expect(rowOpen).toHaveCSS('filter', 'none');
      await expect(rowOpen).not.toHaveAttribute('title', OPEN_BLOCKED);
      const openedFrom = await tabCount(serviceWorker);
      const opened = tabCountsOver(serviceWorker, 1500);
      await rowOpen.focus();
      await rowOpen.press('Enter');
      expect(Math.max(...(await opened))).toBe(openedFrom + SAMPLE_TABS);
      if (view.view === 'popup') {
        const rowSwitch = sessions.getByRole('button', {
          name: 'Switch',
          exact: true,
        });
        await rowSwitch.focus();
        await rowSwitch.press('Enter');
        await expect.poll(() => focusConfirmSeen(page)).toBe(true);
      }
    });

    // The toast watch's CONTROL, in this view.
    test('a delete from the list ends the tour quietly, and its own toast shows', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      await watchToasts(page);
      // By key: in the popup the step-1 mark sits over the session list.
      const del = page
        .locator('[data-pane="sessions"]')
        .getByRole('button', { name: 'Delete', exact: true })
        .first();
      await del.focus();
      await del.press('Enter');
      await expect(coach(page)).toHaveCount(0);
      await expect.poll(() => storedTour(page)).toBeNull();
      await expect
        .poll(async () =>
          (await toastsSeen(page)).some((t) => t.includes('Session deleted.'))
        )
        .toBe(true);
    });

    // The mark, and the dim with it, are drawn only while the sample is the session on screen.
    test('a search or Settings hides the mark and the dim, and they come back on the sample', async ({
      context,
      extensionId,
    }) => {
      const page = await startTour(context, extensionId, view);
      const dim = page.locator('[data-coach-dim]');
      const hidden = async () => {
        await expect(coach(page)).toHaveCount(0);
        await expect(dim).toHaveCount(0);
      };
      const back = async () => {
        await expect(coachAt(page, 1)).toBeVisible();
        await expect(dim).toHaveCount(1);
      };
      await back();
      const search = page.locator('[data-saved-search] input');
      await search.fill('zzz');
      await hidden();
      await search.fill('');
      await back();
      // A search the sample matches hides it too: Open and ⋮ are hidden while searching.
      await search.fill('Weekend');
      await hidden();
      await search.fill('');
      await back();
      // By key: the dim takes a press on Settings.
      const settings = page.getByRole('button', {
        name: 'Settings',
        exact: true,
      });
      await settings.focus();
      await settings.press('Enter');
      await hidden();
      await page.getByRole('button', { name: 'Go back', exact: true }).click();
      await back();
      expect(await storedTour(page)).toMatchObject({ step: 1 });
    });
  });
}

// The rows overflow a 380px-tall full view at a 20px root (Chrome's Large font size).
async function shortLargeTour(context: BrowserContext, extensionId: string) {
  const page = await openPage(context, extensionId, FULL_VIEW_PATH, {
    width: 1280,
    height: 380,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px';
  });
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
    )
    .toBe('20px');
  await page
    .getByRole('button', { name: 'Try it with an example', exact: true })
    .click();
  await expect(coachAt(page, 1)).toBeVisible();
  return page;
}

// Step 1's ring against the windows scroll box and the rows inside it.
const measureRing = (page: Page) =>
  page.evaluate(() => {
    const ring = document.querySelector('[data-coach-ring]');
    const anchor = document.querySelector(
      '[data-pane="detail"] [data-tour-anchor="windows"]'
    );
    const scroller = anchor?.parentElement;
    if (!ring || !anchor || !scroller) return null;
    const r = ring.getBoundingClientRect();
    const top = scroller.getBoundingClientRect().top + scroller.clientTop;
    const rows = [...anchor.querySelectorAll('[data-drag-row-id]')]
      .map((row) => row.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    return {
      ringTop: r.top,
      ringBottom: r.bottom,
      boxTop: top,
      boxBottom: top + scroller.clientHeight,
      rowsTop: Math.min(...rows.map((b) => b.top)),
      rowsBottom: Math.max(...rows.map((b) => b.bottom)),
    };
  });
// 2/64px: a LayoutUnit each side of the inline px the ring is placed at.
const RING_SLACK = COACH.RING_INSET + 2 / 64;

test('full view, short window, Large font: as step 1 starts, its ring stops at the windows box’s bottom', async ({
  context,
  extensionId,
}) => {
  const page = await shortLargeTour(context, extensionId);
  // CONTROL: the rows themselves run past the box's bottom.
  await expect
    .poll(async () => {
      const m = await measureRing(page);
      return m !== null &&
        m.rowsBottom > m.boxBottom &&
        m.ringBottom <= m.boxBottom + RING_SLACK
        ? 'ok'
        : JSON.stringify(m);
    })
    .toBe('ok');
});

test('full view, short window, Large font: scrolled to the bottom, step 1’s ring starts at the windows box’s top', async ({
  context,
  extensionId,
}) => {
  const page = await shortLargeTour(context, extensionId);
  await page.evaluate(() => {
    const scroller = document.querySelector(
      '[data-pane="detail"] [data-tour-anchor="windows"]'
    )?.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  // CONTROL: the rows start above the box's top; the ring, a frame late, must first wrap their bottom.
  await expect
    .poll(async () => {
      const m = await measureRing(page);
      return m !== null &&
        m.rowsTop < m.boxTop &&
        m.rowsBottom <= m.boxBottom &&
        Math.abs(m.ringBottom - COACH.RING_INSET - m.rowsBottom) <= 2 / 64 &&
        m.ringTop >= m.boxTop - RING_SLACK
        ? 'ok'
        : JSON.stringify(m);
    })
    .toBe('ok');
  await expect(coachAt(page, 1)).toBeVisible();
});

test('full view: a reload mid-tour is an interruption too', async ({
  context,
  extensionId,
}) => {
  const page = await startTour(context, extensionId, FULL_CASE);
  await page.reload();
  await page.locator('[aria-label="Sort sessions"]').first().waitFor();
  await tourCheck(page, 'ended');
  expect(await storedTitles(page)).toEqual([]);
});

// Another page's tour is left to the page that runs it.
test('a tour running in the full view, then a popup opened: nothing is removed, and the popup draws no mark', async ({
  context,
  extensionId,
}) => {
  await watchCoachMarks(context);
  const full = await startTour(context, extensionId, FULL_CASE);
  const popup = await openPopup(context, extensionId);
  await tourCheck(popup, 'elsewhere');
  await expect(
    popup
      .locator('[data-pane="sessions"]')
      .getByText(SAMPLE_TITLE, { exact: true })
  ).toBeVisible();
  await twoFrames(popup);
  expect(await coachSeen(popup)).toEqual([]);
  // CONTROL: the same observer sees the running page's mark.
  expect(await coachSeen(full)).toContain('1');
  expect(await storedTour(popup)).toMatchObject({ step: 1, view: 'full' });
  await expect(coachAt(full, 1)).toBeVisible();
});

test('CONTROL: the full view closed first, the popup’s open removes the sample', async ({
  context,
  extensionId,
}) => {
  const full = await startTour(context, extensionId, FULL_CASE);
  await full.close();
  const popup = await openPopup(context, extensionId);
  await tourCheck(popup, 'ended');
  expect(await storedTitles(popup)).toEqual([]);
});

test('two full views: only the one that started shows the tour; the other, even reloaded, leaves it', async ({
  context,
  extensionId,
}) => {
  await watchCoachMarks(context);
  const first = await startTour(context, extensionId, FULL_CASE);
  const second = await openFullView(context, extensionId);
  await tourCheck(second, 'elsewhere');
  // The sample on screen in this page too, so only the tour's page decides the mark.
  await peekSample(second);
  await twoFrames(second);
  expect(await coachSeen(second)).toEqual([]);
  await second.reload();
  await second.locator('[aria-label="Sort sessions"]').first().waitFor();
  await tourCheck(second, 'elsewhere');
  await peekSample(second);
  await twoFrames(second);
  expect(await coachSeen(second)).toEqual([]);
  expect(await coachSeen(first)).toContain('1');
  await expect(coachAt(first, 1)).toBeVisible();
  expect(await storedTitles(first)).toEqual([SAMPLE_TITLE]);
});

test.describe('contrast', () => {
  test.use({ freshProfile: true });

  for (const view of TOUR_VIEWS) {
    for (const [theme, palette] of THEMES) {
      test(`${view.name}, ${theme}: steps 1 and 5 read at 4.5:1`, async ({
        context,
        extensionId,
      }) => {
        await seedSettingsIfAbsent(context, { theme });
        const page = await startTour(context, extensionId, view);
        expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
        await expectReadable(coach(page), `${theme} ${view.name} step 1`);
        for (const step of [2, 3, 4, 5]) await nextTo(page, step);
        await expectReadable(coach(page), `${theme} ${view.name} step 5`);
      });
    }
  }
});

// KAN-424: the longer step texts must fit the mark in the widest locales at a 24px root.
test.describe('long locale, 24px root', () => {
  test.use({ freshProfile: true });

  const NEXT = { en: 'Next', de: 'Weiter', ru: 'Далее' } as const;
  for (const view of TOUR_VIEWS) {
    for (const language of ['en', 'de', 'ru'] as const) {
      test(`${view.name}, ${language}: steps 1, 3 and 4 fit inside the mark and the window`, async ({
        context,
        extensionId,
      }) => {
        await seedSettingsIfAbsent(context, { language });
        // openPage waits on an English label, so the page is opened here.
        const page = await context.newPage();
        await page.setViewportSize(view.viewport);
        await page.goto(`chrome-extension://${extensionId}/${view.path}`);
        const example = page
          .locator('button', { hasText: /example|Beispiel|пример/i })
          .first();
        await example.waitFor();
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '24px';
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => getComputedStyle(document.documentElement).fontSize
            )
          )
          .toBe('24px');
        await twoFrames(page);
        await example.click();
        await expect(coachAt(page, 1)).toBeVisible();
        // CONTROL: the mark's own button reads in the language seeded.
        await expect(coachButton(page, NEXT[language])).toBeVisible();

        const fit = () =>
          page.evaluate(() => {
            const mark = document.querySelector(
              '[data-coach-mark]:not([aria-hidden])'
            );
            if (!mark) return null;
            const m = mark.getBoundingClientRect();
            const text = document
              .getElementById(mark.getAttribute('aria-labelledby') ?? '')
              ?.getBoundingClientRect();
            const foot = mark.querySelector('button')?.getBoundingClientRect();
            if (!text || !foot) return null;
            return {
              clipped: mark.scrollHeight - mark.clientHeight,
              inWindow:
                m.top >= 0 &&
                m.left >= 0 &&
                m.bottom <= innerHeight &&
                m.right <= innerWidth,
              textInsideAndAboveButtons:
                text.bottom <= m.bottom && text.bottom <= foot.top + 0.5,
            };
          });
        const seen: number[] = [];
        for (const step of [1, 2, 3, 4]) {
          if (step > 1) {
            await coachButton(page, NEXT[language]).click();
            await expect(coachAt(page, step)).toBeVisible();
          }
          if (step === 2) continue;
          await expect.poll(fit).toMatchObject({
            clipped: 0,
            inWindow: true,
            textInsideAndAboveButtons: true,
          });
          seen.push(step);
        }
        expect(seen).toEqual([1, 3, 4]);
      });
    }
  }
});
