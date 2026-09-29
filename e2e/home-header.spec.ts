import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions } from './fixtures/seed';
import { waitForFontsLoaded } from './fixtures/fonts';
import { ICON } from '../src/styles/scale';

// KAN-340. The home header's icon row: even glyphs in equal boxes (I1), in
// three pairs 8px apart (A), ordered views | history | account (R1).
//
// Every assertion runs at a 16px root AND a 20px root. 20px is what Chrome's
// Settings > Appearance > Font size "Large" gives an extension page (KAN-312
// measured it), and it is the case a px literal gets wrong while looking
// right at 16px. Setting the root in the page matches the pref, since every
// size here is in rem.

const POPUP_VIEWPORT = { width: 790, height: 550 };
const TAB_VIEWPORT = { width: 1280, height: 800 };

/** In both views, in this order. */
const SHARED = ['Sort sessions', 'Undo', 'Redo', 'Sync now', 'Settings'];
/** The popup adds "Open in a tab" first; the tab view is its destination. */
const POPUP_ORDER = ['Open in a tab', ...SHARED];

const ROOTS = [16, 20] as const;

type Box = { x: number; y: number; width: number; height: number };

async function openHome(
  context: BrowserContext,
  extensionId: string,
  view: 'popup' | 'tab',
  rootPx: 16 | 20
): Promise<Page> {
  await seedSessions(context);
  const page = await context.newPage();
  const viewport = view === 'popup' ? POPUP_VIEWPORT : TAB_VIEWPORT;
  await page.setViewportSize(viewport);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${
      view === 'tab' ? '?view=tab' : ''
    }`
  );
  // Barrier: goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  await waitForFontsLoaded(page);
  await page.evaluate((px) => {
    document.documentElement.style.fontSize = `${px}px`;
  }, rootPx);
  // Park the pointer off the header so no hover fill or rotation is caught.
  await page.mouse.move(2, viewport.height - 2);
  return page;
}

const control = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true });

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`no box for ${locator.toString()}`);
  return box;
}

/** An icon's box: the glyph plus Icon's 4px padding on each side. */
const iconBox = (rootPx: number) => parseFloat(ICON.DEFAULT) * rootPx + 8;

/** The two glyphs drawn at ICON.MEDIUM inside a DEFAULT box. */
const MEDIUM_GLYPHS = ['Settings', 'Open in a tab'];

test.describe('every header control has the same box (KAN-340)', () => {
  for (const rootPx of ROOTS) {
    test(`at a ${rootPx}px root, the gear and the arrows draw at MEDIUM in the same box`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', rootPx);

      for (const name of POPUP_ORDER) {
        const box = await boxOf(control(page, name));
        expect
          .soft({ name, width: box.width, height: box.height })
          .toEqual({ name, width: iconBox(rootPx), height: iconBox(rootPx) });
      }
      // The control for the box assertion: these two really are smaller
      // inside it, so equal boxes are not equal glyphs.
      for (const name of MEDIUM_GLYPHS) {
        const glyph = control(page, name).locator('.material-symbols-outlined');
        expect({
          name,
          size: await glyph.evaluate((el) => getComputedStyle(el).fontSize),
        }).toEqual({ name, size: `${parseFloat(ICON.MEDIUM) * rootPx}px` });
      }
    });
  }
});

/** The row the Search title and the icon cluster share. */
const headerRow = (page: Page): Locator =>
  control(page, 'Search').locator('..');

/** The space between each control and the next, left to right. */
async function gapsBetween(page: Page, names: string[]): Promise<number[]> {
  const boxes = await Promise.all(names.map((n) => boxOf(control(page, n))));
  return boxes.slice(1).map((b, i) => b.x - (boxes[i].x + boxes[i].width));
}

/**
 * Space between the icon cluster's left edge and its first control. The
 * cluster is right-aligned, so a stray gap lands HERE, on the left, taking
 * room from the title: every between-controls gap and every right inset
 * still reads correct with a margin on each pair instead of a gap on the
 * cluster. The cluster is the row's last child, which shrinks to fit it.
 */
async function leadingGap(page: Page, firstName: string): Promise<number> {
  const cluster = await boxOf(headerRow(page).locator(':scope > :last-child'));
  const first = await boxOf(control(page, firstName));
  return first.x - cluster.x;
}

/** How far each control's right edge sits from the header row's right edge. */
async function insetsFromRight(page: Page, names: string[]): Promise<number[]> {
  const row = await boxOf(headerRow(page));
  const boxes = await Promise.all(names.map((n) => boxOf(control(page, n))));
  return boxes.map((b) => row.x + row.width - (b.x + b.width));
}

test.describe('the icons sit in three pairs, 8px apart (KAN-340 A + R1)', () => {
  for (const rootPx of ROOTS) {
    test(`popup at a ${rootPx}px root: views | history | account, flush right, inside the row`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', rootPx);

      // [Open in a tab, Sort] [Undo, Redo] [Sync, Settings]
      expect(await gapsBetween(page, POPUP_ORDER)).toEqual([0, 8, 0, 8, 0]);
      expect(await leadingGap(page, POPUP_ORDER[0]), 'no leading gap').toBe(0);

      const row = await boxOf(headerRow(page));
      const search = await boxOf(control(page, 'Search'));
      const first = await boxOf(control(page, POPUP_ORDER[0]));
      const [lastInset] = await insetsFromRight(page, ['Settings']);
      expect(lastInset, 'the cluster is flush with the row').toBe(0);
      // KAN-343: at 20px the title gives way; the controls must not.
      expect(first.x, 'no control overlaps the title').toBeGreaterThanOrEqual(
        search.x + search.width
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth
        ),
        'nothing scrolls the page sideways'
      ).toBe(0);
      if (rootPx === 16)
        expect(row.height, 'back-target.spec pins 56').toBe(56);
    });

    test(`tab view at a ${rootPx}px root: Sort alone, then history, then account`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'tab', rootPx);

      await expect(control(page, 'Open in a tab')).toHaveCount(0);
      expect(await gapsBetween(page, SHARED)).toEqual([8, 0, 8, 0]);
      expect(
        await leadingGap(page, SHARED[0]),
        'no leading gap where Open in a tab would be'
      ).toBe(0);
      const [lastInset] = await insetsFromRight(page, ['Settings']);
      expect(lastInset, 'no stray gap after Settings').toBe(0);
    });

    test(`at a ${rootPx}px root the shared icons sit at the same place in the popup and the tab view`, async ({
      context,
      extensionId,
    }) => {
      const popup = await openHome(context, extensionId, 'popup', rootPx);
      const tab = await openHome(context, extensionId, 'tab', rootPx);

      expect(await insetsFromRight(popup, SHARED)).toEqual(
        await insetsFromRight(tab, SHARED)
      );
    });
  }
});

// KAN-344. The gear's hover turn: half a turn (the gear's six teeth only
// repeat exactly at 180°), past it and back, eased in and out as a
// transition so leaving mid-turn reverses it instead of snapping. Only for a
// fine pointer that hovers, never from the keyboard, and not at all when the
// system asks for reduced motion.

/** The gear's glyph, the element that turns. */
const gearGlyph = (page: Page): Locator =>
  control(page, 'Settings').locator('.material-symbols-outlined');

/**
 * The glyph's drawn angle in degrees on every frame for `ms`, while `act`
 * runs: its `rotate` plus whatever its `transform` turns, so the reading
 * doesn't depend on which property the code uses.
 */
async function turnDuring(
  page: Page,
  ms: number,
  act: () => Promise<void>
): Promise<number[]> {
  const samples = gearGlyph(page).evaluate(
    (el, forMs) =>
      new Promise<number[]>((resolve) => {
        const angle = () => {
          const cs = getComputedStyle(el);
          const rotate = cs.rotate === 'none' ? 0 : parseFloat(cs.rotate);
          const m =
            cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
          return rotate + (m ? (Math.atan2(m.b, m.a) * 180) / Math.PI : 0);
        };
        const out: number[] = [];
        const start = performance.now();
        const tick = () => {
          out.push(angle());
          if (performance.now() - start < forMs) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    ms
  );
  await act();
  return samples;
}

/** A point in the gear button's ring, outside the glyph itself. */
async function hoverRing(page: Page): Promise<void> {
  await control(page, 'Settings').hover({ position: { x: 2, y: 2 } });
}

test.describe('the gear winds up on hover (KAN-344)', () => {
  test('pointing anywhere on the button turns it half a turn, past 180° and back to it', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);

    const turns = await turnDuring(page, 900, () => hoverRing(page));

    expect(Math.max(...turns), 'it overshoots').toBeGreaterThan(181);
    expect(turns[turns.length - 1], 'it settles on 180°').toBeCloseTo(180, 1);
  });

  test('leaving mid-turn turns it back from where it was, without a jump', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    await hoverRing(page);
    await page.waitForTimeout(150);

    // Read in the leave event's own task, before any frame: a keyframe
    // animation on :hover is gone by then (0°); a transition is still where
    // it was. Frame-rate independent, so a slow CI runner can't fake it.
    const atLeave = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const button = document.querySelector('[aria-label="Settings"]');
          const glyph = button?.querySelector('.material-symbols-outlined');
          if (!button || !glyph) throw new Error('no Settings glyph');
          button.addEventListener(
            'pointerleave',
            () => {
              const cs = getComputedStyle(glyph);
              const rotate = cs.rotate === 'none' ? 0 : parseFloat(cs.rotate);
              const m =
                cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
              resolve(
                rotate + (m ? (Math.atan2(m.b, m.a) * 180) / Math.PI : 0)
              );
            },
            { once: true }
          );
        })
    );
    const turns = await turnDuring(page, 500, () => page.mouse.move(2, 540));

    expect(await atLeave, 'no snap on leave').toBeGreaterThan(30);
    expect(turns[turns.length - 1], 'back at rest').toBeCloseTo(0, 1);
  });

  test('with reduced motion it does not turn, and the hover fill still answers', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // The glyph's centre, where the pre-KAN-344 spin started: pointing at
    // the ring alone would pass against it.
    const turns = await turnDuring(page, 700, () =>
      control(page, 'Settings').hover()
    );

    expect(Math.max(...turns.map(Math.abs))).toBe(0);
    expect(
      await control(page, 'Settings').evaluate(
        (el) => getComputedStyle(el).backgroundColor
      ),
      'the hover fill is the feedback'
    ).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('tabbing onto the gear does not turn it', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    await control(page, 'Sync now').focus();

    const turns = await turnDuring(page, 700, () => page.keyboard.press('Tab'));

    await expect(control(page, 'Settings')).toBeFocused();
    expect(Math.max(...turns.map(Math.abs))).toBe(0);
  });

  test('on a touch screen it does not turn', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    // The premise: the page now reports a touch pointer that can't hover.
    expect(
      await page.evaluate(
        () => matchMedia('(hover: hover) and (pointer: fine)').matches
      )
    ).toBe(false);

    // The glyph's centre, as in the reduced-motion test.
    const turns = await turnDuring(page, 700, () =>
      control(page, 'Settings').hover()
    );

    expect(Math.max(...turns.map(Math.abs))).toBe(0);
  });
});
