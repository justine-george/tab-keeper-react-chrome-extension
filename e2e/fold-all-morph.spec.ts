import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-756. The fold-all control's chevrons slide past each other when its
// glyph changes, in the saved session header and in Open now. What jsdom
// cannot show: a CSS transition actually running, its timing, and where each
// chevron is drawn once it lands.

const POPUP = { width: 790, height: 550 };
const TAB_VIEW = { width: 1280, height: 800 };

// Material Symbols Outlined 400 (viewBox 0 -960 960 960): each chevron's top
// and bottom edge in each glyph. The control draws 24px, so a unit is 1/40 px.
const GLYPH = {
  unfold_less: { down: [-800, -577], up: [-383, -160] },
  unfold_more: { up: [-836, -612], down: [-344, -120] },
} as const;
const UNIT_PX = 24 / 960;

const COLLAPSE = { name: 'Collapse all windows', exact: true };
const EXPAND = { name: 'Expand all windows', exact: true };

const win = (windowId: string, title: string) => ({
  windowId,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title,
  tabs: [
    {
      tabId: `${windowId}t1`,
      favicon: '',
      title: `${title} tab`,
      url: `https://example.com/${windowId}`,
    },
  ],
});

const TRIP = buildSession({
  tabGroupId: 'trip',
  title: 'Kyoto trip',
  isSelected: true,
  windowCount: 2,
  tabCount: 2,
  windows: [win('w1', 'Flights'), win('w2', 'Hotels')],
});
const WORK = buildSession({
  tabGroupId: 'work',
  title: 'Work',
  windowCount: 1,
  tabCount: 1,
  windows: [win('w3', 'Reviews')],
});

async function openPopup(
  context: BrowserContext,
  extensionId: string,
  path = 'index.html',
  viewport = POPUP
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([TRIP, WORK]),
    selectedTabGroupId: TRIP.tabGroupId,
  });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  // Every transition the fold glyph starts, with the timing it runs on.
  await page.addInitScript(() => {
    const runs: { property: string; duration: unknown; easing: string }[] = [];
    (window as unknown as { foldRuns: typeof runs }).foldRuns = runs;
    document.addEventListener('transitionrun', (e) => {
      const target = e.target as Element;
      if (!target.closest('[data-fold-glyph]')) return;
      const run = target
        .getAnimations()
        .find(
          (a) => (a as CSSTransition).transitionProperty === e.propertyName
        );
      const timing = run?.effect?.getTiming();
      runs.push({
        property: e.propertyName,
        duration: timing?.duration,
        easing: timing?.easing ?? '',
      });
    });
  });
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

const runs = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          foldRuns: { property: string; duration: unknown; easing: string }[];
        }
      ).foldRuns
  );
const clearRuns = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { foldRuns: unknown[] }).foldRuns.length = 0;
  });

// Where each chevron is drawn, in glyph units, once nothing on it moves.
async function pose(control: Locator) {
  await expect
    .poll(() =>
      control.evaluate((el) =>
        [...el.querySelectorAll('[data-fold-glyph] path')].every(
          (p) => p.getAnimations().length === 0
        )
      )
    )
    .toBe(true);
  return control.evaluate((el, unitPx) => {
    const svg = el.querySelector('[data-fold-glyph]')!.getBoundingClientRect();
    const edges = (name: string) => {
      const r = el
        .querySelector(`[data-fold-glyph] [data-chevron="${name}"]`)!
        .getBoundingClientRect();
      return [
        (r.top - svg.top) / unitPx - 960,
        (r.bottom - svg.top) / unitPx - 960,
      ];
    };
    return { up: edges('up'), down: edges('down') };
  }, UNIT_PX);
}

// Within 2 units (0.05px) of the Material glyph: the two glyphs' chevrons
// differ by a unit or two, and a slide keeps one shape.
function expectGlyph(
  drawn: { up: number[]; down: number[] },
  glyph: keyof typeof GLYPH
) {
  for (const part of ['up', 'down'] as const)
    for (const [i, edge] of GLYPH[glyph][part].entries())
      expect(
        Math.abs(drawn[part][i] - edge),
        `${glyph} ${part} edge ${i}: drew ${drawn[part][i]}, glyph has ${edge}`
      ).toBeLessThanOrEqual(2);
}

// One 200 ms ease-in-out slide per chevron.
function expectSlide(seen: Awaited<ReturnType<typeof runs>>) {
  expect(seen).toEqual([
    {
      property: 'transform',
      duration: 200,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    },
    {
      property: 'transform',
      duration: 200,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    },
  ]);
}

test('a press slides the chevrons past each other, both ways, and opening the popup does not', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const collapse = page.getByRole('button', COLLAPSE);
  expectGlyph(await pose(collapse), 'unfold_less');
  // Drawn at rest from the first frame, with no motion.
  expect(await runs(page)).toEqual([]);

  await collapse.click();
  const expand = page.getByRole('button', EXPAND);
  expectGlyph(await pose(expand), 'unfold_more');
  expectSlide(await runs(page));

  await clearRuns(page);
  await expand.click();
  expectGlyph(await pose(collapse), 'unfold_less');
  expectSlide(await runs(page));
});

test('folding the last open window by hand slides it too', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Collapse: Flights' }).click();
  // One window is still open: the glyph has not changed.
  const collapse = page.getByRole('button', COLLAPSE);
  expectGlyph(await pose(collapse), 'unfold_less');
  expect(await runs(page)).toEqual([]);

  await page.getByRole('button', { name: 'Collapse: Hotels' }).click();
  expectGlyph(await pose(page.getByRole('button', EXPAND)), 'unfold_more');
  expectSlide(await runs(page));
});

test('switching sessions shows the other glyph at once', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', COLLAPSE).click();
  expectGlyph(await pose(page.getByRole('button', EXPAND)), 'unfold_more');
  // CONTROL: a press in this page does slide.
  expectSlide(await runs(page));

  await clearRuns(page);
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByText('Reviews', { exact: true })).toBeVisible();
  // Work's windows are open: the other glyph, drawn where it rests.
  expectGlyph(await pose(page.getByRole('button', COLLAPSE)), 'unfold_less');
  expect(await runs(page)).toEqual([]);
});

test('with Reduce motion on, a press swaps the glyph at once', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', COLLAPSE).click();
  expectGlyph(await pose(page.getByRole('button', EXPAND)), 'unfold_more');
  expect(await runs(page)).toEqual([]);
});

test('in Open now, a press and a window Chrome opens both slide it', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await openPopup(
    context,
    extensionId,
    'index.html?view=tab',
    TAB_VIEW
  );
  const region = page.getByRole('region', { name: 'Open now', exact: true });
  const collapse = region.getByRole('button', COLLAPSE);
  expectGlyph(await pose(collapse), 'unfold_less');
  expect(await runs(page)).toEqual([]);

  await collapse.click();
  const expand = region.getByRole('button', EXPAND);
  expectGlyph(await pose(expand), 'unfold_more');
  expectSlide(await runs(page));

  // A new window is open, so the control offers to fold again.
  await clearRuns(page);
  await serviceWorker.evaluate(() =>
    chrome.windows.create({ url: 'about:blank', focused: false })
  );
  expectGlyph(await pose(region.getByRole('button', COLLAPSE)), 'unfold_less');
  expectSlide(await runs(page));
});
