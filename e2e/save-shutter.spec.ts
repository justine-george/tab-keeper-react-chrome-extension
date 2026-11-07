import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { POPUP, FULL, FULL_VIEW_PATH } from './fixtures/onboarding';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-388, his pick B, in the real build: a save slides the header mark's
// shutter (no press, no sound); Reduce motion dims it; adding to a session plays nothing.

/** No spaces in the title: a data: URL keeps them only when encoded. */
const titled = (title: string) =>
  `data:text/html,<title>${title}</title><p>${title}</p>`;

async function open(
  context: BrowserContext,
  extensionId: string,
  path: string,
  viewport: { width: number; height: number }
): Promise<Page> {
  await seedSettings(context, {
    isNeverAskAgainForTabGroups: true,
    isNeverAskAgainToRate: true,
  });
  await seedSessions(context, {
    ...buildContainer([
      buildSession({ tabGroupId: 's0', title: 'Kept', isSelected: true }),
    ]),
    selectedTabGroupId: 's0',
  });
  // Something to save beside Tab Keeper's own page.
  const here = await context.newPage();
  await here.goto(titled('Here'));
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  await page.locator('[data-tour-anchor="save"]').waitFor();
  await watchMark(page);
  return page;
}

// Records, every frame, which parts of the header mark animate, and what they animate.
async function watchMark(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = new Set<string>();
    Object.defineProperty(globalThis, '__markAnimations', {
      value: seen,
      configurable: true,
    });
    const tick = () => {
      const svg = document.querySelector('svg:has([data-mark-part="shutter"])');
      for (const animation of document.getAnimations()) {
        if (!(animation.effect instanceof KeyframeEffect)) continue;
        const target = animation.effect.target;
        if (target === null || svg === null || !svg.contains(target)) continue;
        const part = target.hasAttribute('data-mark-part') ? 'shutter' : 'mark';
        const props = animation.effect
          .getKeyframes()
          .flatMap((frame) => Object.keys(frame))
          .filter((key) => key !== 'offset' && key !== 'computedOffset')
          .filter((key) => key !== 'easing' && key !== 'composite');
        seen.add(`${part}:${[...new Set(props)].join(',')}`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const animated = (page: Page) =>
  page.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__markAnimations');
    return seen instanceof Set ? [...seen].map(String).sort() : [];
  });
const sessionCount = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('tabContainerData') ?? '{}') as {
          tabGroups?: unknown[];
        }
      ).tabGroups?.length ?? 0
  );

test('popup: Save all slides the shutter, and only the shutter', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'index.html', POPUP);
  expect(await animated(page)).toEqual([]);
  await page
    .getByRole('button', { name: 'Save all open windows as a session' })
    .click();
  await expect.poll(() => sessionCount(page)).toBe(2);
  await expect.poll(() => animated(page)).toEqual(['shutter:transform']);
});

test("full view: Open now's Save window slides the shutter", async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, FULL_VIEW_PATH, FULL);
  await page
    .locator('[data-pane="open-now"]')
    .getByRole('button', { name: /^Save window as a session: / })
    .first()
    .click();
  await expect.poll(() => sessionCount(page)).toBe(2);
  await expect.poll(() => animated(page)).toEqual(['shutter:transform']);
});

test('reduced motion: a save dims the shutter, and nothing moves', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'index.html', POPUP);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .getByRole('button', { name: 'Save all open windows as a session' })
    .click();
  await expect.poll(() => sessionCount(page)).toBe(2);
  await expect.poll(() => animated(page)).toEqual(['shutter:opacity']);
});

test('Add current window keeps the mark still; a save after it slides it', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'index.html', POPUP);
  const tabsIn = () =>
    page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('tabContainerData') ?? '{}') as {
            tabGroups: { windowCount: number }[];
          }
        ).tabGroups[0].windowCount
    );
  const before = await tabsIn();
  await page.getByRole('button', { name: 'Add current window' }).click();
  await expect.poll(tabsIn).toBe(before + 1);
  // Past the click slide's 360ms, had it started.
  await page.waitForTimeout(500);
  expect(await animated(page)).toEqual([]);

  // CONTROL: the same watcher, the same page, sees a save.
  await page
    .getByRole('button', { name: 'Save all open windows as a session' })
    .click();
  await expect.poll(() => animated(page)).toEqual(['shutter:transform']);
});
