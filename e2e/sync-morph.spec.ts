import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Page, Route } from '@playwright/test';

import { DIST, hasCloudConfig } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { rgbToHex } from './fixtures/pixels';
import { seedSessions, seedSettings } from './fixtures/seed';
import { CHALK_THEME } from '../src/hooks/useThemeColors';
import {
  CLOUD_DONE_PATH,
  SYNC_PATH,
  SYNC_PROBLEM_PATH,
} from '../src/components/common/syncMorph.data';
import {
  MORPH_MS,
  UNPRESSED_DELAY_MS,
} from '../src/components/common/syncMotion';

// KAN-750, in the real bundle. The sync button's `sync` glyph turns while a
// sync runs and morphs into `cloud_done` when it lands, or into `sync_problem`
// when it fails; a press morphs it back.
// Reduced motion swaps the two at once. Read from SyncGlyph's data-glyph and
// data-turning, and from the path it draws, frame by frame in the page.
//
// A morph needs a sync that lands, so this signs in to the dev cloud (KAN-383)
// and holds the sync open on its read. CI's build has no cloud, so those skip.
test.use({ cloud: true });

// firebase/firestore/lite reads a document with one REST batchGet.
const READ = /firestore\.googleapis\.com\/.*documents:batchGet/;

const syncButton = (page: Page) =>
  page.getByRole('button', { name: /^(Sync now|Syncing…)$/ });
const glyph = (page: Page) => syncButton(page).locator('[data-glyph]');

interface ReadHold {
  // Resolves when the held read reaches the network.
  arrived: Promise<void>;
  release: () => void;
  // Ends the held read with a network error, so the sync fails.
  fail: () => void;
}

// Holds the next cloud read until released or failed; every other read passes.
async function readGate(page: Page): Promise<() => ReadHold> {
  let next: { arrived: () => void; gate: Promise<'pass' | 'fail'> } | null =
    null;
  await page.route(READ, async (route: Route) => {
    const hold = next;
    next = null;
    if (hold) {
      hold.arrived();
      if ((await hold.gate) === 'fail') return route.abort();
    }
    await route.continue();
  });
  return () => {
    let arrived: () => void = () => {};
    let end: (how: 'pass' | 'fail') => void = () => {};
    const reached = new Promise<void>((r) => (arrived = r));
    next = { arrived, gate: new Promise((r) => (end = r)) };
    return {
      arrived: reached,
      release: () => end('pass'),
      fail: () => end('fail'),
    };
  };
}

// Auto Sync on, so opening the page starts the boot sync.
async function openPage(context: BrowserContext) {
  await seedSessions(context);
  await seedSettings(context, { isAutoSync: true, theme: 'Chalk' });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  const holdNextRead = await readGate(page);
  return { page, holdNextRead };
}

async function goto(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(syncButton(page)).toBeVisible();
}

// A sign-in Firebase refuses ends the sync with no read: fail on that, not a timeout.
async function readReached(page: Page, hold: ReadHold): Promise<void> {
  let reached = false;
  void hold.arrived.then(() => (reached = true));
  await expect
    .poll(
      async () =>
        reached ||
        (await glyph(page).getAttribute('data-glyph')) === 'sync_problem',
      { timeout: 20_000 }
    )
    .toBe(true);
  expect(reached, 'the sync never read the cloud').toBe(true);
}

interface Frame {
  t: number;
  glyph: string | null;
  turning: string | null;
  layers: number;
  // The top layer's path and its svg's rotation.
  d: string | null;
  transform: string;
  box: { x: number; y: number; w: number; h: number } | null;
}

interface SampleOptions {
  // Click the button on the first frame.
  press: boolean;
  // Sample until this many ms after `until` is first the glyph, or after the start.
  until: string | null;
  forMs: number;
}

