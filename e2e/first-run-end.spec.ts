import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { RUN_FINISHED, seedSettings } from './fixtures/seed';
import { platformSays } from './fixtures/platform';
import { stubToolbarPin } from './fixtures/toolbarPin';
import {
  FULL,
  openPage,
  storedSettings,
  twoFrames,
} from './fixtures/onboarding';
import {
  FULL_RUN,
  cardAt,
  cardButton,
  closeReplayNote,
  landedAt,
  replayNote,
  runCheck,
  storedRun,
  walkFullRunToLastStep,
} from './fixtures/run';

// §3's ending on the real build: setup, then the pin guide while unpinned.

const SETUP = 'Make Tab Keeper yours';
const GUIDE = 'Pin Tab Keeper to your toolbar';

const dialogNamed = (page: Page, name: string) =>
  page.getByRole('dialog', { name, exact: true });

// The link, not the ✕: both are named "Skip setup".
const skipSetup = (page: Page) =>
  dialogNamed(page, SETUP).getByText('Skip setup', { exact: true });

// Names every dialog that opens from now on, so a dialog that never opens is observed, not assumed.
async function watchDialogs(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    const nameOf = (dialog: Element) => {
      const id = dialog.getAttribute('aria-labelledby');
      const label = id === null ? null : document.getElementById(id);
      return label?.textContent ?? dialog.getAttribute('aria-label') ?? '';
    };
    new MutationObserver(() => {
      for (const dialog of document.querySelectorAll('dialog[open]')) {
        const name = nameOf(dialog);
        if (!seen.includes(name)) seen.push(name);
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    Object.defineProperty(window, '__dialogsSeen', { value: seen });
  });
  return async () => {
    await twoFrames(page);
    return page.evaluate(() => {
      const seen: unknown = Reflect.get(window, '__dialogsSeen');
      return Array.isArray(seen) ? seen.map(String) : [];
    });
  };
}

// A full-view run at its first card, which this open resumes ahead of the queue's setup and pin guide.
async function openRunningFullView(
  context: BrowserContext,
  extensionId: string,
  pinned: boolean,
  step = 1
): Promise<Page> {
  await stubToolbarPin(context, { pinned });
  await seedSettings(context, {
    isPinGuideDismissed: false,
    firstRun: { ...RUN_FINISHED, step, ended: null },
  });
  const page = await openPage(context, extensionId, FULL_RUN.path, FULL);
  await runCheck(page, 'resumed');
  await expect(cardAt(page, step)).toBeVisible();
  return page;
}

test.beforeEach(async ({ context }) => {
  await seedSettings(context, { isPinGuideDismissed: false });
});

test('Not now at step 9: setup, then on Skip setup the pin guide', async ({
  context,
  extensionId,
}) => {
  const page = await openRunningFullView(context, extensionId, false);
  const seen = await watchDialogs(page);
  await walkFullRunToLastStep(page);
  await cardButton(page, 'Not now').click();
  // KAN-499. The note first, and setup only once it closes.
  await expect(replayNote(page)).toBeVisible();
  await expect(dialogNamed(page, SETUP)).toHaveCount(0);
  await closeReplayNote(page);
  await expect(dialogNamed(page, SETUP)).toBeVisible();
  await expect(dialogNamed(page, GUIDE)).toHaveCount(0);
  await skipSetup(page).click();
  await expect(dialogNamed(page, GUIDE)).toBeVisible();
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'finished' });
  expect((await storedSettings(page)).setupState).toBe('done');
  expect(await seen()).toEqual([SETUP, GUIDE]);
});

test('pinned: setup, and nothing after it', async ({
  context,
  extensionId,
}) => {
  const page = await openRunningFullView(context, extensionId, true);
  const seen = await watchDialogs(page);
  await walkFullRunToLastStep(page);
  await cardButton(page, 'Pin this tab').click();
  await closeReplayNote(page);
  await expect(dialogNamed(page, SETUP)).toBeVisible();
  await skipSetup(page).click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'finished' });
  // The control is the setup it did see, and the unpinned test above that saw the guide too.
  expect(await seen()).toEqual([SETUP]);
});

test('Skip tutorial: the note, and nothing opens after it (R8, KAN-499)', async ({
  context,
  extensionId,
}) => {
  // Unpinned, so a wrongly chained pin guide would draw.
  const page = await openRunningFullView(context, extensionId, false);
  const seen = await watchDialogs(page);
  await cardButton(page, 'Skip tutorial').click();
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'skipped' });
  await closeReplayNote(page);
  expect(await seen()).toEqual([]);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  expect((await storedSettings(page)).setupState).toBe('none');
});

