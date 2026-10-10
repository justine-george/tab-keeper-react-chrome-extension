import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { localeStrings } from './fixtures/locales';
import { waitForFontsLoaded } from './fixtures/fonts';

// KAN-205. The save row's bottom edge meets the session header card's. This
// was the search row's job while the search was a mode in the same place
// (KAN-385).
//
// The two panes are sized independently, so the edges meet only because the
// row is built to the card's measure: two of its caption lines plus 26px
// (KAN-492). This fails loudly when something moves either side: a title that
// starts wrapping, a change to either pane's padding, or a nudge to the scale.
//
// An e2e test rather than a component one: neither pane knows about the other,
// so only the assembled popup can say whether their edges meet.

// Chrome's Small, Medium, Large and Very large (KAN-492). Very small (9px) is
// left out: there the card's icon row stops shrinking and the left header's
// does not, so the edges part by up to 2.5px.
const ROOTS = [12, 16, 20, 24] as const;

async function openPopupAt(
  context: BrowserContext,
  extensionId: string,
  rootPx: number
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's0',
    title: 'Pull requests · justine-george/tab-keeper-react',
    isSelected: true,
    windowCount: 2,
    tabCount: 47,
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's0',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('input#name')).toBeVisible();
  await waitForFontsLoaded(page);
  await page.evaluate((px) => {
    document.documentElement.style.fontSize = `${px}px`;
  }, rootPx);
  return page;
}

for (const rootPx of ROOTS) {
  test(`at a ${rootPx}px root, the save row and the session header end on the same line`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopupAt(context, extensionId, rootPx);

    const edges = await page.evaluate(() => {
      const input = document.querySelector('input#name');
      if (input === null) throw new Error('no name box');
      const add = document.querySelector('[aria-label^="Add current window"]');
      if (add === null) throw new Error('no Add current window button');
      // The card is the first ancestor of the add button that draws a border;
      // width alone finds the action strip, which is full width too.
      let card = add.parentElement;
      while (card && getComputedStyle(card).borderTopWidth === '0px') {
        card = card.parentElement;
      }
      if (card === null) throw new Error('no bordered header card');
      return {
        saveRow: input.getBoundingClientRect().bottom,
        headerCard: card.getBoundingClientRect().bottom,
      };
    });

    // A pixel of slack, no more: 2px is what it looked like before, and that
    // read as a mistake rather than as a choice.
    expect(Math.abs(edges.saveRow - edges.headerCard)).toBeLessThanOrEqual(1);
  });
}

// KAN-492. The row's height comes from its own column, not from the card, so
// it does not move when the first save brings the card in.
test('at a 20px root, the save row keeps its height when the first save brings in the session header', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer([]));
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('input#name')).toBeVisible();
  await waitForFontsLoaded(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px';
  });
  const rowHeight = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-save-row]')?.getBoundingClientRect()
          .height ?? null
    );
  const card = page.locator('[aria-label^="Add current window"]');

  // PREMISE: an empty list, so no session header card.
  await expect(page.getByText('Saved sessions appear here.')).toBeVisible();
  await expect(card).toHaveCount(0);
  const before = await rowHeight();

  const saveAll = localeStrings('en')['Save every open window as a session'];
  await page.getByRole('button', { name: saveAll, exact: true }).click();
  await expect(card).toBeVisible();
  const after = await rowHeight();

  // 64 at Large: taller than the 58 the row has at the default root.
  expect(before).toBeCloseTo(64, 0);
  expect(after).toBeCloseTo(before ?? NaN, 1);
});

// KAN-492 in the tab view: each column's list box starts on one line, the
// saved list's (left), the session's (middle) and Open now's (right).
for (const rootPx of ROOTS) {
  test(`tab view at a ${rootPx}px root: the three list boxes start on one line`, async ({
    context,
    extensionId,
  }) => {
    const session = buildSession({
      tabGroupId: 's0',
      title: 'Reading list',
      isSelected: true,
    });
    await seedSessions(context, {
      ...buildContainer([session]),
      selectedTabGroupId: 's0',
    });
    await seedSettings(context, { foldSavedSessionInTabView: false });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1180, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await page.locator('input[aria-label="Search open tabs"]').waitFor();
    await waitForFontsLoaded(page);
    await page.evaluate((px) => {
      document.documentElement.style.fontSize = `${px}px`;
    }, rootPx);

    const tops = await page.evaluate(() => {
      // A list box is the bordered frame its search row (or, in the middle,
      // its first window row) sits in.
      const frameOf = (el: Element | null) => {
        let box = el?.parentElement ?? null;
        while (box && getComputedStyle(box).borderTopWidth === '0px') {
          box = box.parentElement;
        }
        if (box === null) throw new Error('no bordered list box');
        return box.getBoundingClientRect().top;
      };
      const detail = document.querySelector('[data-pane="detail"]');
      const header = detail?.querySelector('[data-session-toolbar]');
      if (!detail || !header) throw new Error('no session header');
      // The middle list box is the first bordered box below the header card.
      const below = [...detail.querySelectorAll('*')].find(
        (el) =>
          getComputedStyle(el).borderTopWidth !== '0px' &&
          el.getBoundingClientRect().top > header.getBoundingClientRect().bottom
      );
      if (below === undefined) throw new Error('no middle list box');
      return {
        left: frameOf(document.querySelector('[data-saved-search]')),
        middle: below.getBoundingClientRect().top,
        right: frameOf(
          document.querySelector('input[aria-label="Search open tabs"]')
        ),
      };
    });

    expect(Math.abs(tops.left - tops.middle)).toBeLessThanOrEqual(1);
    expect(Math.abs(tops.right - tops.middle)).toBeLessThanOrEqual(1);
  });
}

