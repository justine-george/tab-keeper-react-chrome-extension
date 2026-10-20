import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import {
  FULL,
  FULL_VIEW_PATH,
  openFullView,
  openPage,
  openPopup,
  twoFrames,
} from './fixtures/onboarding';
import { escapesPrevented, watchEscapes } from './fixtures/escapeProbe';
import { rgbToHex } from './fixtures/pixels';
import { standIn } from './fixtures/standInPages';
import { openSaved, savedWindow, session } from './fixtures/savedWindows';
import { pickUp, tabHandle } from './fixtures/sessionDrag';
import {
  POPUP_RUN,
  cardAt,
  cardButton,
  landedAt,
  nextTo,
  openRunFromHelp,
} from './fixtures/run';
import { DARKENHEIMER_THEME, LIGHT_THEME } from '../src/hooks/useThemeColors';

// KAN-695. The app's own tooltip chip in the built extension: its look, timing,
// placement, stacking and keys, and that no native `title` tooltip is left.

const GAP = 6;
const INSET = 8;
const MAX_WIDTH = 260;
// A session title the popup's list must cut off.
const LONG_TITLE = 'Lisbon '
  .concat('and a long title that goes on '.repeat(5))
  .slice(0, 120);

const CHIP = '[data-tooltip-chip]';
const chip = (page: Page) => page.locator(CHIP);
// Found by role and name, not by data-tooltip, so a build without the chip fails on the chip.
const button = (page: Locator | Page, name: string) =>
  page.getByRole('button', { name, exact: true });
// A plain element's own text, and the tooltip anchor that holds it.
const textIn = (scope: Locator, text: string) =>
  scope.getByText(text, { exact: true }).first();
const anchorOf = (loc: Locator) =>
  loc.locator('xpath=ancestor-or-self::*[@data-tooltip][1]');

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

async function rectOf(loc: Locator): Promise<Rect> {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  });
}

const viewportOf = (page: Page) =>
  page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));

// Off every control, and long enough past any hide that the next wait is the first one (500 ms warm window).
async function pointerAway(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(chip(page)).toHaveCount(0);
  await page.waitForTimeout(600);
}

// Rests the pointer on `loc` until its chip shows `text`.
async function restOn(loc: Locator, text: string): Promise<Locator> {
  const page = loc.page();
  await pointerAway(page);
  await loc.hover();
  await expect(chip(page)).toHaveText(text);
  return chip(page);
}

/**
 * From now on, counts every chip the page inserts and stamps when, against
 * the last pointerover onto a control and the last keydown: a MutationObserver
 * sees a chip that lived for less than a frame, which a poll would miss.
 */
async function watchChips(page: Page): Promise<void> {
  await page.evaluate(() => {
    const overs: number[] = [];
    const log = { inserted: 0, insertedAt: -1, overAt: -1, keyAt: -1, overs };
    Object.defineProperty(globalThis, '__chips', {
      value: log,
      configurable: true,
    });
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node instanceof Element && node.matches('[data-tooltip-chip]')) {
            log.inserted += 1;
            log.insertedAt = performance.now();
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener(
      'pointerover',
      (e) => {
        // A named control: every tooltip anchor these tests point at has a name.
        if (e.target instanceof Element && e.target.closest('[aria-label]')) {
          log.overAt = performance.now();
          log.overs.push(log.overAt);
        }
      },
      true
    );
    document.addEventListener(
      'keydown',
      () => {
        log.keyAt = performance.now();
      },
      true
    );
  });
}

interface ChipLog {
  inserted: number;
  insertedAt: number;
  overAt: number;
  keyAt: number;
  overs: number[];
}

const chipLog = (page: Page): Promise<ChipLog> =>
  page.evaluate(() => {
    const log: unknown = Reflect.get(globalThis, '__chips');
    if (typeof log !== 'object' || log === null)
      throw new Error('no chip watch');
    const num = (k: string) => Number(Reflect.get(log, k));
    const overs: unknown = Reflect.get(log, 'overs');
    return {
      inserted: num('inserted'),
      insertedAt: num('insertedAt'),
      overAt: num('overAt'),
      keyAt: num('keyAt'),
      overs: Array.isArray(overs) ? overs.map(Number) : [],
    };
  });

