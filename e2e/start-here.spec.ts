import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import {
  FULL,
  FULL_VIEW_PATH,
  POPUP,
  THEMES,
  openPage,
  pageGround,
  storedSettings,
} from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';
import { isValidTabMasterContainer } from '../src/utils/functions/local';

// KAN-7 §2 on the real build, in the popup and both full-view layouts.

const SESSIONS = '[data-pane="sessions"]';
const card = (page: Page) => page.locator('[data-start-here]');
const hint = (page: Page) => page.locator('[data-start-here-hint]');

// Records each Start here surface the moment it is inserted, from document start.
async function watchStartHere(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__startHereSeen', {
      value: seen,
      configurable: true,
    });
    new MutationObserver(() => {
      if (document.querySelector('[data-start-here]') && !seen.includes('card'))
        seen.push('card');
      if (
        document.querySelector('[data-start-here-hint]') &&
        !seen.includes('hint')
      )
        seen.push('hint');
    }).observe(document, { childList: true, subtree: true });
  });
}

const startHereSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__startHereSeen');
    return Array.isArray(seen) ? seen.map(String) : [];
  });

const storedTitles = async (page: Page) => {
  const raw = await page.evaluate(
    () => localStorage.getItem('tabContainerData') ?? '{}'
  );
  const parsed: unknown = JSON.parse(raw);
  return isValidTabMasterContainer(parsed)
    ? parsed.tabGroups.map((g) => g.title)
    : null;
};

const VIEWS = [
  {
    name: 'popup',
    path: 'index.html',
    viewport: POPUP,
    settings: {},
    hasDetail: true,
  },
  {
    name: 'full view side by side',
    path: FULL_VIEW_PATH,
    viewport: FULL,
    settings: { foldSavedSessionInTabView: false },
    hasDetail: true,
  },
  {
    name: 'full view folded',
    path: FULL_VIEW_PATH,
    viewport: FULL,
    settings: {},
    hasDetail: false,
  },
] as const;

for (const view of VIEWS) {
  test(`${view.name}: an empty list starts here, and the sample is added and shown`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer([]));
    await seedSettings(context, view.settings);
    const page = await openPage(context, extensionId, view.path, view.viewport);

    await expect(
      page
        .locator(SESSIONS)
        .getByRole('heading', { name: 'Start here', exact: true })
    ).toBeVisible();
    await expect(hint(page)).toHaveCount(view.hasDetail ? 1 : 0);

    await page
      .getByRole('button', { name: 'Add a sample session', exact: true })
      .click();
    await expect(card(page)).toHaveCount(0);
    await expect(hint(page)).toHaveCount(0);
    await expect(
      page.getByText('Things to do in Lisbon - Time Out', { exact: true })
    ).toBeVisible();
    expect(await storedTitles(page)).toEqual(['Sample: Weekend trip']);
    expect((await storedSettings(page)).lastValueMomentTime ?? '').toBe('');
  });
}

for (const view of [VIEWS[0], VIEWS[2]]) {
  test(`${view.name}: an existing user's open never draws Start here, not for a frame`, async ({
    context,
    extensionId,
  }) => {
    await watchStartHere(context);
    await seedSessions(
      context,
      buildContainer([buildSession({ title: 'Kept' })])
    );
    const page = await openPage(context, extensionId, view.path, view.viewport);
    await expect(page.getByText('Kept', { exact: true }).first()).toBeVisible();
    expect(await startHereSeen(page)).toEqual([]);
  });
}

test('CONTROL: the same observer sees the card on an empty list', async ({
  context,
  extensionId,
}) => {
  await watchStartHere(context);
  await seedSessions(context, buildContainer([]));
  const page = await openPage(context, extensionId, 'index.html', POPUP);
  await expect.poll(() => startHereSeen(page)).toContain('card');
});

test.describe('on a new install', () => {
  test.use({ freshProfile: true });

  test('the card is there behind the welcome, which is modal', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    await expect(
      page.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true })
    ).toBeVisible();
    await expect(card(page)).toBeAttached();
    expect(
      await page.evaluate(
        () => document.querySelector('dialog[open]')?.matches(':modal')
      )
    ).toBe(true);
  });
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the card and the line read at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer([]));
    await seedSettings(context, { theme });
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await expectReadable(card(page), `${theme} Start here card`);
    await expectReadable(hint(page), `${theme} right-pane line`);
  });
}