// Every animation frame, in the page: polling from Node misses frames.
function sampleFrames(page: Page, options: SampleOptions): Promise<Frame[]> {
  return page.evaluate(
    ({ press, until, forMs }) =>
      new Promise<Frame[]>((resolve, reject) => {
        const roots = document.querySelectorAll('[data-glyph]');
        const button = roots[0]?.closest('[role="button"]');
        if (roots.length !== 1 || !(button instanceof HTMLElement)) {
          reject(new Error(`${roots.length} sync glyphs on the page`));
          return;
        }
        const root = roots[0];
        const frames: Frame[] = [];
        const start = performance.now();
        let from: number | null = until === null ? start : null;
        const step = () => {
          const t = performance.now();
          const svg = root.lastElementChild?.querySelector('svg') ?? null;
          const path = svg?.querySelector('path') ?? null;
          const r = path?.getBoundingClientRect();
          const shown = root.getAttribute('data-glyph');
          frames.push({
            t: t - start,
            glyph: shown,
            turning: root.getAttribute('data-turning'),
            layers: root.childElementCount,
            d: path?.getAttribute('d') ?? null,
            transform: svg ? getComputedStyle(svg).transform : 'none',
            box: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
          });
          if (from === null && shown === until) from = t;
          // A cap, so a glyph that never comes ends the wait with the frames.
          const done = from !== null ? t - from >= forMs : t - start >= 20_000;
          if (done) {
            document.body.dataset.sampling = 'done';
            resolve(frames);
          } else requestAnimationFrame(step);
        };
        requestAnimationFrame(() => {
          document.body.dataset.sampling = 'started';
          if (press) button.click();
          step();
        });
      }),
    options
  );
}

// A failed read ends at once, unlike a released one: wait for the first frame.
async function samplingStarted(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.body.dataset.sampling === 'started'
  );
}

const distinct = (frames: Frame[]) => new Set(frames.map((f) => f.d)).size;

// From when `name` was first the glyph.
function framesFrom(frames: Frame[], name: string): Frame[] {
  const i = frames.findIndex((f) => f.glyph === name);
  return i < 0 ? [] : frames.slice(i);
}

// A morph draws a new outline every frame, frame rate aside, until the glyph's
// own outline (`end`) replaces it. Two may repeat: the first (the render's t=0
// outline) and the last (t=1, until its timer swaps it). Cut at `end`, since a
// stalled first frame lets the morph's timer end it under MORPH_MS after it.
function expectMorphed(frames: Frame[], name: string, end: string): void {
  const from = framesFrom(frames, name);
  const ended = from.findIndex((f) => f.d === end);
  const during = (ended < 0 ? from : from.slice(0, ended)).filter(
    (f) => f.t - from[0].t < MORPH_MS
  );
  expect(during.length, `no frame morphed into ${name}`).toBeGreaterThan(0);
  expect(distinct(during), 'the outline did not morph').toBeGreaterThanOrEqual(
    Math.max(5, during.length - 2)
  );
}