// What sits on top at the chip's centre and four corners (1 px in), with the chip hit-testable for the read.
async function chipOnTop(page: Page): Promise<boolean[]> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-tooltip-chip]');
    if (!(el instanceof HTMLElement)) throw new Error('no chip');
    el.style.pointerEvents = 'auto';
    const r = el.getBoundingClientRect();
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 1, r.top + 1],
      [r.right - 1, r.top + 1],
      [r.left + 1, r.bottom - 1],
      [r.right - 1, r.bottom - 1],
    ];
    const hits = points.map(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return top !== null && el.contains(top);
    });
    el.style.pointerEvents = '';
    return hits;
  });
}

// The Chrome-wide font size "Large" (R1): every rem in the page follows the root.
async function setRootFontSize(page: Page, size: string): Promise<void> {
  await page.evaluate((s) => {
    document.documentElement.style.fontSize = s;
  }, size);
  await twoFrames(page);
}

test.describe('look', () => {
  for (const [theme, colors] of [
    ['Light', LIGHT_THEME],
    ['Darkenheimer', DARKENHEIMER_THEME],
  ] as const) {
    test(`an ink chip in ${theme}: text colour fill, page colour text, square, no shadow, 0.8rem`, async ({
      context,
      extensionId,
    }) => {
      await seedSessions(context);
      await seedSettings(context, { theme });
      const page = await openPopup(context, extensionId);
      const shown = await restOn(button(page, 'Settings'), 'Settings');
      const look = await shown.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          color: s.color,
          radius: s.borderRadius,
          shadow: s.boxShadow,
          border: s.borderTopWidth,
          fontSize: parseFloat(s.fontSize),
          root: parseFloat(getComputedStyle(document.documentElement).fontSize),
          hidden: el.getAttribute('aria-hidden'),
        };
      });
      expect(rgbToHex(look.background)).toBe(colors.TEXT_COLOR);
      expect(rgbToHex(look.color)).toBe(colors.PRIMARY_COLOR);
      expect(look.radius).toBe('0px');
      expect(look.shadow).toBe('none');
      expect(look.border).toBe('0px');
      expect(look.fontSize).toBeCloseTo(0.8 * look.root, 2);
      expect(look.hidden).toBe('true');
    });
  }
});