// KAN-563: a run resumed at step 9 draws its card before Chrome has said the platform; no drawn frame points anywhere but the aim.
for (const [os, aim] of [
  ['mac', 140],
  ['win', 88],
] as const) {
  test(`step 9 resumed (${os}): every drawn frame's notch points at ${aim}px`, async ({
    context,
    extensionId,
  }) => {
    await platformSays(context, os);
    // Each frame the card is drawn free, its notch tip from layout (the glide's transform moves card and notch together).
    await context.addInitScript(() => {
      const tips: number[] = [];
      Object.defineProperty(window, '__notchTips', { value: tips });
      const read = () => {
        const mark = document.querySelector<HTMLElement>('[data-coach-mark]');
        const notch = mark?.querySelector<HTMLElement>('[data-coach-notch]');
        if (
          mark &&
          notch &&
          !mark.hasAttribute('aria-hidden') &&
          mark.getAttribute('data-coach-side') === 'free'
        ) {
          const border = parseFloat(getComputedStyle(mark).borderLeftWidth);
          tips.push(
            parseFloat(mark.style.left) +
              border +
              parseFloat(notch.style.left) +
              notch.offsetWidth / 2
          );
        }
        requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });
    const page = await openRunningFullView(context, extensionId, false, 9);
    await landedAt(page, 9);
    const tips = await page.evaluate((): unknown =>
      Reflect.get(window, '__notchTips')
    );
    if (!Array.isArray(tips)) throw new Error('no notch record');
    expect(tips.length).toBeGreaterThan(0);
    // One tip only, 1px past the aim: the notch is drawn inside the card's border.
    expect([...new Set(tips)]).toEqual([aim + 1]);
  });
}

// §2: Help's Run setup again behaves as today, so no guide follows it.
for (const how of ['Skip setup', 'Done'] as const) {
  test(`Help, Run setup again, ${how}: no pin guide while unpinned and undismissed`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: true });
    const page = await openPage(context, extensionId, FULL_RUN.path, FULL);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.evaluate(() => Reflect.get(window, '__tabKeeperSetPin')(false));
    const seen = await watchDialogs(page);
    await page
      .locator('[data-help]')
      .getByRole('button', { name: 'Run setup again', exact: true })
      .click();
    await expect(dialogNamed(page, SETUP)).toBeVisible();
    if (how === 'Skip setup') await skipSetup(page).click();
    else {
      for (let n = 0; n < 4; n++)
        await dialogNamed(page, SETUP)
          .getByRole('button', { name: 'Next', exact: true })
          .click();
      await dialogNamed(page, SETUP)
        .getByRole('button', { name: 'Done', exact: true })
        .click();
    }
    await expect(page.locator('dialog:modal')).toHaveCount(0);
    expect((await storedSettings(page)).setupState).toBe('done');
    // The control is the run's end above: the same observer sees [SETUP, GUIDE] there.
    expect(await seen()).toEqual([SETUP]);
  });
}

// KAN-457: step 9 is one row at the default size, and its notch points up at the tab strip.
// KAN-563: at the first tab on a Mac (140), elsewhere where it always was (88).
for (const [os, aim] of [
  ['mac', 140],
  ['win', 88],
] as const) {
  test(`step 9 (${os}): Not now left, Back and Pin this tab right, one row; the notch up at ${aim}px`, async ({
    context,
    extensionId,
  }) => {
    await platformSays(context, os);
    const page = await openRunningFullView(context, extensionId, false);
    await walkFullRunToLastStep(page);
    const card = cardAt(page, 9);
    // KAN-569: the step changes a frame before the card moves; measure once it sits free and has glided there.
    await expect(card).toHaveAttribute('data-coach-side', 'free');
    await landedAt(page, 9);
    const geometry = await card.evaluate((el) => {
      const box = (e: Element | null) => {
        if (e === null) throw new Error('missing');
        return e.getBoundingClientRect();
      };
      const button = (name: string) =>
        box(
          [...el.querySelectorAll('button')].find(
            (b) => b.textContent === name
          ) ?? null
        );
      const notch = box(el.querySelector('[data-coach-notch]'));
      const card = box(el);
      return {
        width: card.width,
        tops: ['Not now', 'Back', 'Pin this tab'].map((n) => button(n).top),
        notNowRight: button('Not now').right,
        backLeft: button('Back').left,
        notch: {
          tip: notch.left + notch.width / 2,
          bottom: notch.bottom - card.top,
          top: notch.top,
        },
      };
    });
    expect(geometry.width).toBe(400);
    const [notNow, back, pin] = geometry.tops;
    expect(Math.abs(notNow - back)).toBeLessThan(1);
    expect(Math.abs(back - pin)).toBeLessThan(1);
    expect(geometry.notNowRight).toBeLessThan(geometry.backLeft);
    // Above the card, its tip on the aim (drawn inside the card's 1px border), and still inside the page.
    expect(geometry.notch.bottom).toBeLessThanOrEqual(0);
    expect(Math.abs(geometry.notch.tip - aim)).toBeLessThanOrEqual(1);
    expect(geometry.notch.top).toBeGreaterThanOrEqual(0);
  });
}
