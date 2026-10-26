import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { elementLanded } from './fixtures/landed';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-810 on the real artifact: the folds and the drawer run as view
// transitions. What jsdom cannot show: that each one starts (two layers with
// one name make Chrome skip it), which layers it moves, that the CSS animating
// them is valid (an invalid value drops the whole keyframes, silently), that
// reduced motion stays instant, and that / keeps the keys typed after it.

const WIDE = { width: 1400, height: 800 };
const FOLD_OPEN_NOW = 'Fold the Currently open panel away';
const SHOW_OPEN_NOW = 'Show the Currently open panel';
const FOLD_SAVED = 'Fold the saved session away';
const SHOW_SAVED = 'Show the saved session';

interface Run {
  move?: string;
  dir?: string;
  from?: string;
  ready: string;
  layers: string[];
}

// Records every view transition: its marks, whether it started, its layers.
async function recordTransitions(context: BrowserContext) {
  await context.addInitScript(() => {
    const real = Document.prototype.startViewTransition;
    if (real === undefined) return;
    const runs: Run[] = [];
    (window as unknown as { zzRuns: Run[] }).zzRuns = runs;
    Document.prototype.startViewTransition = function (callback) {
      const d = document.documentElement.dataset;
      const run: Run = {
        move: d.paneMove,
        dir: d.paneMoveDir,
        from: d.paneMoveFrom,
        ready: 'pending',
        layers: [],
      };
      runs.push(run);
      const transition = real.call(this, callback);
      transition.ready.then(
        () => {
          run.ready = 'started';
          run.layers = [
            ...new Set(
              document
                .getAnimations()
                .map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement)
                .map((p) => /\((.+)\)/.exec(p ?? '')?.[1])
                .filter((n): n is string => n !== undefined && n !== 'root')
            ),
          ].sort();
        },
        (e: Error) => {
          run.ready = `skipped: ${e.name}`;
        }
      );
      return transition;
    };
  });
}

const runs = (page: Page) =>
  page.evaluate(() => (window as unknown as { zzRuns: Run[] }).zzRuns);

async function seed(context: BrowserContext, foldOpenNow = false) {
  await seedSessions(context, {
    ...buildContainer([
      {
        ...buildSession({ tabGroupId: 'S1', title: 'Q4 product roadmap' }),
        isSelected: true,
      },
    ]),
    selectedTabGroupId: 'S1',
  });
  await seedSettings(context, {
    foldSavedSessionInTabView: false,
    foldOpenNowInTabView: foldOpenNow,
  });
}