test.describe('timing', () => {
  test('a resting pointer shows the chip after 300 ms: absent at 250, present by 400', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    await pointerAway(page);
    await watchChips(page);
    const box = await rectOf(button(page, 'Settings'));
    await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
    await expect(chip(page)).toHaveText('Settings');
    const log = await chipLog(page);
    expect(log.inserted).toBe(1);
    const waited = log.insertedAt - log.overAt;
    // Not before the 300 ms wait (so absent at 250), and well before 400.
    expect(waited).toBeGreaterThanOrEqual(299);
    expect(waited).toBeLessThanOrEqual(400);
  });

  test('a sweep across the six toolbar buttons at 50 ms each leaves no chip, and resting then shows one', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    await pointerAway(page);
    await watchChips(page);
    const toolbar = [
      'Open full view',
      'Sort sessions',
      'Undo',
      'Redo',
      'Sync now',
      'Settings',
    ];
    const centres = [];
    for (const name of toolbar) {
      const b = await rectOf(button(page, name));
      centres.push([b.left + b.width / 2, b.top + b.height / 2]);
    }
    // Every frame of the sweep, sampled in the page.
    await page.evaluate(() => {
      const frames: boolean[] = [];
      Object.defineProperty(globalThis, '__frames', {
        value: frames,
        configurable: true,
      });
      const tick = () => {
        frames.push(document.querySelector('[data-tooltip-chip]') !== null);
        if (frames.length < 10_000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    for (const [x, y] of centres.slice(0, -1)) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(50);
    }
    const [lastX, lastY] = centres[centres.length - 1];
    await page.mouse.move(lastX, lastY);
    const swept = await chipLog(page);
    const frames = await page.evaluate(() => {
      const f: unknown = Reflect.get(globalThis, '__frames');
      return Array.isArray(f) ? f.map(Boolean) : [];
    });
    // PREMISE: the pointer reached all six, each well inside the first wait.
    expect(swept.overs).toHaveLength(6);
    const dwell = swept.overs.slice(1).map((t, i) => t - swept.overs[i]);
    expect(Math.max(...dwell)).toBeLessThan(250);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.some(Boolean)).toBe(false);
    expect(swept.inserted).toBe(0);
    // CONTROL: the layer is live; resting on the last one shows its chip.
    await expect(chip(page)).toHaveText('Settings');
  });

  test('under reduced motion the chip is fully opaque on its first frame; without, it fades in', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    // The opacity the chip has when it enters the DOM, before any frame is painted.
    const firstOpacity = async (): Promise<number> => {
      await pointerAway(page);
      await page.evaluate(() => {
        const seen: number[] = [];
        Object.defineProperty(globalThis, '__opacity', {
          value: seen,
          configurable: true,
        });
        new MutationObserver((records, observer) => {
          for (const r of records)
            for (const node of r.addedNodes)
              if (
                node instanceof Element &&
                node.matches('[data-tooltip-chip]')
              ) {
                seen.push(Number(getComputedStyle(node).opacity));
                observer.disconnect();
              }
        }).observe(document.body, { childList: true, subtree: true });
      });
      await button(page, 'Settings').hover();
      await expect(chip(page)).toHaveText('Settings');
      return page.evaluate(() => {
        const seen: unknown = Reflect.get(globalThis, '__opacity');
        return Array.isArray(seen) ? Number(seen[0]) : NaN;
      });
    };
    // CONTROL: with motion allowed the same read sees the fade start below 1.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await firstOpacity()).toBeLessThan(0.5);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await firstOpacity()).toBe(1);
    expect(await chip(page).evaluate((el) => el.getAnimations().length)).toBe(
      0
    );
  });
});

