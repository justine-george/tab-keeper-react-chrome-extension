import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import { stubToolbarPin } from './fixtures/toolbarPin';
import {
  FULL,
  openPage,
  storedSettings,
  twoFrames,
} from './fixtures/onboarding';
import {
  FULL_RUN,
  cardButton,
  nextTo,
  openRunFromHelp,
  storedRun,
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

async function toLastStep(page: Page) {
  for (let step = 2; step <= 3; step++) await nextTo(page, step);
  await cardButton(page, 'Use an example').click();
  for (let step = 5; step <= 8; step++) await nextTo(page, step);
}

// Mounted pinned so no first-open dialog gets in the run's way; the machine is unpinned by the end.
async function runToLastStep(
  page: Page,
  isPinnedAtEnd: boolean
): Promise<() => Promise<string[]>> {
  const seen = await watchDialogs(page);
  await toLastStep(page);
  await page.evaluate(
    (pinned) => Reflect.get(window, '__tabKeeperSetPin')(pinned),
    isPinnedAtEnd
  );
  return seen;
}

test.beforeEach(async ({ context }) => {
  await seedSettings(context, { isPinGuideDismissed: false });
});

test('Not now at step 8: setup, then on Skip setup the pin guide', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  const seen = await runToLastStep(page, false);
  await cardButton(page, 'Not now').click();
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
  await stubToolbarPin(context, { pinned: true });
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  const seen = await runToLastStep(page, true);
  await cardButton(page, 'Pin this tab').click();
  await expect(dialogNamed(page, SETUP)).toBeVisible();
  await skipSetup(page).click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'finished' });
  // The control is the setup it did see, and the unpinned test above that saw the guide too.
  expect(await seen()).toEqual([SETUP]);
});

test('Skip tutorial: nothing opens after it (R8)', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: true });
  const page = await openRunFromHelp(context, extensionId, FULL_RUN);
  const seen = await watchDialogs(page);
  // Unpinned, so a wrongly chained pin guide would draw.
  await page.evaluate(() => Reflect.get(window, '__tabKeeperSetPin')(false));
  await cardButton(page, 'Skip tutorial').click();
  await expect.poll(() => storedRun(page)).toMatchObject({ ended: 'skipped' });
  expect(await seen()).toEqual([]);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  expect((await storedSettings(page)).setupState).toBe('none');
});

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
      for (let n = 0; n < 3; n++)
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
