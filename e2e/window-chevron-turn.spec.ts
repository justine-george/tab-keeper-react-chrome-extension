import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-757. A window row's chevron turns half a turn when its window folds or
// unfolds, in saved sessions and in Open now. What jsdom cannot show: a CSS
// transition actually running, its timing, and where the turned glyph lands.

const POPUP = { width: 790, height: 550 };
const TAB_VIEW = { width: 1280, height: 800 };
const TURN = {
  property: 'transform',
  duration: 200,
  easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
};

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
  // Every transition a window chevron starts, with the timing it runs on.
  await page.addInitScript(() => {
    const runs: { property: string; duration: unknown; easing: string }[] = [];
    (window as unknown as { chevronRuns: typeof runs }).chevronRuns = runs;
    document.addEventListener('transitionrun', (e) => {
      const target = e.target as Element;
      if (!target.closest('[data-window-chevron]')) return;
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

// Read two frames on: a transitionrun is dispatched on the frame after the change.
const runs = (page: Page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 2; i++)
      await new Promise((r) => requestAnimationFrame(r));
    return (
      window as unknown as {
        chevronRuns: { property: string; duration: unknown; easing: string }[];
      }
    ).chevronRuns;
  });
const clearRuns = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { chevronRuns: unknown[] }).chevronRuns.length = 0;
  });

// The glyph a row's chevron draws once nothing on it moves, and its turn in degrees.
async function pose(button: Locator) {
  await expect
    .poll(() =>
      button.evaluate(
        (el) =>
          el.querySelector('[data-window-chevron]')!.getAnimations().length
      )
    )
    .toBe(0);
  return button.evaluate((el) => {
    const glyph = el.querySelector('[data-window-chevron]')!;
    const m = new DOMMatrix(getComputedStyle(glyph).transform);
    return {
      shows: glyph.getAttribute('data-window-chevron'),
      text: glyph.textContent,
      deg: Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI),
    };
  });
}

const FOLDED = { shows: 'expand_more', text: 'expand_more', deg: 0 };
const OPEN = { shows: 'expand_less', text: 'expand_more', deg: 180 };

test('a press turns the chevron, both ways, and opening the popup does not', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const collapse = page.getByRole('button', { name: 'Collapse: Flights' });
  expect(await pose(collapse)).toEqual(OPEN);
  // Drawn at rest from the first frame, with no motion.
  expect(await runs(page)).toEqual([]);

  await collapse.click();
  const expand = page.getByRole('button', { name: 'Expand: Flights' });
  expect(await pose(expand)).toEqual(FOLDED);
  expect(await runs(page)).toEqual([TURN]);

  await clearRuns(page);
  await expand.click();
  expect(await pose(collapse)).toEqual(OPEN);
  expect(await runs(page)).toEqual([TURN]);
});

test('a second press mid-turn turns it back from where it is', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Collapse: Flights' }).click();
  // Part way round: the turn has started and not landed.
  await page.waitForFunction(() => {
    const turn = document
      .querySelector('[data-window-chevron]')
      ?.getAnimations()[0];
    return turn !== undefined && Number(turn.currentTime) > 50;
  });
  await page.getByRole('button', { name: 'Expand: Flights' }).click();
  expect(
    await pose(page.getByRole('button', { name: 'Collapse: Flights' }))
  ).toEqual(OPEN);
  const [first, back] = await runs(page);
  expect(first).toEqual(TURN);
  // Back the way it came, for the part it had turned: shorter than a full turn.
  expect(back.property).toBe('transform');
  expect(back.duration).toBeGreaterThan(0);
  expect(back.duration).toBeLessThan(TURN.duration);
});

test('a keyboard press turns it too', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Collapse: Hotels' }).focus();
  await page.keyboard.press('Enter');
  expect(
    await pose(page.getByRole('button', { name: 'Expand: Hotels' }))
  ).toEqual(FOLDED);
  expect(await runs(page)).toEqual([TURN]);
});