// KAN-216, on the one row left beside the name box: the search panel's box and
// button are gone (KAN-385), and the save group must span the box's height as
// the search button had to.
for (const rootPx of ROOTS) {
  test(`at a ${rootPx}px root, the save group and its menu trigger are exactly as tall as the name box`, async ({
    context,
    extensionId,
  }) => {
    const page = await openPopupAt(context, extensionId, rootPx);

    // The key is not the en string (the button reads "Save all open windows...").
    const saveAll = localeStrings('en')['Save every open window as a session'];
    const edges = await page.evaluate((label: string) => {
      const box = document.querySelector('input#name');
      // The group is the save button's bordered parent.
      const group = document.querySelector(
        `button[aria-label="${label}"]`
      )?.parentElement;
      const trigger = document.querySelector(
        '[data-save-row] [aria-label="More actions"]'
      );
      if (!box || !group || !trigger) return null;
      const a = box.getBoundingClientRect();
      const b = group.getBoundingClientRect();
      const c = trigger.getBoundingClientRect();
      return {
        groupBorder: getComputedStyle(group).borderTopWidth,
        box: { top: a.top, bottom: a.bottom },
        group: { top: b.top, bottom: b.bottom },
        trigger: { top: c.top, bottom: c.bottom },
      };
    }, saveAll);
    if (edges === null) throw new Error('no name box, save group or trigger');

    // PREMISE: the right element, or a match proves nothing.
    expect(edges.groupBorder).toBe('1px');
    expect(edges.group.top).toBeCloseTo(edges.box.top, 0);
    expect(edges.group.bottom).toBeCloseTo(edges.box.bottom, 0);
    // The trigger fills the group inside its border, so its divider and its
    // hover fill run the row's full height.
    expect(edges.trigger.top).toBeCloseTo(edges.group.top + 1, 0);
    expect(edges.trigger.bottom).toBeCloseTo(edges.group.bottom - 1, 0);
  });
}

// KAN-385 S3. The magnifier's ink sits on the text edge the session rows
// pad to, and the search text starts where every session title starts. At a
// 16px and a 20px root (Chrome's "Large"), in both views.
const POPUP = { width: 790, height: 550 };
const TAB = { width: 1280, height: 800 };
const TITLES = ['Alpha session', 'Beta session'];

