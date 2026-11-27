import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { openTabGroup, FULL, POPUP } from './fixtures/onboarding';
import { stubToolbarPin } from './fixtures/toolbarPin';
import {
  FULL_RUN,
  cardAt,
  cardButton,
  openRunFromHelp,
  replayNote,
  startRunFromHelp,
} from './fixtures/run';
import {
  motionsOf,
  recordMotion,
  recordMotionFromStart,
} from './fixtures/motionRecord';
import { EASE } from '../src/styles/scale';

// KAN-1033 (picks 1-B, 2-B, 3-B). Setup's steps glide to their height and
// slide their contents in; the tour's dim and ring fade in and out, its card
// shrinks back as it leaves; the full-view callout grows from its notch and
// fades out with the dashed ring. Keys stay instant, but Esc ends the tour
// with the fade. Reduce motion: fades only.

const box = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
  });
const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;
const near = (a: string, b: number) =>
  Math.abs(parseFloat(a) - b) <= 1 ? true : `${a} vs ${b}`;

// ---------------------------------------------------------------- setup
async function openSetup(page: Page) {
  const dialog = page.locator('dialog[open][aria-labelledby="setup-title"]');
  await expect(dialog).toBeVisible();
  // The dialog's own rise has ended.
  await page.waitForTimeout(400);
  return dialog;
}
async function setupPage(
  context: BrowserContext,
  extensionId: string,
  serviceWorker: Worker,
  reducedMotion = false
) {
  await openTabGroup(serviceWorker);
  await stubToolbarPin(context, { pinned: true });
  await seedSessions(context, buildContainer());
  await seedSettings(context, { setupState: 'pending', language: 'en' });
  const page = await context.newPage();
  await page.setViewportSize(FULL);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  return page;
}
const nextButton = (dialog: Locator) =>
  dialog.getByRole('button', { name: 'Next', exact: true });