test.describe('placement', () => {
  test('a header control: below it, 6 px away, centred on it', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    const control = button(page, 'Settings');
    const at = await rectOf(await restOn(control, 'Settings'));
    const of = await rectOf(control);
    expect(Math.abs(at.top - (of.bottom + GAP))).toBeLessThanOrEqual(1);
    const centre = (r: Rect) => r.left + r.width / 2;
    expect(Math.abs(centre(at) - centre(of))).toBeLessThanOrEqual(1);
  });

  test("Switch's long description wraps at 260 px onto two lines", async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    const text = 'Close current windows and open this session';
    const shown = await restOn(
      button(page.locator('[data-pane="sessions"]'), 'Switch'),
      text
    );
    const lines = await shown.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(
        [...range.getClientRects()].map((r) => Math.round(r.top))
      );
      return {
        width: el.getBoundingClientRect().width,
        lines: tops.size,
      };
    });
    expect(lines.width).toBeLessThanOrEqual(MAX_WIDTH);
    expect(lines.width).toBeGreaterThan(MAX_WIDTH - 1);
    expect(lines.lines).toBe(2);
  });

  for (const root of ['16px', '20px'] as const) {
    test.describe(`at a ${root} root font`, () => {
      // No shipped control's chip reaches the left inset in the popup (measured: 61 px at 16px, 63 at 20px); the right edge proves the clamp.
      test('the leftmost control: its longest chip stays 8 px or more inside the left edge', async ({
        context,
        extensionId,
      }) => {
        expect(LONG_TITLE).toHaveLength(120);
        await seedSessions(
          context,
          buildContainer([
            buildSession({ tabGroupId: 'S1', title: LONG_TITLE }),
          ])
        );
        const page = await openPopup(context, extensionId);
        await setRootFontSize(page, root);
        const title = textIn(
          page.locator('[data-pane="sessions"]'),
          LONG_TITLE
        );
        await pointerAway(page);
        await title.hover({ position: { x: 4, y: 4 } });
        await expect(chip(page)).toHaveText(LONG_TITLE);
        const at = await rectOf(chip(page));
        const of = await rectOf(anchorOf(title));
        // PREMISE: it is the leftmost control, and its chip is as wide as a chip gets.
        const lefts = await page
          .locator('[data-tooltip]')
          .evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().left)
          );
        expect(Math.min(...lefts)).toBeCloseTo(of.left, 0);
        expect(at.width).toBeCloseTo(MAX_WIDTH, 0);
        expect(at.left).toBeGreaterThanOrEqual(INSET);
        const centred = of.left + of.width / 2 - at.width / 2;
        expect(
          Math.abs(at.left - Math.max(INSET, centred))
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(at.top - (of.bottom + GAP))).toBeLessThanOrEqual(1);
      });

      test('the rightmost control: its chip slides in to 8 px from the right edge', async ({
        context,
        extensionId,
      }) => {
        await seedSessions(context);
        const page = await openPopup(context, extensionId);
        await setRootFontSize(page, root);
        const control = button(page, 'Rename session');
        await pointerAway(page);
        await control.hover();
        await expect(chip(page)).toHaveText('Rename session');
        const at = await rectOf(chip(page));
        const of = await rectOf(control);
        const view = await viewportOf(page);
        // PREMISE: centred on its control it would cross the right inset.
        expect(of.left + of.width / 2 + at.width / 2).toBeGreaterThan(
          view.width - INSET
        );
        expect(at.right).toBeLessThanOrEqual(view.width - INSET + 0.5);
        expect(at.right).toBeGreaterThanOrEqual(view.width - INSET - 1);
        expect(Math.abs(at.top - (of.bottom + GAP))).toBeLessThanOrEqual(1);
      });

      test('a control in the bottom row of the popup: its chip goes above it', async ({
        context,
        extensionId,
      }) => {
        const page = await openSaved(context, extensionId, 'popup', {
          sessions: [
            session('S1', 'Long', [savedWindow('w1', 'Window 1', 30)]),
          ],
        });
        await setRootFontSize(page, root);
        const view = await viewportOf(page);
        // The lowest tab row whose Delete tab is whole on screen and is what the pointer would hit.
        const index = await page.evaluate((h) => {
          const all = [
            ...document.querySelectorAll(
              '[data-pane="detail"] [aria-label="Delete tab"]'
            ),
          ];
          let best = -1;
          all.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(
              r.left + r.width / 2,
              r.top + r.height / 2
            );
            if (
              r.bottom <= h &&
              hit !== null &&
              el.closest('[data-drag-row-id]')?.contains(hit)
            )
              best = i;
          });
          return best;
        }, view.height);
        expect(index).toBeGreaterThan(0);
        const control = page
          .locator('[data-pane="detail"] [aria-label="Delete tab"]')
          .nth(index);
        await pointerAway(page);
        await control.hover();
        await expect(chip(page)).toHaveText('Delete tab');
        const at = await rectOf(chip(page));
        const of = await rectOf(control);
        // PREMISE: below it would cross the bottom inset.
        expect(of.bottom + GAP + at.height).toBeGreaterThan(
          view.height - INSET
        );
        expect(Math.abs(at.bottom - (of.top - GAP))).toBeLessThanOrEqual(1);
        expect(at.top).toBeGreaterThanOrEqual(INSET);
      });
    });
  }
});

