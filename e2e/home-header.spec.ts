import type { BrowserContext, JSHandle, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';
import { waitForFontsLoaded } from './fixtures/fonts';
import { localeStrings } from './fixtures/locales';
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
/** The popup adds "Open full view" first; the tab view is its destination. */
const POPUP_ORDER = ['Open full view', ...SHARED];
/** The tab view puts "Open compact view" in that first slot (KAN-437 A). */
const TAB_ORDER = ['Open compact view', ...SHARED];

const ROOTS = [16, 20] as const;

type Box = { x: number; y: number; width: number; height: number };

async function openHome(
  context: BrowserContext,
  extensionId: string,
  view: 'popup' | 'tab',
  rootPx: 16 | 20,
  lang = 'en'
): Promise<Page> {
  await seedSessions(context);
  if (lang !== 'en') await seedSettings(context, { language: lang });
  const page = await context.newPage();
  const viewport = view === 'popup' ? POPUP_VIEWPORT : TAB_VIEWPORT;
  await page.setViewportSize(viewport);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${
      view === 'tab' ? '?view=tab' : ''
    }`
  );
  // Barrier: goto resolves before React mounts.
  await page
    .getByRole('button', { name: localeStrings(lang)['Sort sessions'] })
    .waitFor();
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

/** The glyphs drawn smaller than DEFAULT inside a DEFAULT box, and their size. */
const SMALLER_GLYPHS = {
  popup: [
    ['Settings', 'MEDIUM'],
    ['Open full view', 'MEDIUM_SMALL'],
  ],
  tab: [
    ['Settings', 'MEDIUM'],
    ['Open compact view', 'MEDIUM_SMALL'],
  ],
} as const;

/** Each glyph's drawn size against the ICON level it should have. */
async function glyphSizes(
  page: Page,
  view: keyof typeof SMALLER_GLYPHS,
  rootPx: number
) {
  return Promise.all(
    SMALLER_GLYPHS[view].map(async ([name, level]) => ({
      name,
      size: await control(page, name)
        .locator('.material-symbols-outlined')
        .evaluate((el) => getComputedStyle(el).fontSize),
      expected: `${parseFloat(ICON[level]) * rootPx}px`,
    }))
  );
}

test.describe('every header control has the same box (KAN-340)', () => {
  for (const rootPx of ROOTS) {
    test(`at a ${rootPx}px root, the gear and the arrows draw smaller, in the same box`, async ({
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
      for (const { name, size, expected } of await glyphSizes(
        page,
        'popup',
        rootPx
      ))
        expect({ name, size }).toEqual({ name, size: expected });
    });

    test(`tab view at a ${rootPx}px root: Open compact view draws at MEDIUM_SMALL in the shared box (KAN-437)`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'tab', rootPx);

      for (const name of TAB_ORDER) {
        const box = await boxOf(control(page, name));
        expect
          .soft({ name, width: box.width, height: box.height })
          .toEqual({ name, width: iconBox(rootPx), height: iconBox(rootPx) });
      }
      for (const { name, size, expected } of await glyphSizes(
        page,
        'tab',
        rootPx
      ))
        expect({ name, size }).toEqual({ name, size: expected });
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

      // [Open full view, Sort] [Undo, Redo] [Sync, Settings]
      expect(await gapsBetween(page, POPUP_ORDER)).toEqual([0, 8, 0, 8, 0]);
      expect(await leadingGap(page, POPUP_ORDER[0]), 'no leading gap').toBe(0);

      const row = await boxOf(headerRow(page));
      const titleBox = await boxOf(title(page));
      const first = await boxOf(control(page, POPUP_ORDER[0]));
      const [lastInset] = await insetsFromRight(page, ['Settings']);
      expect(lastInset, 'the cluster is flush with the row').toBe(0);
      // KAN-343 B: at 20px the words hide, so the mark is what the controls must clear.
      const frame = await boxOf(mark(page).locator('xpath=..'));
      expect(first.x, 'no control overlaps the mark').toBeGreaterThanOrEqual(
        frame.x + frame.width
      );
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

    test(`tab view at a ${rootPx}px root: Open compact view in Open full view's slot, then history, then account`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'tab', rootPx);

      await expect(control(page, 'Open full view')).toHaveCount(0);
      // [Open compact view, Sort] [Undo, Redo] [Sync, Settings]
      expect(await gapsBetween(page, TAB_ORDER)).toEqual([0, 8, 0, 8, 0]);
      expect(await leadingGap(page, TAB_ORDER[0]), 'no leading gap').toBe(0);
      const [lastInset] = await insetsFromRight(page, ['Settings']);
      expect(lastInset, 'no stray gap after Settings').toBe(0);
      // The mock's B crowded the title out; A must not.
      const first = await boxOf(control(page, TAB_ORDER[0]));
      const frame = await boxOf(markFrame(page));
      const titleBox = await boxOf(title(page));
      expect(first.x, 'no control overlaps the mark').toBeGreaterThanOrEqual(
        frame.x + frame.width
      );
      expect(first.x, 'no control overlaps the title').toBeGreaterThanOrEqual(
        titleBox.x + titleBox.width
      );
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
// Open full view stretches; the full view's Open compact view shrinks (KAN-437). Each goes past
// its pose a little and settles, and eases back when the pointer leaves --
// a transition, so leaving early reverses instead of snapping. Only for a
// fine pointer that hovers, never from the keyboard, and not at all when
// the system asks for reduced motion. Sort, Undo, Redo and Sync stay still.

type Pose = { angle: number; scale: number };

interface HoverMotionCase {
  /** The button's accessible name. */
  name: string;
  /** The view that has the button; the popup when absent. */
  view?: 'popup' | 'tab';
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
    name: 'Open full view',
    pose: { angle: 0, scale: 1.14 },
    pointAt: (page) =>
      control(page, 'Open full view').hover({ position: { x: 2, y: 2 } }),
  },
  {
    name: 'Open compact view',
    view: 'tab',
    pose: { angle: 0, scale: 0.88 },
    pointAt: (page) =>
      control(page, 'Open compact view').hover({ position: { x: 2, y: 2 } }),
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
 * fake it. Resolves once the listener is armed, and returns the reader.
 */
async function armPoseAtLeave(
  page: Page,
  name: string
): Promise<() => Promise<Pose>> {
  const seen: JSHandle<{ pose: Pose | null }> = await page.evaluateHandle(
    (label) => {
      const button = document.querySelector(`[aria-label="${label}"]`);
      const glyph = button?.querySelector('.material-symbols-outlined');
      if (!button || !glyph) throw new Error(`no glyph in "${label}"`);
      const out: { pose: Pose | null } = { pose: null };
      button.addEventListener(
        'pointerleave',
        () => {
          const cs = getComputedStyle(glyph);
          const rotate = cs.rotate === 'none' ? 0 : parseFloat(cs.rotate);
          const scale = cs.scale === 'none' ? 1 : parseFloat(cs.scale);
          const m =
            cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
          out.pose = {
            angle: rotate + (m ? (Math.atan2(m.b, m.a) * 180) / Math.PI : 0),
            scale: scale * (m ? Math.hypot(m.a, m.b) : 1),
          };
        },
        { once: true }
      );
      return out;
    },
    name
  );
  return async () => {
    // KAN-391: a promise awaiting the leave hung for good when it lost the race.
    await expect
      .poll(() => seen.evaluate((s) => s.pose), 'the pointer left the button')
      .not.toBeNull();
    const pose = await seen.evaluate((s) => s.pose);
    if (pose === null) throw new Error(`no pointerleave on "${name}"`);
    return pose;
  };
}

test.describe('hover motions (KAN-344)', () => {
  for (const motion of MOTIONS) {
    test(`${motion.name}: pointing at the button goes past its pose and settles on it`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(
        context,
        extensionId,
        motion.view ?? 'popup',
        16
      );

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
      const page = await openHome(
        context,
        extensionId,
        motion.view ?? 'popup',
        16
      );
      await motion.pointAt(page);
      await page.waitForTimeout(90);

      const poseAtLeave = await armPoseAtLeave(page, motion.name);
      const poses = await posesDuring(glyphOf(page, motion.name), 500, () =>
        page.mouse.move(2, 540)
      );

      expect(
        progress(await poseAtLeave(), motion.pose),
        'no snap on leave'
      ).toBeGreaterThan(0.15);
      expect(atRest(poses[poses.length - 1]), 'back at rest').toBe(true);
    });

    test(`${motion.name}: nothing moves with reduced motion, and the hover fill still answers`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(
        context,
        extensionId,
        motion.view ?? 'popup',
        16
      );
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
      const page = await openHome(
        context,
        extensionId,
        motion.view ?? 'popup',
        16
      );
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
      const page = await openHome(
        context,
        extensionId,
        motion.view ?? 'popup',
        16
      );
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

const mark = (page: Page): Locator =>
  page.locator('svg:has([data-mark-part="shutter"])');

test.describe('the mark before the title', () => {
  for (const rootPx of ROOTS) {
    test(`at a ${rootPx}px root: ICON.SMALL square, centred in the icons' box, level with them`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', rootPx);

      const box = await boxOf(mark(page));
      const side = parseFloat(ICON.SMALL) * rootPx;
      expect(box.width).toBe(side);
      expect(box.height).toBe(side);

      const frame = await boxOf(mark(page).locator('xpath=..'));
      const frameSide = iconBox(rootPx);
      expect({ w: frame.width, h: frame.height }).toEqual({
        w: frameSide,
        h: frameSide,
      });
      expect(box.x + box.width / 2).toBeCloseTo(frame.x + frameSide / 2, 1);
      expect(box.y + box.height / 2).toBeCloseTo(frame.y + frameSide / 2, 1);

      const gear = await boxOf(control(page, 'Settings'));
      expect(box.y + box.height / 2).toBeCloseTo(gear.y + gear.height / 2, 1);
    });
  }

  // The baked fills must look as the source floppy does under
  // `filter: saturate(0.6)`; both are drawn at 3x on the app's own ground.
  test('the baked colours match the source under saturate(0.6), within 2/255', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    const ground = await mark(page).evaluate((el) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c !== 'rgba(0, 0, 0, 0)') return c;
      }
      return 'rgb(255, 255, 255)';
    });
    const shot = async (target: Page, box: Box): Promise<string> => {
      const cdp = await context.newCDPSession(target);
      const { data } = await cdp.send('Page.captureScreenshot', {
        clip: { ...box, scale: 3 },
      });
      return data;
    };
    const shipped = await shot(page, await boxOf(mark(page)));

    const scratch = await context.newPage();
    await scratch.setViewportSize({ width: 100, height: 100 });
    await scratch.setContent(
      `<body style="margin:0;background:${ground}"><span id="m" style="display:block;width:20px;height:20px;filter:saturate(0.6)">${SOURCE_MARK}</span></body>`
    );
    const source = await shot(scratch, await boxOf(scratch.locator('#m')));

    const delta = await scratch.evaluate(
      async ([a, b]) => {
        const decode = async (b64: string) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bytes]));
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          const cx = cv.getContext('2d');
          if (cx === null) throw new Error('no 2d context');
          cx.drawImage(bmp, 0, 0);
          return cx.getImageData(0, 0, bmp.width, bmp.height);
        };
        const [x, y] = await Promise.all([decode(a), decode(b)]);
        if (x.width !== y.width || x.height !== y.height)
          return {
            size: [x.width, x.height, y.width, y.height],
            flat: 0,
            flatMax: -1,
            allMax: -1,
          };
        // Edge pixels differ by a few levels in coverage whatever is drawn
        // (an unfiltered copy does too), so colour is judged where the
        // source is flat: every neighbour within 2 of the pixel itself.
        const px = (img: ImageData, X: number, Y: number, c: number) =>
          img.data[(Y * img.width + X) * 4 + c];
        let flat = 0;
        let flatMax = 0;
        let allMax = 0;
        for (let Y = 1; Y < y.height - 1; Y++) {
          for (let X = 1; X < y.width - 1; X++) {
            let isFlat = true;
            let d = 0;
            for (let c = 0; c < 3; c++) {
              d = Math.max(d, Math.abs(px(x, X, Y, c) - px(y, X, Y, c)));
              for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ])
                if (Math.abs(px(y, X + dx, Y + dy, c) - px(y, X, Y, c)) > 2)
                  isFlat = false;
            }
            allMax = Math.max(allMax, d);
            if (isFlat) {
              flat++;
              flatMax = Math.max(flatMax, d);
            }
          }
        }
        return { size: [x.width, x.height], flat, flatMax, allMax };
      },
      [shipped, source]
    );

    expect(delta.size, 'both at 3x').toEqual([60, 60]);
    expect(delta.flat, 'most of the mark is flat colour').toBeGreaterThan(1500);
    expect(delta.flatMax, JSON.stringify(delta)).toBeLessThanOrEqual(2);
  });
});

