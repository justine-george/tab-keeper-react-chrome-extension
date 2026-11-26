import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import { pageGround } from './fixtures/onboarding';
import { BB_PINK_THEME, CHARCOAL_THEME } from '../src/hooks/useThemeColors';
import { EASE } from '../src/styles/scale';

// KAN-1024 on the real artifact. A theme pick: the new tile's check pops in
// (half size to full, 200 ms) as the old one fades where it is (120 ms); the
// tiles' frames change at once; the page cross-fades to the new colors
// (a 250 ms view transition of the whole page, the setup dialog included).
// The toolbar icon tiles move their check the same way, with no
// page fade. Reduced motion keeps all of it still.

interface Seen {
  who: string;
  pseudo: string | null;
  duration: number;
  easing: string;
  keyframes: Array<Record<string, string | null>>;
}

// Records every animation that starts on the page from now on and runs, with
// who it moves: a tile's check or frame (by the tile's name), or the page
// itself. One gone within two frames was cancelled, not run: the hover's colour
// transition that the pick replaces.
const record = (page: Page) =>
  page.evaluate(() => {
    const seen = new Map<Animation, { frames: number }>();
    const out: unknown[] = [];
    (window as unknown as { __seen: unknown[] }).__seen = out;
    const who = (el: Element | null): string => {
      if (el === document.documentElement) return 'page';
      const button = el?.closest('button[aria-pressed]');
      const name = button?.lastElementChild?.textContent ?? '?';
      if (el?.matches('[data-swatch-check]')) return `${name} check`;
      if (el?.matches('[data-swatch-tile]')) return `${name} frame`;
      return el?.tagName ?? '?';
    };
    const tick = () => {
      for (const a of document.getAnimations()) {
        const known = seen.get(a);
        if (known !== undefined) {
          known.frames++;
          continue;
        }
        const effect = a.effect as KeyframeEffect;
        const timing = effect.getTiming();
        const entry = {
          who: who(effect.target),
          pseudo: effect.pseudoElement,
          duration: Number(timing.duration),
          easing: String(timing.easing),
          keyframes: effect.getKeyframes().map((k) => ({
            opacity: (k.opacity as string) ?? null,
            transform: (k.transform as string) ?? null,
            visibility: (k.visibility as string) ?? null,
            borderColor: (k.borderColor as string) ?? null,
          })),
          frames: 1,
        };
        seen.set(a, entry);
        out.push(entry);
      }
      requestAnimationFrame(tick);
    };
    tick();
  });

const seenSoFar = (page: Page): Promise<Seen[]> =>
  page.evaluate(() =>
    (window as unknown as { __seen: (Seen & { frames: number })[] }).__seen
      .filter((s) => s.frames > 2)
      .map((s) => ({ ...s, frames: undefined }))
  );

// Everything that started within half a second of a press on `target`. The
// pointer arrives first and settles, so its hover fade is not counted.
async function afterPress(page: Page, target: Locator) {
  await target.hover();
  await page.waitForTimeout(300);
  await record(page);
  await target.click();
  await page.waitForTimeout(500);
  return seenSoFar(page);
}

const tile = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole('button', { name, exact: true });