async function open(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.setViewportSize(WIDE);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

// Press, then wait for the transition the press started to settle.
async function press(page: Page, act: () => Promise<void>) {
  const before = (await runs(page)).length;
  await act();
  await expect
    .poll(async () => {
      const all = await runs(page);
      return all.length > before && all[all.length - 1].ready !== 'pending';
    })
    .toBe(true);
  // Past the longest move (240ms), so the next press starts from rest.
  await page.waitForTimeout(350);
  const all = await runs(page);
  return all[all.length - 1];
}

const rail = (page: Page) =>
  page.getByRole('button', { name: /^Currently open/ });

test('each fold and the drawer start a transition that moves their layers', async ({
  context,
  extensionId,
}) => {
  await recordTransitions(context);
  await seed(context);
  const page = await open(context, extensionId);
  const detail = page.locator('[data-pane="detail"]');

  const foldOpenNow = await press(page, () =>
    detail.getByRole('button', { name: FOLD_OPEN_NOW }).click()
  );
  expect(foldOpenNow).toMatchObject({
    move: 'openNow',
    dir: 'fold',
    ready: 'started',
  });
  expect(foldOpenNow.layers).toEqual(
    expect.arrayContaining([
      'pane-detail',
      'pane-open-now',
      'pane-saved-title-action',
      'pane-saved-add-window',
      'pane-open-now-grip',
    ])
  );

  const showOpenNow = await press(page, () =>
    detail.getByRole('button', { name: SHOW_OPEN_NOW }).click()
  );
  expect(showOpenNow).toMatchObject({
    move: 'openNow',
    dir: 'unfold',
    ready: 'started',
  });

  const foldSaved = await press(page, () =>
    page.getByRole('button', { name: FOLD_SAVED }).click()
  );
  expect(foldSaved).toMatchObject({
    move: 'saved',
    dir: 'fold',
    ready: 'started',
  });
  expect(foldSaved.layers).toEqual(
    expect.arrayContaining([
      'pane-detail',
      'pane-open-now',
      'pane-open-now-fold',
      'pane-open-now-back',
    ])
  );

  const showSaved = await press(page, () =>
    page.getByRole('button', { name: SHOW_SAVED }).click()
  );
  expect(showSaved).toMatchObject({
    move: 'saved',
    dir: 'unfold',
    ready: 'started',
  });

  await press(page, () =>
    detail.getByRole('button', { name: FOLD_OPEN_NOW }).click()
  );
  // The drawer slides in and out on itself, taking presses throughout: no pane motion.
  const beforeDrawer = (await runs(page)).length;
  await rail(page).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  expect(
    await drawer.evaluate((el) => el.getAnimations().length)
  ).toBeGreaterThan(0);
  await elementLanded(drawer, 'subtree');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveAttribute('data-leaving', '');
  await expect(drawer).toHaveCount(0);
  expect((await runs(page)).length).toBe(beforeDrawer);

  await rail(page).click();
  await elementLanded(page.getByRole('dialog'), 'subtree');
  const fromDrawer = await press(page, () =>
    page.getByRole('dialog').getByRole('button', { name: FOLD_SAVED }).click()
  );
  expect(fromDrawer).toMatchObject({
    move: 'saved',
    dir: 'fold',
    from: 'drawer',
    ready: 'started',
  });
  // The drawer widens into the column, and its close button fades on its own.
  expect(fromDrawer.layers).toEqual(
    expect.arrayContaining(['pane-open-now', 'pane-open-now-close'])
  );
  expect(fromDrawer.layers).not.toContain('pane-drawer');
});

test("folding Currently open, the saved session's edge strip slides", async ({
  context,
  extensionId,
}) => {
  await seed(context);
  const page = await open(context, extensionId);
  await page
    .locator('[data-pane="detail"]')
    .getByRole('button', { name: FOLD_OPEN_NOW })
    .click();
  // Freeze the transition, then read the strip's position at two moments.
  const positions = await page.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const live = document
        .getAnimations()
        .filter((a) =>
          ((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith(
            '::view-transition'
          )
        );
      if (live.length) {
        live.forEach((a) => a.pause());
        const read = (at: number) => {
          live.forEach((a) => (a.currentTime = at));
          return getComputedStyle(
            document.documentElement,
            '::view-transition-old(pane-detail)'
          ).objectPosition;
        };
        return [read(0), read(279)];
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return null;
  });
  // From the window-side edge to 8px in: the strip's offset from the right.
  const offset = (p: string) =>
    Number(
      /calc\(100% - ([\d.]+)px\)/.exec(p)?.[1] ??
        (p.startsWith('100%') ? 0 : NaN)
    );
  expect(positions).not.toBeNull();
  expect(offset(positions![0])).toBe(0);
  expect(offset(positions![1])).toBeCloseTo(8, 1);
});

test('with reduced motion, the folds and the drawer swap at once', async ({
  context,
  extensionId,
}) => {
  await recordTransitions(context);
  await seed(context);
  const page = await open(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .locator('[data-pane="detail"]')
    .getByRole('button', { name: FOLD_OPEN_NOW })
    .click();
  await expect(rail(page)).toBeVisible();
  await rail(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await runs(page)).toEqual([]);
});

test('/ opens the drawer at once, and the keys typed after it reach the field', async ({
  context,
  extensionId,
}) => {
  await recordTransitions(context);
  await seed(context, true);
  const page = await open(context, extensionId);
  // Opened by its own button and closed by Esc, the rail is where / goes.
  await rail(page).click();
  await elementLanded(page.getByRole('dialog'), 'subtree');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = (await runs(page)).length;
  await page.keyboard.type('/kyoto');
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Search open tabs' })
  ).toHaveValue('kyoto');
  expect((await runs(page)).length).toBe(before);
});

test('the rail button wears no fill while its drawer is open over it', async ({
  context,
  extensionId,
}) => {
  await seed(context, true);
  const page = await open(context, extensionId);
  await rail(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.move(400, 700);
  await expect
    .poll(() =>
      rail(page).evaluate((el) => getComputedStyle(el).backgroundColor)
    )
    .toBe('rgba(0, 0, 0, 0)');
});

test('a click on a saved session while the drawer is open slides it out and shows that session', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer([
      {
        ...buildSession({ tabGroupId: 'S1', title: 'Q4 product roadmap' }),
        isSelected: true,
      },
      buildSession({ tabGroupId: 'S2', title: 'Weekend in Kyoto' }),
    ]),
    selectedTabGroupId: 'S1',
  });
  await seedSettings(context, {
    foldSavedSessionInTabView: false,
    foldOpenNowInTabView: true,
  });
  const page = await open(context, extensionId);
  await rail(page).click();
  await elementLanded(page.getByRole('dialog'), 'subtree');
  await page
    .locator('[data-pane="sessions"] [data-drag-row-id="S2"]')
    .click({ position: { x: 40, y: 12 } });
  // The same slide out as Esc's, and the click still lands.
  await expect(page.getByRole('dialog')).toHaveAttribute('data-leaving', '');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-pane="detail"]')).toContainText(
    'Weekend in Kyoto'
  );
});
