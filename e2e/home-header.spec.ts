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

/** The header's title text. */
const title = (page: Page): Locator =>
  page.getByText('Tab Keeper', { exact: true });

/**
 * The row the title and the icon cluster share: the innermost div holding
 * both (document order puts ancestors first).
 */
const headerRow = (page: Page): Locator =>
  page
    .locator('div')
    .filter({ has: title(page) })
    .filter({ has: control(page, 'Settings') })
    .last();

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
      const titleBox = await boxOf(title(page));
      const first = await boxOf(control(page, POPUP_ORDER[0]));
      const [lastInset] = await insetsFromRight(page, ['Settings']);
      expect(lastInset, 'the cluster is flush with the row').toBe(0);
      // KAN-343: at 20px the title gives way; the controls must not.
      expect(first.x, 'no control overlaps the title').toBeGreaterThanOrEqual(
        titleBox.x + titleBox.width
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

// KAN-344. Hover motions, settled by Justine from side-by-side mocks: the
// gear winds up half a turn (its six teeth only repeat exactly at 180°), and
// Open in a tab stretches. Each goes past
// its pose a little and settles, and eases back when the pointer leaves --
// a transition, so leaving early reverses instead of snapping. Only for a
// fine pointer that hovers, never from the keyboard, and not at all when
// the system asks for reduced motion. Sort, Undo, Redo and Sync stay still.

type Pose = { angle: number; scale: number };

interface HoverMotionCase {
  /** The button's accessible name. */
  name: string;
  /** The pose it settles in while hovered. */
  pose: Pose;
  /** Where the pointer goes: somewhere on the button that is not the glyph. */
  pointAt: (page: Page) => Promise<void>;
}

const MOTIONS: HoverMotionCase[] = [
  {
    name: 'Settings',
    pose: { angle: 180, scale: 1 },
    pointAt: (page) =>
      control(page, 'Settings').hover({ position: { x: 2, y: 2 } }),
  },
  {
    name: 'Open in a tab',
    pose: { angle: 0, scale: 1.14 },
    pointAt: (page) =>
      control(page, 'Open in a tab').hover({ position: { x: 2, y: 2 } }),
  },
];

/** Buttons that have no motion. */
const STILL = ['Sort sessions', 'Sync now'];

const glyphOf = (page: Page, name: string): Locator =>
  control(page, name).locator('.material-symbols-outlined');

/**
 * How far along a pose is, as a fraction of the way from rest to `target`:
 * 0 at rest, 1 at the target, above 1 past it. Reads rotation OR scale,
 * whichever the target moves.
 */
function progress(pose: Pose, target: Pose): number {
  return target.angle !== 0
    ? pose.angle / target.angle
    : (pose.scale - 1) / (target.scale - 1);
}

const atRest = (pose: Pose) =>
  Math.abs(pose.angle) < 0.01 && Math.abs(pose.scale - 1) < 0.0001;

/**
 * The glyph's drawn pose on every frame for `ms`, while `act` runs: its
 * `rotate` and `scale` combined with whatever its `transform` does, so the
 * reading doesn't depend on which properties the code uses.
 */
async function posesDuring(
  glyph: Locator,
  ms: number,
  act: () => Promise<void>
): Promise<Pose[]> {
  const samples = glyph.evaluate(
    (el, forMs) =>
      new Promise<Pose[]>((resolve) => {
        const read = (): Pose => {
          const cs = getComputedStyle(el);
          const rotate = cs.rotate === 'none' ? 0 : parseFloat(cs.rotate);
          const scale = cs.scale === 'none' ? 1 : parseFloat(cs.scale);
          const m =
            cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
          return {
            angle: rotate + (m ? (Math.atan2(m.b, m.a) * 180) / Math.PI : 0),
            scale: scale * (m ? Math.hypot(m.a, m.b) : 1),
          };
        };
        const out: Pose[] = [];
        const start = performance.now();
        const tick = () => {
          out.push(read());
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

/**
 * The pose in the `pointerleave` handler's own task, before any frame: a
 * keyframe animation on :hover is already gone then (rest); a transition is
 * still where it was. Frame-rate independent, so a slow CI runner can't
 * fake it.
 */
function poseAtLeave(page: Page, name: string): Promise<Pose> {
  return page.evaluate(
    (label) =>
      new Promise<Pose>((resolve, reject) => {
        const button = document.querySelector(`[aria-label="${label}"]`);
        const glyph = button?.querySelector('.material-symbols-outlined');
        if (!button || !glyph) {
          reject(new Error(`no glyph in "${label}"`));
          return;
        }
        button.addEventListener(
          'pointerleave',
          () => {
            const cs = getComputedStyle(glyph);
            const rotate = cs.rotate === 'none' ? 0 : parseFloat(cs.rotate);
            const scale = cs.scale === 'none' ? 1 : parseFloat(cs.scale);
            const m =
              cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
            resolve({
              angle: rotate + (m ? (Math.atan2(m.b, m.a) * 180) / Math.PI : 0),
              scale: scale * (m ? Math.hypot(m.a, m.b) : 1),
            });
          },
          { once: true }
        );
      }),
    name
  );
}

test.describe('hover motions (KAN-344)', () => {
  for (const motion of MOTIONS) {
    test(`${motion.name}: pointing at the button goes past its pose and settles on it`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', 16);

      const poses = await posesDuring(glyphOf(page, motion.name), 900, () =>
        motion.pointAt(page)
      );

      const peak = Math.max(...poses.map((p) => progress(p, motion.pose)));
      const last = poses[poses.length - 1];
      expect(peak, 'it goes a little past its pose').toBeGreaterThan(1.005);
      expect(last.angle, 'it settles on its angle').toBeCloseTo(
        motion.pose.angle,
        1
      );
      expect(last.scale, 'it settles on its size').toBeCloseTo(
        motion.pose.scale,
        3
      );
    });

    test(`${motion.name}: leaving early eases back from where it was, without a jump`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', 16);
      await motion.pointAt(page);
      await page.waitForTimeout(90);

      const atLeave = poseAtLeave(page, motion.name);
      const poses = await posesDuring(glyphOf(page, motion.name), 500, () =>
        page.mouse.move(2, 540)
      );

      expect(
        progress(await atLeave, motion.pose),
        'no snap on leave'
      ).toBeGreaterThan(0.15);
      expect(atRest(poses[poses.length - 1]), 'back at rest').toBe(true);
    });

    test(`${motion.name}: nothing moves with reduced motion, and the hover fill still answers`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', 16);
      await page.emulateMedia({ reducedMotion: 'reduce' });

      // The glyph's centre as well as the rest of the button: the
      // pre-KAN-344 gear spun only when the glyph itself was hovered.
      const poses = await posesDuring(
        glyphOf(page, motion.name),
        700,
        async () => {
          await glyphOf(page, motion.name).hover();
          await motion.pointAt(page);
        }
      );

      expect(poses.every(atRest)).toBe(true);
      expect(
        await control(page, motion.name).evaluate(
          (el) => getComputedStyle(el).backgroundColor
        ),
        'the hover fill is the feedback'
      ).not.toBe('rgba(0, 0, 0, 0)');
    });

    test(`${motion.name}: reaching it from the keyboard moves nothing`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', 16);
      await control(page, motion.name).focus();

      const poses = await posesDuring(
        glyphOf(page, motion.name),
        700,
        async () => {
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
        }
      );

      await expect(control(page, motion.name)).toBeFocused();
      expect(poses.every(atRest)).toBe(true);
    });

    test(`${motion.name}: on a touch screen nothing moves`, async ({
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

      const poses = await posesDuring(
        glyphOf(page, motion.name),
        700,
        async () => {
          await glyphOf(page, motion.name).hover();
          await motion.pointAt(page);
        }
      );

      expect(poses.every(atRest)).toBe(true);
    });
  }

  for (const name of STILL) {
    test(`${name} stays still on hover`, async ({ context, extensionId }) => {
      const page = await openHome(context, extensionId, 'popup', 16);

      const poses = await posesDuring(glyphOf(page, name), 700, () =>
        control(page, name).hover()
      );

      expect(poses.every(atRest)).toBe(true);
    });
  }
});
