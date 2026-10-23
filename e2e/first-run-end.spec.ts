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
  step = 1,
  settings: Record<string, unknown> = {}
): Promise<Page> {
  await stubToolbarPin(context, { pinned });
  await seedSettings(context, {
    isPinGuideDismissed: false,
    firstRun: { ...RUN_FINISHED, step, ended: null },
    ...settings,
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

// KAN-755: step 9 points at nothing, as the tab strip may be on top or down the side; it waits for no platform answer.
// CONTROL: the same recorder on step 1, which is anchored, sees its one notch.
const PLATFORMS = ['mac', 'win', 'never answers'] as const;
for (const [os, step, notches] of [
  ...PLATFORMS.map((os) => [os, 9, 0] as const),
  ['win', 1, 1] as const,
]) {
  test(`step ${step} resumed (${os}): every drawn frame has ${notches} notch${notches === 1 ? '' : 'es'}`, async ({
    context,
    extensionId,
  }) => {
    if (os === 'never answers') {
      await context.addInitScript(() => {
        const runtime = globalThis.chrome?.runtime;
        if (runtime) {
          Object.defineProperty(runtime, 'getPlatformInfo', {
            value: () => new Promise(() => {}),
            configurable: true,
          });
        }
      });
    } else await platformSays(context, os);
    // Each frame the card is drawn, how many notches it has and where it sits.
    await context.addInitScript(() => {
      const frames: string[] = [];
      Object.defineProperty(window, '__coachFrames', { value: frames });
      const read = () => {
        const mark = document.querySelector<HTMLElement>('[data-coach-mark]');
        if (mark && !mark.hasAttribute('aria-hidden')) {
          const n = mark.querySelectorAll('[data-coach-notch]').length;
          const side = mark.getAttribute('data-coach-side');
          frames.push(
            side === 'free'
              ? `${n} ${mark.style.left} ${mark.style.top}`
              : `${n}`
          );
        }
        requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });
    const page = await openRunningFullView(context, extensionId, false, step);
    await landedAt(page, step);
    const frames = await page.evaluate((): unknown =>
      Reflect.get(window, '__coachFrames')
    );
    if (!Array.isArray(frames)) throw new Error('no frame record');
    expect(frames.length).toBeGreaterThan(0);
    expect([...new Set(frames)]).toEqual([
      step === 9 ? '0 40px 20px' : `${notches}`,
    ]);
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

// KAN-457: step 9's buttons are one row at the default size.
// KAN-654: Not now sits under them, centred, as Skip tutorial does on the other cards.
// KAN-755: no notch, on any platform; step 8, the anchored card before it, has its one.
for (const os of ['mac', 'win'] as const) {
  test(`step 9 (${os}): Back and Pin this tab one row, Not now centred under them; no notch`, async ({
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
    await expect(card.locator('[data-coach-notch]')).toHaveCount(0);
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
      const card = box(el);
      return {
        width: card.width,
        tops: ['Not now', 'Back', 'Pin this tab'].map((n) => button(n).top),
        pinBottom: button('Pin this tab').bottom,
        notNowCentre: button('Not now').left + button('Not now').width / 2,
        cardCentre: card.left + card.width / 2,
      };
    });
    expect(geometry.width).toBe(400);
    const [notNow, back, pin] = geometry.tops;
    expect(Math.abs(back - pin)).toBeLessThan(1);
    expect(notNow).toBeGreaterThanOrEqual(geometry.pinBottom);
    expect(Math.abs(geometry.notNowCentre - geometry.cardCentre)).toBeLessThan(
      1
    );
    // CONTROL: Back to step 8, anchored, and its notch is drawn.
    await cardButton(page, 'Back').click();
    await landedAt(page, 8);
    await expect(cardAt(page, 8).locator('[data-coach-notch]')).toHaveCount(1);
  });
}
