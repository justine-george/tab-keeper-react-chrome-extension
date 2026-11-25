import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-1004. Mid-move, as drawn: the pane motions are frozen at a fraction of
// their run (every view-transition animation paused at one time), then read.
// What jsdom cannot show: the pictures the browser draws.

const WIDE = { width: 1280, height: 600 };
const FOLD_SAVED = 'Give Currently open the full width';
const SHOW_SAVED_BESIDE = 'Show the saved session beside it';
const FOLD_OPEN_NOW = 'Give the saved session the full width';
const SHOW_OPEN_NOW = 'Show Currently open beside it';

async function open(context: BrowserContext, extensionId: string) {
  await seedSessions(context, {
    ...buildContainer([
      {
        ...buildSession({ tabGroupId: 'S1', title: 'Kyoto plans' }),
        isSelected: true,
      },
    ]),
    selectedTabGroupId: 'S1',
  });
  await seedSettings(context, {
    foldSavedSessionInTabView: false,
    foldOpenNowInTabView: false,
  });
  // The latest transition, so a test can wait for its pictures.
  await context.addInitScript(() => {
    const real = Document.prototype.startViewTransition;
    if (real === undefined) return;
    Document.prototype.startViewTransition = function (callback) {
      const t = real.call(this, callback);
      (window as unknown as { zzLast: ViewTransition }).zzLast = t;
      return t;
    };
  });
  const page = await context.newPage();
  await page.setViewportSize(WIDE);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[data-drag-row-id]').first().waitFor();
  // Off every control, so no hover fill is drawn.
  await page.mouse.move(400, WIDE.height - 5);
  return page;
}

// Presses, then pauses every view-transition animation at `fraction` of the
// longest one's run.
async function pressAndFreeze(
  page: Page,
  press: () => Promise<void>,
  fraction: number
) {
  await page.evaluate(() => {
    delete (window as unknown as { zzLast?: ViewTransition }).zzLast;
  });
  await press();
  await page.waitForFunction(() => 'zzLast' in window);
  await page.evaluate(async (fraction) => {
    await (window as unknown as { zzLast: ViewTransition }).zzLast.ready;
    const motion = document
      .getAnimations()
      .filter((a) =>
        ((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith(
          '::view-transition'
        )
      );
    const end = Math.max(
      ...motion.map((a) => Number(a.effect?.getComputedTiming().endTime ?? 0))
    );
    for (const a of motion) {
      a.pause();
      a.currentTime = end * fraction;
    }
  }, fraction);
}

async function release(page: Page) {
  await page.evaluate(async () => {
    const t = (window as unknown as { zzLast: ViewTransition }).zzLast;
    document
      .getAnimations()
      .filter((a) =>
        ((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith(
          '::view-transition'
        )
      )
      .forEach((a) => a.finish());
    await t.finished;
  });
}

// One screen pixel's colour, as drawn.
async function pixel(page: Page, x: number, y: number): Promise<string> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(',');
  }, png.toString('base64'));
}

// A layer's old and new pictures' opacities, as drawn now.
const pictureOpacity = (page: Page, layer: string) =>
  page.evaluate((layer) => {
    const of = (which: 'old' | 'new') =>
      Number(
        getComputedStyle(
          document.documentElement,
          `::view-transition-${which}(${layer})`
        ).opacity
      );
    return { old: of('old'), new: of('new') };
  }, layer);

const FRACTIONS = [0.25, 0.5, 0.75];

test("folding and showing the saved session, Currently open's right edge stays its border, then page", async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  const header = page.locator('[data-pane="open-now"] [data-open-now-header]');
  const box = await header.boundingBox();
  if (box === null) throw new Error('no header box');
  // Between the header card's right border and the window's frame.
  const gutter = {
    x: Math.round(box.x + box.width) + 3,
    y: Math.round(box.y + box.height / 2),
  };
  const page_ = await pixel(page, gutter.x, gutter.y);
  const fill = await pixel(page, Math.round(box.x + box.width) - 20, gutter.y);
  // PREMISE: the page and the header's fill differ, so a fill drawn there shows.
  expect(page_).not.toBe(fill);

  for (const fraction of FRACTIONS) {
    await pressAndFreeze(
      page,
      () => page.getByRole('button', { name: FOLD_SAVED }).click(),
      fraction
    );
    expect(await pixel(page, gutter.x, gutter.y), `fold at ${fraction}`).toBe(
      page_
    );
    await release(page);

    await pressAndFreeze(
      page,
      () =>
        page
          .locator('[data-pane="open-now"]')
          .getByRole('button', { name: SHOW_SAVED_BESIDE })
          .click(),
      fraction
    );
    expect(await pixel(page, gutter.x, gutter.y), `unfold at ${fraction}`).toBe(
      page_
    );
    await release(page);
  }
});