test.describe('the repeat rule', () => {
  test('a session title that fits shows no chip; one cut off (120 characters) shows it in full', async ({
    context,
    extensionId,
  }) => {
    const LONG = LONG_TITLE;
    await seedSessions(
      context,
      buildContainer([
        buildSession({ tabGroupId: 'S1', title: 'Research' }),
        buildSession({ tabGroupId: 'S2', title: LONG }),
      ])
    );
    const page = await openPopup(context, extensionId);
    const sessions = page.locator('[data-pane="sessions"]');
    const short = textIn(sessions, 'Research');
    const cut = textIn(sessions, LONG);
    // PREMISE: whether a holder of its text is cut off, read as the layer reads it.
    const clipped = (loc: Locator, text: string) =>
      loc.evaluate((el, t) => {
        const anchor = el.closest('[data-tooltip]') ?? el;
        const holders = [anchor, ...anchor.querySelectorAll('*')].filter(
          (h) => h.textContent?.trim() === t
        );
        return holders.map((h) => h.scrollWidth > h.clientWidth);
      }, text);
    expect(await clipped(short, 'Research')).not.toContain(true);
    expect(await clipped(short, 'Research')).not.toHaveLength(0);
    expect(await clipped(cut, LONG)).toContain(true);

    await pointerAway(page);
    await watchChips(page);
    await short.hover({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(450);
    expect((await chipLog(page)).inserted).toBe(0);

    await cut.hover({ position: { x: 4, y: 4 } });
    await expect(chip(page)).toHaveText(LONG);
  });
});

test.describe('keyboard', () => {
  test('Tab to Sort shows its chip at once; a click opens the menu with none; Esc closes it and puts focus back with none', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    await pointerAway(page);
    const sort = button(page, 'Sort sessions');
    // Focus put there by script shows nothing; the Tab after it does.
    await button(page, 'Open full view').focus();
    await watchChips(page);
    await page.keyboard.press('Tab', { delay: 100 });
    await expect(sort).toBeFocused();
    await expect(chip(page)).toHaveText('Sort sessions');
    const tabbed = await chipLog(page);
    expect(tabbed.insertedAt - tabbed.keyAt).toBeLessThan(100);

    await sort.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await page.waitForTimeout(450);
    expect((await chipLog(page)).inserted).toBe(1);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(sort).toBeFocused();
    await page.waitForTimeout(450);
    await expect(chip(page)).toHaveCount(0);
    expect((await chipLog(page)).inserted).toBe(1);
  });

  test('in the popup, one Esc hides a tabbed-to chip and is still left to Chrome, which closes the popup', async ({
    context,
    extensionId,
  }) => {
    await watchEscapes(context);
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    await pointerAway(page);
    await button(page, 'Open full view').focus();
    await page.keyboard.press('Tab', { delay: 100 });
    await expect(chip(page)).toHaveText('Sort sessions');
    await expect(page.locator('dialog[open], [role="menu"]')).toHaveCount(0);

    await page.keyboard.press('Escape');

    await expect(chip(page)).toHaveCount(0);
    // Headless cannot show the popup closing; an Esc left unprevented is what Chrome closes it on (KAN-426).
    await expect.poll(() => escapesPrevented(page)).toEqual([false]);
  });
});

test.describe('stacking', () => {
  test('in the Setup dialog the chip is on top, inside the dialog and inside the window', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    await seedSettings(context, { setupState: 'pending' });
    const page = await openFullView(context, extensionId);
    const dialog = page.getByRole('dialog', {
      name: 'Make Tab Keeper yours',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    // The ✕ icon, not the text button of the same name.
    const skip = dialog.locator('[aria-label="Skip setup"]');
    const shown = await restOn(skip, 'Skip setup');
    const at = await rectOf(shown);
    const box = await dialog.evaluate((d) => {
      const r = d.getBoundingClientRect();
      return {
        left: r.left + d.clientLeft,
        top: r.top + d.clientTop,
        right: r.left + d.clientLeft + d.clientWidth,
        bottom: r.top + d.clientTop + d.clientHeight,
      };
    });
    const view = await viewportOf(page);
    // PREMISE: centred on Skip setup it would cross the dialog's right inset, not the window's (R8).
    const of = await rectOf(skip);
    const centredRight = of.left + of.width / 2 + at.width / 2;
    expect(centredRight).toBeGreaterThan(box.right - INSET);
    expect(centredRight).toBeLessThan(view.width - INSET);
    expect(Math.abs(at.right - (box.right - INSET))).toBeLessThanOrEqual(1);
    expect(at.left).toBeGreaterThanOrEqual(box.left);
    expect(at.right).toBeLessThanOrEqual(box.right);
    expect(at.top).toBeGreaterThanOrEqual(box.top);
    expect(at.bottom).toBeLessThanOrEqual(box.bottom);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.right).toBeLessThanOrEqual(view.width);
    expect(at.bottom).toBeLessThanOrEqual(view.height);
    expect(await chipOnTop(page)).toEqual([true, true, true, true, true]);
  });

  test('during the tour a tabbed-to control under the dim shows its chip above the dim', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    await seedSettings(context, {});
    await (await context.newPage()).goto(standIn('Inbox'));
    const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
    await cardButton(page, 'Use an example').click();
    await nextTo(page, 3);
    await landedAt(page, 3);
    const sort = button(page, 'Sort sessions');
    // PREMISE: the control is under the dim, out of the pointer's reach.
    const dimmed = await sort.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document
        .elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        ?.hasAttribute('data-coach-dim');
    });
    expect(dimmed).toBe(true);
    await button(page, 'Open full view').focus();
    await page.keyboard.press('Tab', { delay: 100 });
    await expect(sort).toBeFocused();
    await expect(chip(page)).toHaveText('Sort sessions');
    // PREMISE: without the chip its place is the dim's.
    const under = await chip(page).evaluate((el) => {
      if (!(el instanceof HTMLElement)) return null;
      el.style.visibility = 'hidden';
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2
      );
      el.style.visibility = '';
      return hit?.hasAttribute('data-coach-dim') ?? false;
    });
    expect(under).toBe(true);
    expect(await chipOnTop(page)).toEqual([true, true, true, true, true]);
  });

  test("during the tour a window's Open still shows its reason on hover", async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context);
    await seedSettings(context, {});
    await (await context.newPage()).goto(standIn('Inbox'));
    const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
    await cardButton(page, 'Use an example').click();
    for (let step = 3; step <= 7; step++) await nextTo(page, step);
    await landedAt(page, 7);
    const open = page.getByRole('button', {
      name: 'Open in new window: Getting there',
      exact: true,
    });
    await expect(open).toHaveAccessibleDescription('Open works after the tour');
    await expect(cardAt(page, 7)).toBeVisible();
    await restOn(open, 'Open works after the tour');
    expect(await chipOnTop(page)).toEqual([true, true, true, true, true]);
  });

  test('the sync button while dimmed (aria-disabled) still shows its chip on hover', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // A token no document id can be made from (sync-button-name.spec.ts).
    await serviceWorker.evaluate(() =>
      chrome.storage.sync.set({ tokenValue: 12345 })
    );
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    await expect(page.getByRole('status')).toContainText('Sync unavailable');
    const sync = page.getByRole('button', {
      name: 'Sync unavailable',
      exact: true,
    });
    await expect(sync).toHaveAttribute('aria-disabled', 'true');
    await restOn(sync, 'Sync unavailable');
  });
});

