import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { S1, S2, S3, S4, seed } from './fixtures/betweenSessions';
import { POPUP } from './fixtures/onboarding';
import { seedSettings } from './fixtures/seed';
import { contrast, pixelsAt, rgbToHex } from './fixtures/pixels';
import { CHALK_THEME, CHARCOAL_THEME } from '../src/hooks/useThemeColors';

// KAN-747. No line between the panes: each gap is 8px of space, the popup's
// own outer margin, and the tab view's resize handles sit in it. KAN-790: each
// handle is three dots, so it no longer reads as the scrollbar beside it.

const GAP = 8;

async function open(
  context: BrowserContext,
  extensionId: string,
  view: 'popup' | 'tab',
  viewport: { width: number; height: number },
  settings: Record<string, unknown> = {}
): Promise<Page> {
  await seed(context, [S1(), S2(), S3(), S4()], 'S1');
  await seedSettings(context, {
    theme: 'Chalk',
    foldSavedSessionInTabView: false,
    ...settings,
  });
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${view === 'tab' ? '?view=tab' : ''}`
  );
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

// Each pane's border box, its borders, and its content box: the pane's child minus that child's padding.
function panes(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-pane]')].map((el) => {
        const cs = getComputedStyle(el);
        const inner = el.firstElementChild as HTMLElement;
        const ics = getComputedStyle(inner);
        const ir = inner.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return [
          el.dataset.pane!,
          {
            left: r.left,
            right: r.right,
            borderLeft: cs.borderLeftWidth,
            borderRight: cs.borderRightWidth,
            borderTop: cs.borderTopWidth,
            contentLeft: ir.left + parseFloat(ics.paddingLeft),
            contentRight: ir.right - parseFloat(ics.paddingRight),
          },
        ];
      })
    )
  );
}

test('popup: no line between the list and the session, an 8px gap, and the session 9px wider', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'popup', POPUP);
  const p = await panes(page);
  expect(p.sessions.borderRight).toBe('0px');
  expect(p.detail.borderLeft).toBe('0px');
  expect(p.detail.contentLeft - p.sessions.contentRight).toBe(GAP);
  // The outer frame stays.
  expect(p.sessions.borderLeft).toBe('1px');
  expect(p.detail.borderRight).toBe('1px');
  expect(p.detail.borderTop).toBe('1px');
  // Today's session content was 364.5..781; the 9px comes off its left.
  expect(p.detail.contentRight).toBe(POPUP.width - 9);
  expect(p.detail.contentRight - p.detail.contentLeft).toBe(781 - 364.5 + 9);
});

test('tab view: both lines go, each gap is 8px, and the session is 540px at 1440', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'tab', {
    width: 1440,
    height: 900,
  });
  const p = await panes(page);
  expect(p.detail.borderLeft).toBe('0px');
  expect(p.detail.borderRight).toBe('0px');
  expect(p['open-now'].borderLeft).toBe('0px');
  expect(p.detail.contentLeft - p.sessions.contentRight).toBe(GAP);
  expect(p['open-now'].contentLeft - p.detail.contentRight).toBe(GAP);
  expect(p.detail.contentRight - p.detail.contentLeft).toBe(540);
  // The window's frame stays.
  expect(p.sessions.borderLeft).toBe('1px');
  expect(p['open-now'].borderRight).toBe('1px');
});

test('folded: no line between the list and Open now, an 8px gap', async ({
  context,
  extensionId,
}) => {
  const page = await open(
    context,
    extensionId,
    'tab',
    { width: 1440, height: 900 },
    { foldSavedSessionInTabView: true }
  );
  const p = await panes(page);
  expect(p.detail).toBeUndefined();
  expect(p['open-now'].borderLeft).toBe('0px');
  expect(p['open-now'].contentLeft - p.sessions.contentRight).toBe(GAP);
  expect(p['open-now'].borderRight).toBe('1px');
});

test('under 1100px: no line before the rail, 8px to it, and the rail is not covered', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'tab', {
    width: 1000,
    height: 800,
  });
  const p = await panes(page);
  expect(p.detail.borderRight).toBe('0px');
  expect(p.detail.contentLeft - p.sessions.contentRight).toBe(GAP);
  // The rail has no padding of its own: the gap is to its edge.
  expect(p['open-now'].left - p.detail.contentRight).toBe(GAP);
  const rail = page.locator('[data-pane="open-now"] button').first();
  const b = (await rail.boundingBox())!;
  expect(
    await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('button') !== null,
      [b.x + 2, b.y + b.height / 2]
    )
  ).toBe(true);
});

// His pick, 04:29: Settings matches. Its right edge is the window's, so that border stays.
for (const [view, viewport] of [
  ['popup', POPUP],
  ['tab', { width: 1440, height: 900 }],
] as const) {
  test(`Settings (${view}): no line between its panes, an 8px gap`, async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, view, viewport);
    await page.locator('[aria-label="Settings"]').click();
    await page.locator('button[aria-label="Display"]').waitFor();
    const p = await panes(page);
    expect(p.detail.borderLeft).toBe('0px');
    expect(p.detail.contentLeft - p.sessions.contentRight).toBe(GAP);
    expect(p.detail.borderRight).toBe('1px');
    expect(p.detail.contentRight).toBe(viewport.width - 9);
  });
}

// Each pane's box is its column: the gap is padding, not an overlap.
test('every pane box is its own column, with nothing overlapping', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'tab', {
    width: 1440,
    height: 900,
  });
  const p = await panes(page);
  expect(p.detail.left).toBe(p.sessions.right);
  expect(p['open-now'].left).toBe(p.detail.right);
});

// ---- the handles ------------------------------------------------------------

const GRIPS = {
  list: '[data-list-resize-grip]',
  openNow: '[data-resize-grip]',
} as const;

// The handle's mark: its box (transform included), its dots' colour, its centre.
function mark(page: Page, sel: string) {
  return page.locator(sel).evaluate((g) => {
    const p = g.firstElementChild as HTMLElement;
    const r = p.getBoundingClientRect();
    const gr = g.getBoundingClientRect();
    return {
      gripLeft: gr.left,
      gripRight: gr.right,
      width: r.width,
      height: r.height,
      top: r.top,
      bottom: r.bottom,
      centre: r.left + r.width / 2,
      colour: getComputedStyle(p).color,
      children: p.childElementCount,
    };
  });
}

// How many separate marks are PAINTED down the handle's centre line: a run is
// pixels unlike the gap's own, read 6px above the mark. The pill was one run.
async function inkRuns(page: Page, sel: string) {
  const m = await mark(page, sel);
  const ys: number[] = [];
  for (let y = Math.floor(m.top) - 6; y <= Math.ceil(m.bottom) + 2; y++)
    ys.push(y);
  const [ground, ...column] = await pixelsAt(page, [
    [m.centre, m.top - 6],
    ...ys.map((y): [number, number] => [m.centre, y]),
  ]);
  let runs = 0;
  let inRun = false;
  for (const colour of column) {
    const ink = contrast(colour, ground) > 1.15;
    if (ink && !inRun) runs++;
    inRun = ink;
  }
  return { runs, ground };
}

for (const [theme, palette] of [
  ['Chalk', CHALK_THEME],
  ['Charcoal', CHARCOAL_THEME],
] as const) {
  test(`${theme}: each handle is three dots centred in its gap, larger in the text colour on hover`, async ({
    context,
    extensionId,
  }) => {
    const page = await open(
      context,
      extensionId,
      'tab',
      { width: 1440, height: 900 },
      { theme }
    );
    const p = await panes(page);
    const gaps = {
      list: [p.sessions.contentRight, p.detail.contentLeft],
      openNow: [p.detail.contentRight, p['open-now'].contentLeft],
    } as const;
    for (const which of ['list', 'openNow'] as const) {
      const [from, to] = gaps[which];
      const rest = await mark(page, GRIPS[which]);
      expect(rest, which).toMatchObject({ width: 4, height: 20, children: 0 });
      // CONTROL: the line read 6px above the mark is the gap's own ground.
      const { runs, ground } = await inkRuns(page, GRIPS[which]);
      expect(ground, which).toBe(palette.PRIMARY_COLOR);
      expect(runs, which).toBe(3);
      expect(rgbToHex(rest.colour), which).toBe(palette.LABEL_L3_COLOR);
      // Findable before it is hovered: 3:1 on the pane, as a control needs (WCAG 1.4.11).
      expect(
        contrast(rgbToHex(rest.colour), palette.PRIMARY_COLOR),
        which
      ).toBeGreaterThanOrEqual(3);
      expect(Math.abs(rest.centre - (from + to) / 2), which).toBeLessThan(0.5);
      // The grab strip: 12px, 2px past each side of the gap.
      expect(rest.gripLeft, which).toBe(from - 2);
      expect(rest.gripRight, which).toBe(to + 2);

      const g = (await page.locator(GRIPS[which]).boundingBox())!;
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await expect
        .poll(async () => {
          const h = await mark(page, GRIPS[which]);
          return [h.height, rgbToHex(h.colour)];
        })
        .toEqual([23, palette.TEXT_COLOR]);
      expect((await inkRuns(page, GRIPS[which])).runs, which).toBe(3);
      await page.mouse.move(5, 5);
      await expect
        .poll(async () => (await mark(page, GRIPS[which])).height)
        .toBe(20);
    }
  });
}

test('keyboard focus and a drag both draw the larger dots', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'tab', {
    width: 1440,
    height: 900,
  });
  const grip = page.locator(GRIPS.openNow);
  await grip.focus();
  // Focus by script is not key navigation: press Tab back and forth onto it.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(grip).toBeFocused();
  await expect
    .poll(async () => (await mark(page, GRIPS.openNow)).height)
    .toBe(23);
  // The ring goes round the dots.
  expect(
    await grip.evaluate(
      (g) => getComputedStyle(g.firstElementChild as HTMLElement).outlineStyle
    )
  ).toBe('solid');

  await grip.blur();
  await page.mouse.move(5, 5);
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  // Off the grip, still dragging: the dots stay larger.
  await page.mouse.move(g.x - 60, g.y + g.height / 2, { steps: 4 });
  await expect
    .poll(async () => (await mark(page, GRIPS.openNow)).height)
    .toBe(23);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

// KAN-791. While a grip is in use, a 2px line runs the gap's full height.
// Read 150px below the grip's top, well clear of the dots in its middle.
async function line(page: Page, sel: string) {
  const g = (await page.locator(sel).boundingBox())!;
  const x = g.x + g.width / 2;
  const [painted] = await pixelsAt(page, [[x, g.y + 150]]);
  const style = await page.locator(sel).evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return {
      opacity: s.opacity,
      delay: s.transitionDelay,
      duration: s.transitionDuration,
      width: s.width,
      height: parseFloat(s.height),
      gripHeight: el.getBoundingClientRect().height,
      pointerEvents: s.pointerEvents,
    };
  });
  return { painted, ...style };
}

for (const [theme, palette] of [
  ['Chalk', CHALK_THEME],
  ['Charcoal', CHARCOAL_THEME],
] as const) {
  test(`${theme}: a hover held past 300ms draws a 2px line down each grip, and leaving takes it away`, async ({
    context,
    extensionId,
  }) => {
    const page = await open(
      context,
      extensionId,
      'tab',
      { width: 1440, height: 900 },
      { theme }
    );
    for (const which of ['list', 'openNow'] as const) {
      const rest = await line(page, GRIPS[which]);
      // At rest the gap is bare: its pixels are the pane colour.
      expect(rest.painted, which).toBe(palette.PRIMARY_COLOR);
      expect(rest.opacity, which).toBe('0');

      const m = await mark(page, GRIPS[which]);
      await page.mouse.move(m.centre, (m.top + m.bottom) / 2);
      // Waits before it shows, so a pointer crossing the gap draws nothing.
      expect((await line(page, GRIPS[which])).delay, which).toBe('0.3s');
      await expect
        .poll(async () => {
          const l = await line(page, GRIPS[which]);
          return contrast(l.painted, palette.PRIMARY_COLOR) > 1.15;
        })
        .toBe(true);
      const shown = await line(page, GRIPS[which]);
      expect(shown, which).toMatchObject({
        opacity: '1',
        width: '2px',
        pointerEvents: 'none',
      });
      expect(shown.height, which).toBe(shown.gripHeight);

      await page.mouse.move(5, 5);
      // Gone with no wait.
      expect((await line(page, GRIPS[which])).delay, which).toBe('0s');
      await expect
        .poll(async () => (await line(page, GRIPS[which])).painted)
        .toBe(palette.PRIMARY_COLOR);
    }
  });
}

test('keyboard focus and a drag draw the line at once', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'tab', {
    width: 1440,
    height: 900,
  });
  const grip = page.locator(GRIPS.openNow);
  await grip.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(grip).toBeFocused();
  expect((await line(page, GRIPS.openNow)).delay).toBe('0s');
  await expect
    .poll(async () => (await line(page, GRIPS.openNow)).opacity)
    .toBe('1');

  await grip.blur();
  await page.mouse.move(5, 5);
  await expect
    .poll(async () => (await line(page, GRIPS.openNow)).opacity)
    .toBe('0');
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  // Pressed: no wait, even though the pointer is also hovering.
  expect((await line(page, GRIPS.openNow)).delay).toBe('0s');
  // Off the grip, still dragging: the line stays.
  await page.mouse.move(g.x - 60, g.y + g.height / 2, { steps: 4 });
  await expect
    .poll(async () => (await line(page, GRIPS.openNow)).opacity)
    .toBe('1');
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('with Reduce motion on, the line does not fade, and the hover still waits', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'tab', {
    width: 1440,
    height: 900,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const m = await mark(page, GRIPS.openNow);
  await page.mouse.move(m.centre, (m.top + m.bottom) / 2);
  const l = await line(page, GRIPS.openNow);
  expect(l.duration).toBe('0s');
  expect(l.delay).toBe('0.3s');
});
