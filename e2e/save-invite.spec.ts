import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, POPUP } from './fixtures/onboarding';
import { openLiveWindow } from './fixtures/liveWindows';

// KAN-828. With nothing saved, the save button wears a mint ring that pulses three times on the compositor.

const INVITE = '[data-save-invite]';
// The saved list's save: the full view's Currently open has one of the same name.
const SAVE =
  '[data-save-row] [aria-label="Save all open windows as a session"]';
const COMPOSITED = ['offset', 'computedOffset', 'easing', 'composite'];

const VIEWS = [
  { name: 'popup', path: 'index.html', viewport: POPUP },
  { name: 'full view', path: FULL_VIEW_PATH, viewport: FULL },
] as const;

async function openEmpty(
  context: BrowserContext,
  extensionId: string,
  view: (typeof VIEWS)[number],
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
  settings: Record<string, unknown> = {}
): Promise<Page> {
  await seedSessions(context, buildContainer([]));
  await seedSettings(context, settings);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize(view.viewport);
  await page.goto(`chrome-extension://${extensionId}/${view.path}`);
  await page.locator('[data-empty-list="saved"]').waitFor();
  return page;
}

// The pulse: the CSS animation on the invite's ::before, as Chrome runs it.
const pulse = (page: Page) =>
  page.evaluate((selector) => {
    const invite = document.querySelector(selector);
    const found = document.getAnimations().find((a) => {
      const effect = a.effect;
      return (
        effect instanceof KeyframeEffect &&
        effect.target === invite &&
        effect.pseudoElement === '::before'
      );
    });
    if (!found || !(found.effect instanceof KeyframeEffect)) return null;
    const timing = found.effect.getTiming();
    return {
      iterations: timing.iterations,
      duration: timing.duration,
      properties: [
        ...new Set(found.effect.getKeyframes().flatMap((k) => Object.keys(k))),
      ],
    };
  }, INVITE);

const ringShadow = (page: Page) =>
  page.locator(INVITE).evaluate((el) => getComputedStyle(el).boxShadow);

for (const view of VIEWS) {
  test.describe(view.name, () => {
    test('pulses three times, moving only transform and opacity', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      const running = await pulse(page);
      expect(running).toMatchObject({ iterations: 3, duration: 1800 });
      const moved = (running?.properties ?? []).filter(
        (p) => !COMPOSITED.includes(p)
      );
      expect(moved.sort()).toEqual(['opacity', 'transform']);
    });

    test('the still ring is mint, 2px', async ({ context, extensionId }) => {
      const page = await openEmpty(context, extensionId, view);
      expect(await ringShadow(page)).toBe('rgb(153, 191, 157) 0px 0px 0px 2px');
    });

    for (const rootPx of [16, 20]) {
      test(`the ring's box is the button's at a ${rootPx}px root`, async ({
        context,
        extensionId,
      }) => {
        const page = await openEmpty(context, extensionId, view);
        await page.evaluate((px) => {
          document.documentElement.style.fontSize = `${px}px`;
        }, rootPx);
        const ring = await page.locator(INVITE).boundingBox();
        const button = await page.locator(SAVE).boundingBox();
        expect(ring).not.toBeNull();
        expect(button).not.toBeNull();
        if (!ring || !button) return;
        expect(Math.abs(ring.x - button.x)).toBeLessThan(0.5);
        expect(Math.abs(ring.y - button.y)).toBeLessThan(0.5);
        expect(Math.abs(ring.width - button.width)).toBeLessThan(0.5);
        expect(Math.abs(ring.height - button.height)).toBeLessThan(0.5);
      });
    }

    test('hover stops the pulse, the still ring stays', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      expect(await pulse(page)).not.toBeNull();
      await page.locator(SAVE).hover();
      await expect.poll(() => pulse(page)).toBeNull();
      expect(await ringShadow(page)).toContain('0px 0px 0px 2px');
    });

    test('focus stops the pulse, the still ring stays', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      expect(await pulse(page)).not.toBeNull();
      await page.locator(SAVE).focus();
      await expect.poll(() => pulse(page)).toBeNull();
      expect(await ringShadow(page)).toContain('0px 0px 0px 2px');
    });

    test('after a hover, leaving does not start it again', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      await page.locator(SAVE).hover();
      await expect.poll(() => pulse(page)).toBeNull();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(100);
      expect(await pulse(page)).toBeNull();
    });

    test('after focus, a blur does not start it again', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      await page.locator(SAVE).focus();
      await expect.poll(() => pulse(page)).toBeNull();
      await page.locator(SAVE).blur();
      await page.waitForTimeout(100);
      expect(await pulse(page)).toBeNull();
    });

    test('reduced motion: no pulse, the still ring', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view, 'reduce');
      await expect(page.locator(INVITE)).toHaveCount(1);
      expect(await pulse(page)).toBeNull();
      expect(await ringShadow(page)).toContain('0px 0px 0px 2px');
    });

    test('a click on the ring saves, and the ring goes', async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      await openLiveWindow(serviceWorker, ['Trip notes', 'Flights']);
      const page = await openEmpty(context, extensionId, view);
      const box = await page.locator(INVITE).boundingBox();
      if (!box) throw new Error('no ring');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator('[data-empty-list="saved"]')).toHaveCount(0);
      await expect(page.locator(INVITE)).toHaveCount(0);
      const stored = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('tabContainerData') ?? '{}')
            ?.tabGroups?.length ?? 0
      );
      expect(stored).toBe(1);
      const settings = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('settingsData') ?? '{}')
      );
      expect(settings).toMatchObject({ hasHadSavedSession: true });
    });

    // His call, 02:26: after a first session of the user's, the ring is done on this device.
    test('a device that has held a session shows no ring', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(
        context,
        extensionId,
        view,
        'no-preference',
        {
          hasHadSavedSession: true,
        }
      );
      await expect(page.locator('[data-empty-list="saved"]')).toHaveCount(1);
      await expect(page.locator(INVITE)).toHaveCount(0);
    });

    test('a search hides it; clearing brings it back', async ({
      context,
      extensionId,
    }) => {
      const page = await openEmpty(context, extensionId, view);
      const search = page.getByRole('textbox', {
        name: 'Search saved tabs',
        exact: true,
      });
      await search.fill('trip');
      await expect(page.locator(INVITE)).toHaveCount(0);
      await search.fill('');
      await expect(page.locator(INVITE)).toHaveCount(1);
    });
  });
}