test('a header button that flips « ↔ » never shows both glyphs at once', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  const openNow = page.locator('[data-pane="open-now"]');
  const detail = page.locator('[data-pane="detail"]');
  const presses: [string, string, () => Promise<void>][] = [
    [
      'pane-open-now-fold',
      'fold the saved session',
      () => openNow.getByRole('button', { name: FOLD_SAVED }).click(),
    ],
    [
      'pane-open-now-fold',
      'show the saved session',
      () => openNow.getByRole('button', { name: SHOW_SAVED_BESIDE }).click(),
    ],
    [
      'pane-saved-title-action',
      'fold Currently open',
      () => detail.getByRole('button', { name: FOLD_OPEN_NOW }).click(),
    ],
    [
      'pane-saved-title-action',
      'show Currently open',
      () => detail.getByRole('button', { name: SHOW_OPEN_NOW }).click(),
    ],
  ];
  for (const [layer, what, press] of presses) {
    for (const fraction of FRACTIONS) {
      await pressAndFreeze(page, press, fraction);
      const o = await pictureOpacity(page, layer);
      expect(
        Math.min(o.old, o.new),
        `${what} at ${fraction}: ${JSON.stringify(o)}`
      ).toBeLessThan(0.05);
      await release(page);
      // Back where it started, for the next fraction.
      if (fraction !== FRACTIONS[FRACTIONS.length - 1]) {
        const undo = presses.find(([l, w]) => l === layer && w !== what)!;
        await undo[2]();
        await page.waitForFunction(
          () => document.documentElement.dataset.paneMove === undefined
        );
      }
    }
  }
});

// A screen region's colours, as drawn, row by row.
// The largest gap, on any channel of any pixel, between two regions.
const furthest = (a: number[], b: number[]) =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i])));

async function region(
  page: Page,
  clip: { x: number; y: number; width: number; height: number }
) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return [...g.getImageData(0, 0, img.width, img.height).data];
  }, png.toString('base64'));
}

test("folding and showing the saved session, Currently open's card corners draw whole", async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  // The search card's top-right corner: nothing else is drawn near it.
  const corner = await page.evaluate(() => {
    const input = document.querySelector('[data-pane="open-now"] input');
    let card = input?.parentElement ?? null;
    while (
      card !== null &&
      getComputedStyle(card).borderTopRightRadius === '0px'
    )
      card = card.parentElement;
    if (card === null) return null;
    const r = card.getBoundingClientRect();
    return { right: r.right, top: r.top };
  });
  if (corner === null) throw new Error('no search card');
  // The corner's curve and the gutter past it, clear of the / chip, which moves.
  const clip = {
    x: Math.round(corner.right) - 11,
    y: Math.round(corner.top) - 1,
    width: 17,
    height: 12,
  };
  const atRest = await region(page, clip);

  for (const fraction of FRACTIONS) {
    await pressAndFreeze(
      page,
      () => page.getByRole('button', { name: FOLD_SAVED }).click(),
      fraction
    );
    // A whole corner differs only by its edge's anti-aliasing (a few levels);
    // a cut one loses border pixels (about 40 levels).
    expect(
      furthest(await region(page, clip), atRest),
      `fold at ${fraction}`
    ).toBeLessThan(20);
    await release(page);

    await pressAndFreeze(
      page,
      () =>
        page
          .locator('[data-pane="open-now"]')
          .getByRole('button', { name: SHOW_SAVED_BESIDE })
          .click(),
      fraction
    );
    // A whole corner differs only by its edge's anti-aliasing (a few levels);
    // a cut one loses border pixels (about 40 levels).
    expect(
      furthest(await region(page, clip), atRest),
      `unfold at ${fraction}`
    ).toBeLessThan(20);
    await release(page);
  }
});