test.describe('setup steps', () => {
  test('Next: the dialog glides to its new height, the old step fades as a copy, the new one slides in from 8px right; the title row stays', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await setupPage(context, extensionId, serviceWorker);
    const dialog = await openSetup(page);
    const before = await box(dialog);
    await recordMotion(page);
    await nextButton(dialog).click();
    // The old step, as an inert copy fading where it stood.
    const leaving = page.locator('[data-step-leaving]');
    await expect(leaving).toHaveCount(1);
    await expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(await leaving.evaluate((el: HTMLElement) => el.inert)).toBe(true);
    await expect(leaving).toHaveCount(0);
    await page.waitForTimeout(300);
    const after = await box(dialog);
    // PREMISE: the language step is taller than the theme step.
    expect(after.height).toBeGreaterThan(before.height + 50);

    const glide = await motionsOf(page, 'DIALOG');
    expect(glide).toHaveLength(1);
    expect(glide[0]).toMatchObject({ duration: 200, easing: EASE.OUT });
    expect(near(glide[0].keyframes[0].height, before.height)).toBe(true);
    expect(near(glide[0].keyframes[1].height, after.height)).toBe(true);

    const into = await motionsOf(page, '[data-setup-step]');
    expect(into).toHaveLength(1);
    expect(into[0]).toMatchObject({ duration: 150, easing: EASE.OUT });
    expect(into[0].keyframes).toEqual([
      expect.objectContaining({ opacity: '0', translate: '8px' }),
      expect.objectContaining({ opacity: '1', translate: '0px' }),
    ]);
    const out = await motionsOf(page, '[data-step-leaving]');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ duration: 100, easing: EASE.OUT });
    expect(out[0].keyframes.map((k) => k.opacity)).toEqual(['1', '0']);
    // Nothing else in the dialog moves: the title row and progress line stay.
    expect(await motionsOf(page, 'H2')).toEqual([]);
  });

  test('mid-glide the buttons ride the bottom edge and the step passes under them', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await setupPage(context, extensionId, serviceWorker);
    const dialog = await openSetup(page);
    const rest = await page.evaluate(() => {
      const d = document.querySelector('dialog[open]')!.getBoundingClientRect();
      const next = [...document.querySelectorAll('dialog[open] button')].find(
        (b) => b.textContent?.trim() === 'Next'
      )!;
      return d.bottom - next.getBoundingClientRect().bottom;
    });
    await page.mouse.move(1, 1);
    await nextButton(dialog).click();
    const mid = await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = 60;
      }
      const d = document.querySelector('dialog[open]')!.getBoundingClientRect();
      const next = [...document.querySelectorAll('dialog[open] button')].find(
        (b) => b.textContent?.trim() === 'Next'
      )!;
      const foot = next.closest('[data-setup-foot]')!;
      const step = document.querySelector('[data-setup-step]')!;
      return {
        dialogBottom: d.bottom,
        nextBottom: next.getBoundingClientRect().bottom,
        footAbove: Number(getComputedStyle(foot).zIndex) > 0,
        stepBottom: step.getBoundingClientRect().bottom,
        footTop: foot.getBoundingClientRect().top,
      };
    });
    // As far above the bottom edge as at rest, wherever the edge is mid-glide.
    expect(mid.dialogBottom - mid.nextBottom).toBeCloseTo(rest, 0);
    expect(mid.footAbove).toBe(true);
    // PREMISE: the new step reaches past the buttons mid-glide.
    expect(mid.stepBottom).toBeGreaterThan(mid.footTop);
  });

  test('Back slides the earlier step in from 8px left; on step 2 Back fades in and Next glides to its new width', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await setupPage(context, extensionId, serviceWorker);
    const dialog = await openSetup(page);
    const alone = await box(nextButton(dialog));
    await recordMotion(page);
    await nextButton(dialog).click();
    await page.waitForTimeout(400);
    const paired = await box(nextButton(dialog));
    // PREMISE: Next changes width once Back shares the row (1.5× Back's).
    expect(Math.abs(paired.width - alone.width)).toBeGreaterThan(4);
    const back = await motionsOf(page, 'BUTTON');
    expect(back).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          duration: 120,
          keyframes: [
            expect.objectContaining({ opacity: '0' }),
            expect.objectContaining({ opacity: '1' }),
          ],
        }),
        expect.objectContaining({
          duration: 200,
          easing: EASE.OUT,
          keyframes: [
            expect.objectContaining({ width: px(alone.width) }),
            expect.objectContaining({ width: px(paired.width) }),
          ],
        }),
      ])
    );

    await recordMotion(page);
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForTimeout(400);
    const into = await motionsOf(page, '[data-setup-step]');
    expect(into[0].keyframes[0]).toMatchObject({ translate: '-8px' });
  });

  test('Enter on Next changes the step at once', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await setupPage(context, extensionId, serviceWorker);
    const dialog = await openSetup(page);
    await nextButton(dialog).focus();
    await recordMotion(page);
    await page.keyboard.press('Enter');
    await expect(
      dialog.getByRole('button', { name: 'Back', exact: true })
    ).toBeVisible();
    await page.waitForTimeout(400);
    expect(await motionsOf(page, 'DIALOG')).toEqual([]);
    expect(await motionsOf(page, '[data-setup-step]')).toEqual([]);
    expect(await motionsOf(page, '[data-step-leaving]')).toEqual([]);
  });

  test('Reduce motion: the steps cross-fade; nothing glides, slides or widens', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await setupPage(context, extensionId, serviceWorker, true);
    const dialog = await openSetup(page);
    await recordMotion(page);
    await nextButton(dialog).click();
    await page.waitForTimeout(400);
    expect(await motionsOf(page, 'DIALOG')).toEqual([]);
    const into = await motionsOf(page, '[data-setup-step]');
    expect(into).toHaveLength(1);
    expect(into[0].keyframes.map((k) => k.translate ?? 'none')).toEqual([
      'none',
      'none',
    ]);
    expect(await motionsOf(page, '[data-step-leaving]')).toHaveLength(1);
    const widths = (await motionsOf(page, 'BUTTON')).filter(
      (m) => 'width' in m.keyframes[0]
    );
    expect(widths).toEqual([]);
  });
});