// KAN-343 B. Judged by pixels, so any way of hiding the words counts.

/** The header row in any language: the innermost box with the mark and a control. */
const markRow = (page: Page): Locator =>
  page
    .locator('div')
    .filter({ has: mark(page) })
    .filter({ has: page.getByRole('button') })
    .last();

const markFrame = (page: Page): Locator => mark(page).locator('xpath=..');

/** Between the mark's frame and the icon cluster: the room the words get. */
async function titleRoom(page: Page): Promise<Box> {
  const row = await boxOf(markRow(page));
  const frame = await boxOf(markFrame(page));
  const cluster = await boxOf(markRow(page).locator(':scope > :last-child'));
  const left = frame.x + frame.width;
  return { x: left, y: row.y, width: cluster.x - left, height: row.height };
}

/** The words' width laid out on one line, whatever box holds them. */
const naturalWidth = (words: Locator): Promise<number> =>
  words.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width;
  });

/** Pixels in `box` that differ from its commonest colour: 0 is an empty room. */
async function inkIn(page: Page, box: Box): Promise<number> {
  const png = (await page.screenshot({ clip: box })).toString('base64');
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
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const [ground] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const g = [(ground >> 16) & 255, (ground >> 8) & 255, ground & 255];
    let ink = 0;
    for (let i = 0; i < data.length; i += 4)
      if (g.some((v, c) => Math.abs(data[i + c] - v) > 8)) ink++;
    return ink;
  }, png);
}