async function openSaved(
  context: BrowserContext,
  extensionId: string,
  view: 'popup' | 'tab',
  rootPx: 16 | 20
): Promise<Page> {
  await seedSessions(
    context,
    buildContainer(
      TITLES.map((title, i) => buildSession({ tabGroupId: `s${i}`, title }))
    )
  );
  const page = await context.newPage();
  await page.setViewportSize(view === 'popup' ? POPUP : TAB);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${
      view === 'tab' ? '?view=tab' : ''
    }`
  );
  await page.locator('[data-saved-search] input').waitFor();
  await waitForFontsLoaded(page);
  await page.evaluate((px) => {
    document.documentElement.style.fontSize = `${px}px`;
  }, rootPx);
  await page.mouse.move(2, (view === 'popup' ? POPUP : TAB).height - 2);
  return page;
}

// The frame's inner left edge (inside its border), the input's text left and
// each session title's left, from the viewport.
async function columns(page: Page) {
  return page.evaluate((titles: string[]) => {
    const row = document.querySelector('[data-saved-search]');
    if (row === null) throw new Error('no saved search row');
    const frame = row.parentElement;
    if (frame === null) throw new Error('the search row has no list frame');
    const input = row.querySelector('input');
    if (input === null) throw new Error('the search row has no input');
    const frameRect = frame.getBoundingClientRect();
    return {
      frameInnerLeft: frameRect.left + frame.clientLeft,
      rowTop: row.getBoundingClientRect().top,
      rowHeight: row.getBoundingClientRect().height,
      inputTextLeft:
        input.getBoundingClientRect().left +
        parseFloat(getComputedStyle(input).paddingLeft),
      titleLefts: titles.map((title) => {
        const label = [
          ...document.querySelectorAll(`button[aria-label="${title}"] *`),
        ].find((el) => el.children.length === 0 && el.textContent === title);
        if (label === undefined) throw new Error(`no title label "${title}"`);
        return label.getBoundingClientRect().left;
      }),
    };
  }, TITLES);
}

// First column, from `left`, holding a pixel that differs from the clip's
// top-left (the row's ground) by more than 16 on any channel.
async function firstInkX(page: Page, left: number, top: number, h: number) {
  const x0 = Math.floor(left);
  const png = (
    await page.screenshot({ clip: { x: x0, y: top, width: 48, height: h } })
  ).toString('base64');
  const col = await page.evaluate(async (data: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const ground = [px[0], px[1], px[2]];
    for (let x = 0; x < img.width; x++) {
      // Above the row's bottom divider, which spans every column.
      for (let y = 0; y < img.height - 4; y++) {
        const i = (y * img.width + x) * 4;
        if ([0, 1, 2].some((c) => Math.abs(px[i + c] - ground[c]) > 16)) {
          return x;
        }
      }
    }
    return null;
  }, png);
  if (col === null) throw new Error('no ink in the clip');
  return x0 + col;
}

test.describe("the saved search row's columns (KAN-385 S3)", () => {
  for (const view of ['popup', 'tab'] as const) {
    for (const rootPx of [16, 20] as const) {
      test(`${view} at a ${rootPx}px root: the search text starts where every session title starts`, async ({
        context,
        extensionId,
      }) => {
        const page = await openSaved(context, extensionId, view, rootPx);
        const c = await columns(page);

        expect(c.titleLefts).toHaveLength(TITLES.length);
        // Boxes, so LayoutUnit (1/64px).
        for (const titleLeft of c.titleLefts) {
          expect(Math.abs(c.inputTextLeft - titleLeft)).toBeLessThanOrEqual(
            1 / 64
          );
        }
        // Past the magnifier's ink (3/24..21/24 of ICON.SMALL) and 10px.
        expect(c.inputTextLeft - c.frameInnerLeft).toBeCloseTo(
          8 + rootPx * 1.25 * (18 / 24) + 10,
          3
        );
        if (view === 'popup' && rootPx === 16) {
          expect(c.inputTextLeft).toBeCloseTo(43, 1);
        }
      });

      test(`${view} at a ${rootPx}px root: the magnifier's ink sits on the 8px text edge`, async ({
        context,
        extensionId,
      }) => {
        const page = await openSaved(context, extensionId, view, rootPx);
        const c = await columns(page);
        const ink = await firstInkX(
          page,
          c.frameInnerLeft,
          c.rowTop,
          c.rowHeight
        );
        // Ink lands on device pixels: 1px.
        expect(Math.abs(ink - (c.frameInnerLeft + 8))).toBeLessThanOrEqual(1);

        // Control: the scan follows the glyph, so it can see a wrong inset.
        await page.evaluate(() => {
          const glass = document.querySelector('[data-saved-search] span');
          if (!(glass instanceof HTMLElement)) throw new Error('no glass span');
          glass.style.marginLeft = 'calc(8px + 4px)';
        });
        const moved = await firstInkX(
          page,
          c.frameInnerLeft,
          c.rowTop,
          c.rowHeight
        );
        expect(moved).toBeGreaterThan(ink + 2);
      });
    }
  }
});

// N1. While the saved search holds text the row is the name field alone, at
// the row's full width, and Enter in it saves nothing until the search clears.
test('while searching, the name field spans the save row and Enter saves nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', 16);
  const sessions = page.locator(`button[aria-label="${TITLES[0]}"]`);
  await expect(sessions).toHaveCount(1);

  const box = async () =>
    page.evaluate(() => {
      const input = document.querySelector('input#name');
      const row = input?.parentElement;
      if (!input || !row) throw new Error('no name field or save row');
      const a = input.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      return { left: a.left - b.left, right: b.right - a.right };
    });

  // PREMISE: with no search the buttons take the row's right side.
  expect((await box()).right).toBeGreaterThan(80);

  await page.locator('[data-saved-search] input').fill('alpha');
  await page.locator('input#name').fill('Searching name');
  await page.locator('input#name').press('Enter');

  const spans = await box();
  expect(Math.abs(spans.left)).toBeLessThanOrEqual(1 / 64);
  expect(Math.abs(spans.right)).toBeLessThanOrEqual(1 / 64);

  // A save would show once the filter lifts.
  await page.locator('[data-saved-search] input').fill('');
  await expect(page.locator('input#name')).toHaveValue('Searching name');
  await expect(page.locator('button[aria-label="Searching name"]')).toHaveCount(
    0
  );
  await expect(
    page.locator(
      `button[aria-label="${TITLES[0]}"], button[aria-label="${TITLES[1]}"]`
    )
  ).toHaveCount(TITLES.length);

  // CONTROL: with the search cleared, the same Enter saves.
  await page.locator('input#name').press('Enter');
  await expect(
    page.locator('button[aria-label="Searching name"]')
  ).toBeVisible();
});