// ---------------------------------------------------------------- tour
const dimCopies = (page: Page) => page.locator('[data-leaving-copy="dim"]');
const cardCopies = (page: Page) => page.locator('[data-leaving-copy="card"]');

async function toNote(page: Page) {
  await cardButton(page, 'Skip tutorial').click();
  await expect(replayNote(page)).toBeVisible();
  await page.waitForTimeout(500);
}

test.describe('tour', () => {
  test('start: the dim and ring fade in over 200ms as the card grows in', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize(FULL);
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await recordMotion(page);
    await startRunFromHelp(page);
    await expect(cardAt(page, 1)).toBeVisible();
    await page.waitForTimeout(400);
    for (const who of ['[data-coach-dim]', '[data-coach-ring]']) {
      const fade = await motionsOf(page, who);
      expect(fade, who).toEqual([
        expect.objectContaining({
          duration: 200,
          easing: EASE.OUT,
          keyframes: [
            expect.objectContaining({ opacity: '0' }),
            expect.objectContaining({ opacity: '1' }),
          ],
        }),
      ]);
    }
  });

  test('Skip hands the dim to the note: it neither fades out nor in', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await openRunFromHelp(context, extensionId, FULL_RUN);
    await page.waitForTimeout(500);
    await recordMotion(page);
    await cardButton(page, 'Skip tutorial').click();
    await expect(replayNote(page)).toBeVisible();
    await expect(dimCopies(page)).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await motionsOf(page, '[data-coach-dim]')).toEqual([]);
    // The step's card leaves as the note's grows in.
    expect(await motionsOf(page, '[data-leaving-copy]')).not.toEqual([]);
  });

  for (const how of ['Got it', 'Escape'] as const) {
    test(`${how} on the note: the card shrinks toward what it points at in 150ms, the dim and ring fade over 200ms`, async ({
      context,
      extensionId,
    }) => {
      await seedSessions(context, buildContainer());
      const page = await openRunFromHelp(context, extensionId, FULL_RUN);
      await toNote(page);
      const side = await replayNote(page).getAttribute('data-coach-side');
      await recordMotion(page);
      if (how === 'Got it') await cardButton(page, 'Got it').click();
      else await page.keyboard.press('Escape');
      await expect(replayNote(page)).toHaveCount(0);
      // Gone to everything but the eye at once.
      await expect(page.locator('[data-coach-dim]')).toHaveCount(0);
      await expect(cardCopies(page)).toHaveCount(1);
      await expect(page.locator('[data-leaving-copy]')).toHaveCount(0);
      const all = await motionsOf(page, '[data-leaving-copy]');
      const card = all.filter((m) => 'scale' in m.keyframes[0]);
      expect(card).toEqual([
        expect.objectContaining({
          duration: 150,
          easing: EASE.OUT,
          keyframes: [
            expect.objectContaining({ opacity: '1', scale: '1' }),
            expect.objectContaining({ opacity: '0', scale: '0.97' }),
          ],
        }),
      ]);
      // PREMISE: the note hangs below the gear.
      expect(side).toBe('below');
      expect(card[0].origin.split(' ')[1]).toBe('0px');
      const fades = all.filter(
        (m) => !('scale' in m.keyframes[0]) && m.duration === 200
      );
      // The dim and the ring round the gear.
      expect(fades).toHaveLength(2);
    });
  }

  test('Reduce motion: the start shows at once; at the end the card and dim fade out, nothing shrinks', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.setViewportSize(FULL);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await recordMotion(page);
    await startRunFromHelp(page);
    await expect(cardAt(page, 1)).toBeVisible();
    await page.waitForTimeout(400);
    expect(await motionsOf(page, '[data-coach-dim]')).toEqual([]);
    expect(await motionsOf(page, '[data-coach-ring]')).toEqual([]);
    await toNote(page);
    await recordMotion(page);
    await cardButton(page, 'Got it').click();
    await page.waitForTimeout(400);
    const all = await motionsOf(page, '[data-leaving-copy]');
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.filter((m) => 'scale' in m.keyframes[0])).toEqual([]);
  });
});