const hex = (rgb: string): string =>
  '#' +
  (rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

async function openThemes(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await expect(page.getByText('Themes')).toBeVisible();
  await page.mouse.move(0, 0);
}

function expectMarkerMotion(seen: Seen[], from: string, to: string) {
  const of = (who: string) => seen.filter((s) => s.who === who);
  // The new check: fades in over 120 ms and grows from half size over 200 ms.
  const inCheck = of(`${to} check`);
  expect(inCheck).toContainEqual(
    expect.objectContaining({
      duration: 120,
      keyframes: [
        expect.objectContaining({ opacity: '0' }),
        expect.objectContaining({ opacity: '1' }),
      ],
    })
  );
  expect(inCheck).toContainEqual(
    expect.objectContaining({
      duration: 200,
      easing: EASE.OUT,
      keyframes: [
        expect.objectContaining({ transform: 'scale(0.5)' }),
        expect.objectContaining({ transform: 'none' }),
      ],
    })
  );
  // The old check fades out where it is, shown until it has.
  expect(of(`${from} check`)).toEqual([
    expect.objectContaining({
      duration: 120,
      keyframes: [
        expect.objectContaining({ opacity: '1', visibility: 'visible' }),
        expect.objectContaining({ opacity: '0', visibility: 'visible' }),
      ],
    }),
  ]);
  // Both frames change at once: nothing runs on them, the hover's fade included.
  for (const who of [`${to} frame`, `${from} frame`])
    expect(of(who)).toEqual([]);
}

test.describe('Settings › Appearance (popup)', () => {
  test('a theme pick pops the check in, switches the frames and cross-fades the page', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme: 'Chalk' });
    const page = await context.newPage();
    await openThemes(page, extensionId);

    const seen = await afterPress(page, tile(page, 'Charcoal'));
    expectMarkerMotion(seen, 'Chalk', 'Charcoal');
    // The whole page: old picture out, new picture in, 250 ms each.
    const fade = seen.filter((s) => s.who === 'page');
    expect(fade.map((f) => [f.pseudo, f.duration])).toEqual(
      expect.arrayContaining([
        ['::view-transition-old(root)', 250],
        ['::view-transition-new(root)', 250],
      ])
    );

    // At rest it is today's picker on today's colors.
    expect(await pageGround(page)).toBe(CHARCOAL_THEME.PRIMARY_COLOR);
    await expect(
      tile(page, 'Charcoal').locator('[data-swatch-check]')
    ).toBeVisible();
    await expect(
      tile(page, 'Chalk').locator('[data-swatch-check]')
    ).toBeHidden();
    const border = (name: string) =>
      tile(page, name)
        .locator('[data-swatch-tile]')
        .evaluate((el) => [
          getComputedStyle(el).borderTopWidth,
          getComputedStyle(el).borderTopColor,
        ]);
    expect((await border('Charcoal'))[0]).toBe('2px');
    expect(hex((await border('Charcoal'))[1])).toBe(
      CHARCOAL_THEME.LABEL_L1_COLOR
    );
    expect(await border('Chalk')).toEqual(['1px', expect.any(String)]);
  });

  test('a second pick from the keyboard mid-fade lands, and the fade ends clean', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme: 'Chalk' });
    const page = await context.newPage();
    await openThemes(page, extensionId);

    await tile(page, 'Charcoal').click();
    // Mid-fade: Petal, the tile before Charcoal, with the keys.
    await page.keyboard.press('Shift+Tab');
    expect(
      await page.evaluate(() =>
        document.documentElement.hasAttribute('data-theme-pick')
      )
    ).toBe(true);
    await page.keyboard.press('Enter');

    await expect(tile(page, 'Petal')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => pageGround(page)).toBe(BB_PINK_THEME.PRIMARY_COLOR);
    // The first fade ending does not take the second's flag with it; both end.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.hasAttribute('data-theme-pick')
        )
      )
      .toBe(false);
  });

  test('a toolbar icon pick moves its check the same way, and the page stays', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme: 'Chalk', toolbarIcon: 'colour' });
    const page = await context.newPage();
    await openThemes(page, extensionId);
    const group = page.getByRole('group', { name: 'Toolbar icon' });
    // The name, not the check's glyph text.
    const nameOf = (pressed: boolean) =>
      group
        .locator(`button[aria-pressed="${pressed}"] > :last-child`)
        .innerText();
    const from = await nameOf(true);
    const to = await nameOf(false);

    const seen = await afterPress(page, tile(group, to));
    expectMarkerMotion(seen, from, to);
    expect(seen.filter((s) => s.who === 'page')).toEqual([]);
  });
});

test.describe('the setup dialog (full view)', () => {
  test('the whole page cross-fades, dialog and panes as one picture', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, {
      theme: 'Chalk',
      setupState: 'pending',
      hasOpenedFullView: true,
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    const setup = page.getByRole('dialog', { name: 'Make Tab Keeper yours' });
    await expect(tile(setup, 'Charcoal')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);

    const seen = await afterPress(page, tile(setup, 'Charcoal'));
    expectMarkerMotion(seen, 'Chalk', 'Charcoal');
    const fade = seen.filter((s) => s.who === 'page');
    expect(fade.map((f) => [f.pseudo, f.duration])).toEqual(
      expect.arrayContaining([
        ['::view-transition-old(root)', 250],
        ['::view-transition-new(root)', 250],
      ])
    );
    // The panes are not pictured on their own (their own motions snap them).
    expect(fade.filter((f) => f.pseudo?.includes('pane-'))).toEqual([]);
    expect(await pageGround(page)).toBe(CHARCOAL_THEME.PRIMARY_COLOR);
    // Pane motions still picture only the panes once the pick is over.
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          'view-transition-name'
        )
      )
    ).toBe('none');
  });
});

test.describe('reduce motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a theme pick changes everything at once', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme: 'Chalk' });
    const page = await context.newPage();
    await openThemes(page, extensionId);

    const seen = await afterPress(page, tile(page, 'Charcoal'));
    expect(seen).toEqual([]);
    expect(await pageGround(page)).toBe(CHARCOAL_THEME.PRIMARY_COLOR);
    await expect(
      tile(page, 'Charcoal').locator('[data-swatch-check]')
    ).toBeVisible();
    await expect(
      tile(page, 'Chalk').locator('[data-swatch-check]')
    ).toBeHidden();
  });
});