test.describe('drag', () => {
  test('a row drag hides the chip, none shows over other rows until the drop, and one shows after', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [session('S1', 'Rows', [savedWindow('w1', 'Window 1', 6)])],
    });
    const deletes = page.locator(
      '[data-pane="detail"] [aria-label="Delete tab"]'
    );
    await restOn(deletes.nth(0), 'Delete tab');
    await watchChips(page);

    const at = await pickUp(page, tabHandle(page, 'w1-t1'));
    await expect(page.locator('html')).toHaveAttribute('data-dragging', /.*/);
    await expect(chip(page)).toHaveCount(0);
    // Over the other rows' controls, each held past the first wait.
    for (const i of [2, 3, 4]) {
      const b = await rectOf(deletes.nth(i));
      await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2, {
        steps: 4,
      });
      await page.waitForTimeout(400);
      await expect(chip(page)).toHaveCount(0);
    }
    const during = await chipLog(page);
    // PREMISE: the pointer did pass over other controls mid-drag.
    expect(during.overs.length).toBeGreaterThan(0);
    expect(during.inserted).toBe(0);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-dragging',
      /.*/
    );

    // CONTROL: once the drag is over a rest shows the chip again.
    await restOn(deletes.nth(5), 'Delete tab');
  });

  test('a chip showing when a drag starts hides at once, the pointer still on its control', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: [session('S1', 'Rows', [savedWindow('w1', 'Window 1', 6)])],
    });
    const control = page
      .locator('[data-pane="detail"] [aria-label="Delete tab"]')
      .nth(2);
    const b = await rectOf(control);
    const y = b.top + b.height / 2;
    // Pressed on the row just left of its Delete tab, then onto it: 4 px, short of the 5 px a drag needs.
    await pointerAway(page);
    await page.mouse.move(b.left - 3, y);
    await page.mouse.down();
    await page.mouse.move(b.left + 1, y);
    await expect(chip(page)).toHaveText('Delete tab');
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-dragging',
      /.*/
    );

    await page.mouse.move(b.left + 6, y, { steps: 3 });
    await expect(page.locator('html')).toHaveAttribute('data-dragging', /.*/);
    await expect(chip(page)).toHaveCount(0);
    await page.mouse.up();
  });
});