test.describe('the sync glyph turns and morphs (KAN-750)', () => {
  test.beforeEach(() => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  });

  test('turns while syncing and morphs into done', async ({
    context,
    extensionId,
  }, testInfo) => {
    const { page, holdNextRead } = await openPage(context);
    const hold = holdNextRead();
    await goto(page, extensionId);
    await readReached(page, hold);
    await expect(glyph(page)).toHaveAttribute('data-glyph', 'sync');
    await expect(glyph(page)).toHaveAttribute('data-turning', 'true');

    const sampled = sampleFrames(page, {
      press: false,
      until: 'cloud_done',
      forMs: 600,
    });
    hold.release();
    const frames = await sampled;
    writeFileSync(testInfo.outputPath('frames.json'), JSON.stringify(frames));

    // PREMISE: sampling began while it still turned, so it saw the morph start.
    expect(frames[0].glyph).toBe('sync');
    expect(frames[0].turning).toBe('true');
    expectMorphed(frames, 'cloud_done', CLOUD_DONE_PATH);
    await expect(glyph(page)).toHaveAttribute('data-glyph', 'cloud_done');
    await expect(glyph(page).locator('path')).toHaveCount(1);
    await expect(glyph(page).locator('path')).toHaveAttribute(
      'd',
      CLOUD_DONE_PATH
    );
  });

  test('a press morphs the cloud back into turning arrows', async ({
    context,
    extensionId,
  }, testInfo) => {
    const { page, holdNextRead } = await openPage(context);
    await goto(page, extensionId);
    // The boot sync lands and its morph ends on the cloud's own outline.
    await expect(glyph(page)).toHaveAttribute('data-glyph', 'cloud_done', {
      timeout: 20_000,
    });
    await expect(glyph(page).locator('path')).toHaveAttribute(
      'd',
      CLOUD_DONE_PATH
    );

    // The press's read waits, so the sync is still running when sampling ends.
    const hold = holdNextRead();
    const frames = await sampleFrames(page, {
      press: true,
      until: null,
      forMs: 500,
    });
    writeFileSync(testInfo.outputPath('frames.json'), JSON.stringify(frames));

    expectMorphed(frames, 'sync', SYNC_PATH);
    await expect(glyph(page)).toHaveAttribute('data-glyph', 'sync');
    await expect(glyph(page)).toHaveAttribute('data-turning', 'true');
    await expect(glyph(page).locator('path')).toHaveCount(1);
    await expect(glyph(page).locator('path')).toHaveAttribute('d', SYNC_PATH);
    // CONTROL: the press started a sync, not just a redraw.
    await readReached(page, hold);
    hold.release();
  });

  test('a failure morphs into sync_problem, and a retry turns it back', async ({
    context,
    extensionId,
  }, testInfo) => {
    const { page, holdNextRead } = await openPage(context);
    const hold = holdNextRead();
    await goto(page, extensionId);
    await readReached(page, hold);
    await expect(glyph(page)).toHaveAttribute('data-glyph', 'sync');
    await expect(glyph(page)).toHaveAttribute('data-turning', 'true');

    const sampled = sampleFrames(page, {
      press: false,
      until: 'sync_problem',
      forMs: 600,
    });
    await samplingStarted(page);
    hold.fail();
    const frames = await sampled;
    writeFileSync(
      testInfo.outputPath('fail-frames.json'),
      JSON.stringify(frames)
    );

    // PREMISE: sampling began while it still turned, so it saw the morph start.
    expect(frames[0].glyph).toBe('sync');
    expect(frames[0].turning).toBe('true');
    expectMorphed(frames, 'sync_problem', SYNC_PROBLEM_PATH);
    // A morph, not a crossfade: one layer on every frame.
    expect(frames.map((f) => f.layers)).toEqual(frames.map(() => 1));
    await expect(glyph(page)).toHaveAttribute('data-glyph', 'sync_problem');
    await expect(glyph(page)).toHaveAttribute('data-turning', 'false');
    await expect(glyph(page).locator('path')).toHaveCount(1);
    await expect(glyph(page).locator('path')).toHaveAttribute(
      'd',
      SYNC_PROBLEM_PATH
    );

    // The retry's read waits, so the sync is still running when sampling ends.
    const retry = holdNextRead();
    const pressed = await sampleFrames(page, {
      press: true,
      until: null,
      forMs: 500,
    });
    writeFileSync(
      testInfo.outputPath('retry-frames.json'),
      JSON.stringify(pressed)
    );
    expectMorphed(pressed, 'sync', SYNC_PATH);
    await expect(glyph(page)).toHaveAttribute('data-glyph', 'sync');
    await expect(glyph(page)).toHaveAttribute('data-turning', 'true');
    await expect(glyph(page).locator('path')).toHaveAttribute('d', SYNC_PATH);
    // CONTROL: the press started a sync, not just a redraw.
    await readReached(page, retry);
    retry.release();
  });

  test('no in-between frames under reduced motion', async ({
    context,
    extensionId,
  }, testInfo) => {
    const { page, holdNextRead } = await openPage(context);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const hold = holdNextRead();
    await goto(page, extensionId);
    // CONTROL: the page sees the preference.
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    ).toBe(true);
    await readReached(page, hold);
    await expect(syncButton(page)).toHaveAccessibleName('Syncing…');

    // Twice the wait before an unpressed sync shows: long enough to be shown.
    const syncing = await sampleFrames(page, {
      press: false,
      until: null,
      forMs: 2 * UNPRESSED_DELAY_MS,
    });
    expect(syncing.map((f) => f.glyph)).toEqual(syncing.map(() => 'sync'));
    expect(syncing.map((f) => f.turning)).toEqual(syncing.map(() => 'false'));
    expect(syncing.map((f) => f.transform)).toEqual(syncing.map(() => 'none'));

    const sampled = sampleFrames(page, {
      press: false,
      until: 'cloud_done',
      forMs: 600,
    });
    hold.release();
    const frames = await sampled;
    writeFileSync(testInfo.outputPath('frames.json'), JSON.stringify(frames));

    expect(framesFrom(frames, 'cloud_done').length).toBeGreaterThan(0);
    expect(distinct(frames), 'a frame between the two').toBeLessThanOrEqual(2);
    // No crossfade either: one layer on every frame.
    expect(frames.map((f) => f.layers)).toEqual(frames.map(() => 1));
    await expect(glyph(page).locator('path')).toHaveAttribute(
      'd',
      CLOUD_DONE_PATH
    );
  });

  test('turning glyph keeps the dimmed look', async ({
    context,
    extensionId,
  }) => {
    const { page, holdNextRead } = await openPage(context);
    const hold = holdNextRead();
    await goto(page, extensionId);
    await readReached(page, hold);
    // PREMISE: the button is dimmed for the running sync (KAN-342).
    await expect(syncButton(page)).toHaveAccessibleName('Syncing…');
    await expect(syncButton(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(glyph(page)).toHaveAttribute('data-turning', 'true');
    await expect(glyph(page).locator('svg')).toHaveCount(1);

    const look = await syncButton(page).evaluate((button) => {
      // The opacity an element is painted at: its own times every ancestor's.
      const effective = (el: Element) => {
        let product = 1;
        for (let at: Element | null = el; at; at = at.parentElement)
          product *= Number(getComputedStyle(at).opacity);
        return product;
      };
      const svg = button.querySelector('[data-glyph] svg');
      const settings = document.querySelector(
        '[aria-label="Settings"] .material-symbols-outlined'
      );
      if (!svg || !settings) throw new Error('no glyph to read');
      return {
        glyph: effective(svg),
        button: effective(button),
        fill: getComputedStyle(svg).fill,
        ligature: getComputedStyle(settings).color,
      };
    });
    // Drawn at the Icon's own opacity, nothing of its own on top.
    expect(look.glyph).toBe(look.button);
    // In the theme's text colour, the ink of the ligature beside it.
    expect(rgbToHex(look.fill)).toBe(CHALK_THEME.TEXT_COLOR);
    expect(look.fill).toBe(look.ligature);
    hold.release();
  });
});

// flubber bakes the outlines at build time (scripts/build_sync_morph.mjs); none
// of it ships. Its own strings, which the minifier keeps.
const FLUBBER_STRINGS = [
  'flubber.all() expects two arrays',
  'SvgPath: invalid float exponent',
];

test('ships no flubber', () => {
  // CONTROL: the strings are flubber's, so their absence below means something.
  const flubber = readFileSync(
    fileURLToPath(
      new URL('../node_modules/flubber/build/flubber.min.js', import.meta.url)
    ),
    'utf8'
  );
  for (const s of FLUBBER_STRINGS) expect(flubber).toContain(s);

  const assets = join(DIST, 'assets');
  const scripts = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((name) => ({ name, js: readFileSync(join(assets, name), 'utf8') }));
  // Names, not contents: a failure should not print the bundle.
  const holding = (text: string) =>
    scripts.filter(({ js }) => js.includes(text)).map(({ name }) => name);
  // CONTROL: this is the build with the morph in it.
  expect(holding(CLOUD_DONE_PATH)).not.toEqual([]);
  for (const s of FLUBBER_STRINGS) expect(holding(s), s).toEqual([]);
});