test("folding and showing Currently open, the saved session's card corners draw whole at the motion's ends", async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  // The saved session's list card: its bottom-right corner, clear of every control.
  const cornerClip = () =>
    page.evaluate(() => {
      const detail = document.querySelector('[data-pane="detail"]');
      const cards = [...(detail?.querySelectorAll('*') ?? [])].filter(
        (e) =>
          getComputedStyle(e).borderBottomRightRadius !== '0px' &&
          e.getBoundingClientRect().height > 200
      );
      const r = cards[0]?.getBoundingClientRect();
      return r === undefined
        ? null
        : {
            x: Math.round(r.right) - 11,
            y: Math.round(r.bottom) - 11,
            width: 17,
            height: 12,
          };
    });
  const before = await cornerClip();
  if (before === null) throw new Error('no list card');
  const atRestBefore = await region(page, before);

  // The motion's first frame: the edge is where it rests, so the corner must be too.
  await pressAndFreeze(
    page,
    () =>
      page
        .locator('[data-pane="detail"]')
        .getByRole('button', { name: FOLD_OPEN_NOW })
        .click(),
    0.001
  );
  expect(
    furthest(await region(page, before), atRestBefore),
    'fold, first frame'
  ).toBeLessThan(20);
  await release(page);

  const after = await cornerClip();
  if (after === null) throw new Error('no list card, folded');
  const atRestAfter = await region(page, after);
  await pressAndFreeze(
    page,
    () =>
      page
        .locator('[data-pane="detail"]')
        .getByRole('button', { name: SHOW_OPEN_NOW })
        .click(),
    0.001
  );
  expect(
    furthest(await region(page, after), atRestAfter),
    'unfold, first frame'
  ).toBeLessThan(20);
  await release(page);
});

test("either pane folding or coming back, the window's frame lines run unbroken across both", async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  // The panes' own top and bottom borders, end to end across both.
  const rows = await page.evaluate(() => {
    const detail = document
      .querySelector('[data-pane="detail"]')!
      .getBoundingClientRect();
    return {
      x: Math.round(detail.left) + 20,
      width: Math.round(window.innerWidth - detail.left) - 40,
      top: Math.round(detail.top),
      bottom: Math.round(detail.bottom) - 1,
    };
  });
  const line = (y: number) => ({ x: rows.x, y, width: rows.width, height: 1 });
  const restTop = await region(page, line(rows.top));
  const restBottom = await region(page, line(rows.bottom));
  // PREMISE: at rest each row is a line, darker than the page.
  expect(Math.max(...restTop.filter((_, i) => i % 4 === 0))).toBeLessThan(250);

  const detail = page.locator('[data-pane="detail"]');
  const openNow = page.locator('[data-pane="open-now"]');
  for (const fraction of FRACTIONS) {
    for (const [what, pane, name] of [
      ['Currently open folds', detail, FOLD_OPEN_NOW],
      ['Currently open comes back', detail, SHOW_OPEN_NOW],
      ['the saved session folds', openNow, FOLD_SAVED],
      ['the saved session comes back', openNow, SHOW_SAVED_BESIDE],
    ] as const) {
      await pressAndFreeze(
        page,
        () => pane.getByRole('button', { name }).click(),
        fraction
      );
      expect(
        furthest(await region(page, line(rows.top)), restTop),
        `${what} at ${fraction}, top`
      ).toBeLessThan(20);
      expect(
        furthest(await region(page, line(rows.bottom)), restBottom),
        `${what} at ${fraction}, bottom`
      ).toBeLessThan(20);
      await release(page);
    }
  }
});