const roomInk = async (page: Page) => inkIn(page, await titleRoom(page));

/** Non-ignored text nodes of this name in Chrome's own accessibility tree. */
async function axTextCount(page: Page, name: string): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodes } = await cdp.send('Accessibility.queryAXTree', {
    nodeId: root.nodeId,
    accessibleName: name,
    role: 'StaticText',
  });
  await cdp.detach();
  return nodes.filter((n) => !n.ignored).length;
}

/** Changes under the header row, and window errors, while nothing is asked of it. */
const unrestFor = (page: Page, ms: number) =>
  markRow(page).evaluate(
    (row, forMs) =>
      new Promise<{ mutations: number; errors: string[] }>((resolve) => {
        let mutations = 0;
        const errors: string[] = [];
        const onError = (e: ErrorEvent) => errors.push(e.message);
        const observer = new MutationObserver((records) => {
          mutations += records.length;
        });
        observer.observe(row, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
        addEventListener('error', onError);
        setTimeout(() => {
          observer.disconnect();
          removeEventListener('error', onError);
          resolve({ mutations, errors });
        }, forMs);
      }),
    ms
  );

const setRoot = (page: Page, px: number) =>
  page.evaluate((v) => {
    document.documentElement.style.fontSize = `${v}px`;
  }, px);

/** Whether the words fit, per view and root, as measured on main. */
const FITS = { popup: { 16: true, 20: false }, tab: { 16: true, 20: false } };

test.describe('the words give way to the mark (KAN-343 B)', () => {
  for (const view of ['popup', 'tab'] as const) {
    for (const rootPx of ROOTS) {
      test(`${view} at a ${rootPx}px root: the words show in full or not at all; the mark and icons keep their boxes`, async ({
        context,
        extensionId,
      }) => {
        const page = await openHome(context, extensionId, view, rootPx);
        const words = title(page);
        const room = await titleRoom(page);
        const fits = (await naturalWidth(words)) <= room.width;
        expect(fits, 'the premise').toBe(FITS[view][rootPx]);

        if (fits) {
          const box = await boxOf(words);
          expect(await roomInk(page), 'the words are drawn').toBeGreaterThan(0);
          expect(box.x).toBeGreaterThanOrEqual(room.x);
          expect(box.x + box.width).toBeLessThanOrEqual(room.x + room.width);
        } else {
          expect(await roomInk(page), 'nothing is drawn but the mark').toBe(0);
        }

        const row = await boxOf(markRow(page));
        const frame = await boxOf(markFrame(page));
        const side = iconBox(rootPx);
        expect(frame).toEqual({
          x: row.x,
          y: frame.y,
          width: side,
          height: side,
        });
        const names = view === 'popup' ? POPUP_ORDER : TAB_ORDER;
        const first = await boxOf(control(page, names[0]));
        // Its boxes and the two 8px gaps between its three groups (KAN-340 A).
        const cluster = names.length * side + 16;
        expect(first.x, 'the icons keep their place').toBeCloseTo(
          row.x + row.width - cluster,
          3
        );
        expect(
          await markRow(page).evaluate((el) => el.scrollWidth - el.clientWidth),
          'the row does not overflow sideways'
        ).toBe(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth
          ),
          'nothing scrolls the page sideways'
        ).toBe(0);
      });
    }
  }

  test('hidden from sight, the words still name the header for assistive tech', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 20);

    expect(await roomInk(page), 'the premise: hidden').toBe(0);
    await expect(title(page)).toBeAttached();
    expect(await axTextCount(page, 'Tab Keeper')).toBe(1);
  });

  test('a root size change flips the words live, and each state holds still', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    expect(await roomInk(page), 'shown at 16px').toBeGreaterThan(0);

    for (const [px, shown] of [
      [20, false],
      [16, true],
      [20, false],
    ] as const) {
      await setRoot(page, px);
      await expect
        .poll(async () => (await roomInk(page)) > 0, `${px}px`)
        .toBe(shown);
      expect(await unrestFor(page, 500), `${px}px settles`).toEqual({
        mutations: 0,
        errors: [],
      });
    }
  });

  test('the room alone narrowing hides the words, and widening shows them', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    const room = await titleRoom(page);
    const natural = await naturalWidth(title(page));
    // The premise: the words fit, by less than this squeeze.
    const squeeze = Math.ceil(room.width - natural) + 2;
    expect(squeeze).toBeLessThan(room.width);

    const pad = (px: number) =>
      markRow(page).evaluate((el, v) => {
        el.style.paddingRight = `${v}px`;
      }, px);
    await pad(squeeze);
    await expect.poll(() => roomInk(page), 'squeezed').toBe(0);
    expect(await naturalWidth(title(page)), 'the words did not change').toBe(
      natural
    );
    expect(await unrestFor(page, 500)).toEqual({ mutations: 0, errors: [] });

    await pad(0);
    await expect.poll(() => roomInk(page), 'room again').toBeGreaterThan(0);
    expect(await unrestFor(page, 500)).toEqual({ mutations: 0, errors: [] });
  });

  test('the words alone widening hides them, and narrowing shows them', async ({
    context,
    extensionId,
  }) => {
    const page = await openHome(context, extensionId, 'popup', 16);
    const room = await titleRoom(page);
    const natural = await naturalWidth(title(page));
    const letters = 'Tab Keeper'.length;
    // Not on the row: letter-spacing turns off the icons' ligatures.
    const spacing = Math.ceil((room.width - natural) / letters) + 1;
    const space = (px: number) =>
      title(page)
        .locator('xpath=..')
        .evaluate((el, v) => {
          el.style.letterSpacing = `${v}px`;
        }, px);

    await space(spacing);
    expect(await naturalWidth(title(page)), 'the premise').toBeGreaterThan(
      room.width
    );
    await expect.poll(() => roomInk(page), 'wider words').toBe(0);
    expect(await titleRoom(page), 'the room did not change').toEqual(room);
    expect(await unrestFor(page, 500)).toEqual({ mutations: 0, errors: [] });

    await space(0);
    await expect.poll(() => roomInk(page), 'words again').toBeGreaterThan(0);
    expect(await unrestFor(page, 500)).toEqual({ mutations: 0, errors: [] });
  });

  // "Tab Keeper" is not translated; this pins the rule outside English anyway.
  for (const rootPx of ROOTS) {
    test(`in German at a ${rootPx}px root the same rule holds`, async ({
      context,
      extensionId,
    }) => {
      const page = await openHome(context, extensionId, 'popup', rootPx, 'de');
      const words = page.getByText(localeStrings('de')['Tab Keeper'], {
        exact: true,
      });
      const room = await titleRoom(page);
      const fits = (await naturalWidth(words)) <= room.width;
      expect(fits, 'the premise').toBe(FITS.popup[rootPx]);

      expect((await roomInk(page)) > 0).toBe(fits);
      expect(await axTextCount(page, localeStrings('de')['Tab Keeper'])).toBe(
        1
      );
    });
  }
});

/** The floppy as drawn before its colours were baked. */
const SOURCE_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="20" height="20"><rect width="128" height="128" fill="#87c68e" fill-opacity="0.6"/><path id="b" d="M15.2 12.6h12.4v3l5 1.3V13h66.6l14.5 14.5v84.3H15.2z"/><use href="#b" x="1.7" y="3.6" fill="#1f313e"/><use href="#b" fill="#3a576d"/><rect x="32.8" y="12.9" width="58.4" height="36.6" rx="1.5" fill="#1f2640"/><rect x="32.8" y="12.9" width="58.4" height="34.7" rx="1.5" fill="#f9e9db"/><rect x="32.9" y="64.8" width="62.5" height="47" rx="2" fill="#f9e9db"/><g fill="#1b2a33"><rect x="71.3" y="18.4" width="15.3" height="26.6" rx="1"/><path d="M42.9 73.8h42.8v7.3H42.9zM20 100.9h5.1v4H20zm81.8-4.6h8.5v10.2h-8.5z"/></g><path fill="#f28c3d" d="M42.9 87.1h42.8v7.5H42.9zm0 12h42.8v7.3H42.9z"/></svg>`;