test.describe('no native tooltip', () => {
  const TITLED = '[title]:not(iframe)';

  async function expectNoTitles(page: Page, where: string): Promise<void> {
    const titled = await page
      .locator(TITLED)
      .evaluateAll((els) =>
        els.map((el) => `${el.tagName} ${el.getAttribute('title')}`)
      );
    expect(titled, where).toEqual([]);
    // PREMISE: this surface has tooltips at all, now drawn by the app.
    expect(await page.locator('[data-tooltip]').count(), where).toBeGreaterThan(
      0
    );
  }

  test('popup home', async ({ context, extensionId }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    await expectNoTitles(page, 'home');
  });

  test('every Settings pane', async ({ context, extensionId }) => {
    await seedSessions(context);
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const pane of [
      'Display',
      'Language',
      'Quick access',
      'Sync & backup',
      'Sessions',
      'Recently deleted',
      'About',
      'Help',
    ]) {
      await page.getByRole('button', { name: pane, exact: true }).click();
      await twoFrames(page);
      await expectNoTitles(page, `settings: ${pane}`);
    }
  });

  grantedTest(
    'the full view with Open now',
    async ({ context, extensionId, serviceWorker }) => {
      await seedSessions(context);
      await seedSettings(context, { foldSavedSessionInTabView: false });
      const page = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
      await serviceWorker.evaluate(async (urls) => {
        const win = await chrome.windows.create({ url: urls, focused: false });
        const [first, second] = (win?.tabs ?? []).map((tab) => tab.id ?? -1);
        const groupId = await chrome.tabs.group({
          tabIds: [first, second],
          createProperties: { windowId: win?.id },
        });
        await chrome.tabGroups.update(groupId, {
          title: 'Kyoto',
          color: 'blue',
        });
      }, ['Temples', 'Gardens', 'Loose'].map(standIn));
      await page
        .getByRole('button', { name: 'Change group color: Kyoto' })
        .waitFor();
      await page.getByRole('button', { name: 'Close tab: Loose' }).waitFor();
      await expectNoTitles(page, 'full view');
    }
  );

  test('the export page', async ({ context, extensionId }) => {
    await seedSessions(context);
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/export.html?session=session-1`
    );
    await page.getByRole('button', { name: 'Edit' }).waitFor();
    await expectNoTitles(page, 'export');
  });

  test('every step of the Setup dialog', async ({ context, extensionId }) => {
    await seedSessions(context);
    await seedSettings(context, { setupState: 'pending' });
    const page = await openFullView(context, extensionId);
    const dialog = page.getByRole('dialog', {
      name: 'Make Tab Keeper yours',
      exact: true,
    });
    for (let step = 1; step <= 5; step++) {
      await expect(dialog).toBeVisible();
      await expectNoTitles(page, `setup: step ${step}`);
      if (step < 5)
        await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    }
  });
});