test('Collapse all and Expand all turn every row that changes', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Collapse all windows' }).click();
  for (const title of ['Flights', 'Hotels'])
    expect(
      await pose(page.getByRole('button', { name: `Expand: ${title}` }))
    ).toEqual(FOLDED);
  expect(await runs(page)).toEqual([TURN, TURN]);

  // One open again: Collapse all turns only that one.
  await clearRuns(page);
  await page.getByRole('button', { name: 'Expand: Flights' }).click();
  // Its turn lands first, so its own transitionrun is not left to come after the clear.
  await pose(page.getByRole('button', { name: 'Collapse: Flights' }));
  expect(await runs(page)).toEqual([TURN]);
  await clearRuns(page);
  await page.getByRole('button', { name: 'Collapse all windows' }).click();
  expect(
    await pose(page.getByRole('button', { name: 'Expand: Flights' }))
  ).toEqual(FOLDED);
  expect(await runs(page)).toEqual([TURN]);

  await clearRuns(page);
  await page.getByRole('button', { name: 'Expand all windows' }).click();
  for (const title of ['Flights', 'Hotels'])
    expect(
      await pose(page.getByRole('button', { name: `Collapse: ${title}` }))
    ).toEqual(OPEN);
  expect(await runs(page)).toEqual([TURN, TURN]);
});

test('switching sessions draws the other rows at rest', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.getByRole('button', { name: 'Collapse: Flights' }).click();
  await pose(page.getByRole('button', { name: 'Expand: Flights' }));
  // CONTROL: a press in this page does turn.
  expect(await runs(page)).toEqual([TURN]);

  await clearRuns(page);
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  const reviews = page.getByRole('button', { name: 'Collapse: Reviews' });
  expect(await pose(reviews)).toEqual(OPEN);
  expect(await runs(page)).toEqual([]);
});

test('with Reduce motion on, a press swaps the chevron at once', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Collapse: Flights' }).click();
  expect(
    await pose(page.getByRole('button', { name: 'Expand: Flights' }))
  ).toEqual(FOLDED);
  expect(await runs(page)).toEqual([]);
});

test('in Open now, a press turns it', async ({ context, extensionId }) => {
  const page = await openPopup(
    context,
    extensionId,
    'index.html?view=tab',
    TAB_VIEW
  );
  const region = page.getByRole('region', { name: 'Open now', exact: true });
  const collapse = region.getByRole('button', { name: /^Collapse: / }).first();
  expect(await pose(collapse)).toEqual(OPEN);
  expect(await runs(page)).toEqual([]);

  await collapse.click();
  expect(
    await pose(region.getByRole('button', { name: /^Expand: / }).first())
  ).toEqual(FOLDED);
  expect(await runs(page)).toEqual([TURN]);
});

// Where a glyph's ink is, in CSS px from its box's top left, and how much
// there is: each pixel's distance from the corner's colour (the ground).
function inkOf(page: Page, png: Buffer) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let ink = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < data.length; i += 4) {
      const d =
        Math.max(...[0, 1, 2].map((k) => Math.abs(data[i + k] - data[k]))) /
        255;
      const at = i / 4;
      ink += d;
      sx += d * (at % img.width);
      sy += d * Math.floor(at / img.width);
    }
    const scale = devicePixelRatio;
    return { ink, x: sx / ink / scale, y: sy / ink / scale };
  }, png.toString('base64'));
}

// Turned, expand_more lands on expand_less, to within how the font is drawn:
// its ink sits left of the box's centre, so a turn moves it about 0.5px right,
// and an upright glyph snaps to whole pixels where a turned one does not, up
// to half a pixel up or down (0.32 lower at scale 1, 0.17 higher at scale 2).
// Turned about the box's centre instead, it would land a further 0.6px lower.
test('the open chevron rests where expand_less draws', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  const button = page.getByRole('button', { name: 'Collapse: Flights' });
  await pose(button);
  // Off the button, so no hover fill sits under either shot.
  await page.mouse.move(5, 540);
  const glyph = button.locator('[data-window-chevron]');
  const turned = await inkOf(page, await glyph.screenshot());
  // The same box drawing expand_less itself, unturned.
  await glyph.evaluate((el) => {
    (el as HTMLElement).style.transition = 'none';
    (el as HTMLElement).style.transform = 'none';
    el.textContent = 'expand_less';
  });
  const real = await inkOf(page, await glyph.screenshot());
  expect(Math.abs(turned.y - real.y), 'up or down').toBeLessThan(0.5);
  expect(Math.abs(turned.x - real.x), 'left or right').toBeLessThan(0.6);
  expect(Math.abs(turned.ink / real.ink - 1), 'ink').toBeLessThan(0.05);
});
