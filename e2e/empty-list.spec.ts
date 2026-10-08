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
} from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';

// The empty saved list's line on the real build, in the popup and both full-view layouts.

const SESSIONS = '[data-pane="sessions"]';
const line = (page: Page) => page.locator(`${SESSIONS} [data-empty-list]`);
const hint = (page: Page) => page.locator('[data-start-here-hint]');

// Records each empty-list surface the moment it is inserted, from document start.
async function watchEmptyLine(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(globalThis, '__emptyLineSeen', {
      value: seen,
      configurable: true,
    });
    new MutationObserver(() => {
      if (document.querySelector('[data-empty-list]') && !seen.includes('line'))
        seen.push('line');
      if (
        document.querySelector('[data-start-here-hint]') &&
        !seen.includes('hint')
      )
        seen.push('hint');
    }).observe(document, { childList: true, subtree: true });
  });
}

const emptyLineSeen = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__emptyLineSeen');
    return Array.isArray(seen) ? seen.map(String) : [];
  });

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
  test(`${view.name}: an empty list says where saved sessions will appear`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer([]));
    await seedSettings(context, view.settings);
    const page = await openPage(context, extensionId, view.path, view.viewport);

    await expect(line(page)).toHaveText('Saved sessions appear here.');
    await expect(hint(page)).toHaveCount(view.hasDetail ? 1 : 0);

    await expect(
      page.getByRole('button', { name: 'Try it with an example', exact: true })
    ).toHaveCount(0);
  });
}

// The text's own box against the list's content edges: the line's box fills the list, so its edges say nothing about alignment.
const placement = (page: Page) =>
  line(page).evaluate((el) => {
    const list = el.parentElement;
    if (!list) throw new Error('the line has no list');
    const text = document.createRange();
    text.selectNodeContents(el);
    const textBox = text.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    const contentLeft = listBox.left + list.clientLeft;
    const contentRight = contentLeft + list.clientWidth;
    const contentTop =
      listBox.top + list.clientTop + parseFloat(style.paddingTop);
    return {
      leftGap: textBox.left - contentLeft,
      rightGap: contentRight - textBox.right,
      textTop: textBox.top - contentTop,
    };
  });

for (const view of VIEWS) {
  test(`${view.name}: the line is centred in the list, at its top`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer([]));
    await seedSettings(context, view.settings);
    const page = await openPage(context, extensionId, view.path, view.viewport);
    await expect(line(page)).toBeVisible();

    const { leftGap, rightGap, textTop } = await placement(page);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
    expect(textTop).toBeGreaterThanOrEqual(0);
    expect(textTop).toBeLessThanOrEqual(17);
  });
}

for (const view of [VIEWS[0], VIEWS[2]]) {
  test(`${view.name}: an existing user's open never draws the line, not for a frame`, async ({
    context,
    extensionId,
  }) => {
    await watchEmptyLine(context);
    await seedSessions(
      context,
      buildContainer([buildSession({ title: 'Kept' })])
    );
    const page = await openPage(context, extensionId, view.path, view.viewport);
    await expect(page.getByText('Kept', { exact: true }).first()).toBeVisible();
    expect(await emptyLineSeen(page)).toEqual([]);
  });
}

test('CONTROL: the same observer sees the line on an empty list', async ({
  context,
  extensionId,
}) => {
  await watchEmptyLine(context);
  await seedSessions(context, buildContainer([]));
  const page = await openPage(context, extensionId, 'index.html', POPUP);
  await expect.poll(() => emptyLineSeen(page)).toContain('line');
});

test.describe('on a new install', () => {
  test.use({ freshProfile: true });

  test('the line is there behind the welcome, which is modal', async ({
    context,
    extensionId,
  }) => {
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    await expect(
      page.getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true })
    ).toBeVisible();
    await expect(line(page)).toBeAttached();
    expect(
      await page.evaluate(() =>
        document.querySelector('dialog[open]')?.matches(':modal')
      )
    ).toBe(true);
  });
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the line and the detail pane's line read at 4.5:1`, async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer([]));
    await seedSettings(context, { theme });
    const page = await openPage(context, extensionId, 'index.html', POPUP);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await expectReadable(line(page), `${theme} empty list line`);
    await expectReadable(hint(page), `${theme} detail pane line`);
  });
}