// ---------------------------------------------------------------- callout
const callout = (page: Page) => page.locator('[data-full-view-callout]');
const expandAnchor = (page: Page) =>
  page.locator('[data-tour-anchor="expand"]');

async function calloutPopup(
  context: BrowserContext,
  extensionId: string,
  reducedMotion = false
) {
  await seedSessions(context, buildContainer());
  await seedSettings(context, { isFullViewCalloutSeen: false });
  await recordMotionFromStart(context);
  const page = await context.newPage();
  await page.setViewportSize(POPUP);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(callout(page)).toBeVisible();
  await page.waitForTimeout(400);
  return page;
}

test.describe('full-view callout', () => {
  test('grows from the notch under ⤢ in 160ms, and the dashed ring fades in with it', async ({
    context,
    extensionId,
  }) => {
    const page = await calloutPopup(context, extensionId);
    const grow = await motionsOf(page, '[data-full-view-callout]');
    expect(grow).toEqual([
      expect.objectContaining({
        duration: 160,
        easing: EASE.OUT,
        keyframes: [
          expect.objectContaining({ opacity: '0', scale: '0.96' }),
          expect.objectContaining({ opacity: '1', scale: '1' }),
        ],
      }),
    ]);
    // From the notch: under ⤢'s middle, at the callout's top edge.
    const [x, y] = grow[0].origin.split(' ').map(parseFloat);
    const c = await box(callout(page));
    const a = await expandAnchor(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    const left = await callout(page).evaluate(
      (el) => el.getBoundingClientRect().left
    );
    expect(y).toBe(0);
    expect(Math.abs(left + x - a)).toBeLessThanOrEqual(1);
    expect(c.height).toBeGreaterThan(0);
    const ring = await motionsOf(page, '[data-tour-anchor]');
    expect(ring).toEqual([
      expect.objectContaining({
        duration: 160,
        easing: EASE.OUT,
        keyframes: [
          expect.objectContaining({ outlineColor: 'rgba(0, 0, 0, 0)' }),
          expect.anything(),
        ],
      }),
    ]);
  });

  test('Close: the callout and the ring fade out together over 150ms', async ({
    context,
    extensionId,
  }) => {
    const page = await calloutPopup(context, extensionId);
    await recordMotion(page);
    await callout(page).getByRole('button', { name: 'Close' }).click();
    await expect(callout(page)).toHaveCount(0);
    // The real ring is gone at once; a copy holding ⤢, its ring and the callout fades.
    expect(
      await expandAnchor(page).evaluate(
        (el) => getComputedStyle(el).outlineStyle
      )
    ).toBe('none');
    const copy = page.locator('[data-leaving-copy]');
    await expect(copy).toHaveCount(1);
    await expect(copy).toContainText('See your saved sessions');
    await expect(copy).toHaveCount(0);
    const fade = await motionsOf(page, '[data-leaving-copy]');
    expect(fade).toEqual([
      expect.objectContaining({
        duration: 150,
        keyframes: [
          expect.objectContaining({ opacity: '1' }),
          expect.objectContaining({ opacity: '0' }),
        ],
      }),
    ]);
  });

  test('Reduce motion: it fades in, nothing grows', async ({
    context,
    extensionId,
  }) => {
    const page = await calloutPopup(context, extensionId, true);
    const grow = await motionsOf(page, '[data-full-view-callout]');
    expect(grow).toHaveLength(1);
    expect(grow[0].keyframes.map((k) => k.scale ?? 'none')).toEqual([
      'none',
      'none',
    ]);
    expect(grow[0].keyframes.map((k) => k.opacity)).toEqual(['0', '1']);
  });
});
