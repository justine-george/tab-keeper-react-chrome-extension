import type { Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  seedSessions,
  seedSettings,
  seedSettingsIfAbsent,
} from './fixtures/seed';
import {
  THEMES,
  openFullView,
  openPopup,
  pageGround,
  storedSettings,
  waitForFullView,
} from './fixtures/onboarding';
import { setPin, stubToolbarPin } from './fixtures/toolbarPin';
import { expectReadable } from './fixtures/textContrast';
import { contrast } from './fixtures/pixels';
import { finishFullRun, pastCompactViewCard } from './fixtures/run';

// KAN-7 §4 on the real build. The review card, due in most of these seeds, is
// the barrier for a negative: it shows only once nothing covers the page
// (KAN-653), so its showing proves the guide already said no.

const DAY = 24 * 60 * 60 * 1000;
const REVIEW_DUE = {
  isNeverAskAgainToRate: false,
  extensionInstalledTime: Date.now() - 2 * DAY,
};
const guide = (page: Page) =>
  page.getByRole('dialog', {
    name: 'Pin Tab Keeper to your toolbar',
    exact: true,
  });
const reviewCard = (page: Page) =>
  page.getByRole('complementary', {
    name: 'Thanks for using Tab Keeper',
    exact: true,
  });
const captions = (page: Page) => guide(page).locator('[data-pin-step-caption]');

test('unpinned and not dismissed: the full view shows it, unlit, waiting, ahead of the review card', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false, ...REVIEW_DUE });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();
  await expect(reviewCard(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.activeElement === document.querySelector('dialog[open]')
    )
  ).toBe(true);
  await expect(captions(page)).toHaveText([
    'Click the puzzle piece',
    'Click the pin next to Tab Keeper',
    'Tab Keeper stays on your toolbar',
  ]);
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Waiting for you to pin…');
});

for (const [name, pinned] of [
  ['pinned', true],
  ['no getUserSettings', 'absent'],
] as const) {
  test(`${name}: no guide, and the review card shows`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned });
    await seedSettings(context, { isPinGuideDismissed: false, ...REVIEW_DUE });
    const page = await openFullView(context, extensionId);
    await expect(reviewCard(page)).toBeVisible();
    await expect(guide(page)).toHaveCount(0);
  });
}

test('a pin ticks step 3, says so, and closes itself without dismissing', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();

  await setPin(page, true);
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Pinned. Closing…');
  await expect(
    captions(page).nth(2).locator('.material-symbols-outlined')
  ).toHaveText('check');
  await expect(guide(page)).toBeVisible();
  await expect(guide(page)).toHaveCount(0, { timeout: 5000 });
  expect((await storedSettings(page)).isPinGuideDismissed).toBe(false);
});

test('without the event, coming back to the window re-reads the pin', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false, event: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();

  await setPin(page, true);
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Waiting for you to pin…');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    guide(page).getByRole('status').locator('[data-pin-status-words]')
  ).toHaveText('Pinned. Closing…');
});

test('never in the popup', async ({ context, extensionId }) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false, ...REVIEW_DUE });
  const page = await openPopup(context, extensionId);
  await expect(reviewCard(page)).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
});

test('an existing user who never pinned sees it; with setup not started, nothing follows it', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSessions(context, buildContainer());
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await guide(page).getByRole('button', { name: 'Skip', exact: true }).click();
  // The dismissal is stored in the same dispatch that would open setup.
  await expect
    .poll(async () => (await storedSettings(page)).isPinGuideDismissed)
    .toBe(true);
  await expect(guide(page)).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('with setup pending, unpinned: setup opens first, and the guide when it closes', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, {
    isPinGuideDismissed: false,
    setupState: 'pending',
  });
  const page = await openFullView(context, extensionId);
  const setup = page.getByRole('dialog', {
    name: 'Make Tab Keeper yours',
    exact: true,
  });
  await expect(setup).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
  await setup.getByText('Skip setup', { exact: true }).click();
  await expect(guide(page)).toBeVisible();
  await expect(setup).toHaveCount(0);
});

test.describe('dismissals stick on this machine', () => {
  test.use({ freshProfile: true });

  for (const how of ['Skip', 'Close', 'Escape'] as const) {
    test(`${how} dismisses it for good`, async ({ context, extensionId }) => {
      await stubToolbarPin(context, { pinned: false });
      await seedSettingsIfAbsent(context, {
        isPinGuideDismissed: false,
        ...REVIEW_DUE,
      });
      const page = await openFullView(context, extensionId);
      await expect(guide(page)).toBeVisible();
      if (how === 'Escape') await page.keyboard.press('Escape');
      else
        await guide(page)
          .getByRole('button', { name: how, exact: true })
          .click();
      await expect(guide(page)).toHaveCount(0);
      expect((await storedSettings(page)).isPinGuideDismissed).toBe(true);

      await page.reload();
      await expect(reviewCard(page)).toBeVisible();
      await expect(guide(page)).toHaveCount(0);
    });
  }

  test('a new install reaches it from Get started, after the run and setup', async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    const popup = await openPopup(context, extensionId);
    await popup
      .getByRole('dialog', { name: 'Welcome to Tab Keeper', exact: true })
      .getByRole('button', { name: 'Get started', exact: true })
      .click();
    const full = await waitForFullView(context);
    await pastCompactViewCard(full);
    await finishFullRun(full);
    await expect(guide(full)).toHaveCount(0);
    await full
      .getByRole('dialog', { name: 'Make Tab Keeper yours', exact: true })
      .getByText('Skip setup', { exact: true })
      .click();
    await expect(guide(full)).toBeVisible();
  });
});

// KAN-411. Chrome's puzzle piece sits ~107px in from the window's right edge,
// left of the profile icon and ⋮; the arrow points up at it.
test('the arrow points straight up at the puzzle piece, clear of the guide', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();
  expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
  const measured = await page.evaluate(() => {
    const arrow = document.querySelector('[data-pin-arrow] svg');
    const head = document.querySelector('[data-pin-arrow] [data-arrow-head]');
    const dialog = document.querySelector('dialog[open]');
    if (arrow === null || head === null || dialog === null) {
      throw new Error('no arrow or guide');
    }
    const box = arrow.getBoundingClientRect();
    const tip = head.getBoundingClientRect();
    const guideBox = dialog.getBoundingClientRect();
    return {
      // The head rises symmetrically to the tip, so its box centre is the tip's x.
      tipFromRight: window.innerWidth - (tip.left + tip.width / 2),
      tipTop: tip.top,
      box: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      },
      guide: {
        left: guideBox.left,
        right: guideBox.right,
        top: guideBox.top,
        bottom: guideBox.bottom,
      },
    };
  });
  console.log(`[pin arrow] ${JSON.stringify(measured)}`);
  // ±4px: the tip is a stroke 2.6 viewBox units wide, and Chrome's own layout varies.
  expect(Math.abs(measured.tipFromRight - 107)).toBeLessThanOrEqual(4);
  // Straight up: the tip is the arrow's top, not a corner.
  expect(measured.tipTop - measured.box.top).toBeLessThan(12);
  const { box, guide: g } = measured;
  const overlaps =
    box.left < g.right &&
    box.right > g.left &&
    box.top < g.bottom &&
    box.bottom > g.top;
  expect(overlaps).toBe(false);
});

// KAN-411. Chrome's real order: field, puzzle, divider, profile, ⋮; a pinned
// extension sits left of the puzzle.
test('steps 1 and 3 draw the toolbar in Chrome’s order', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();
  const order = (step: number) =>
    page.evaluate((index) => {
      const li = document.querySelectorAll('dialog[open] ol > li')[index];
      const parts = [
        ...li.querySelectorAll(
          '[data-toolbar-part], .material-symbols-outlined'
        ),
      ].filter(
        (el) =>
          el.hasAttribute('data-toolbar-part') || el.textContent === 'more_vert'
      );
      return parts
        .map((el) => ({
          name: el.getAttribute('data-toolbar-part') ?? 'menu',
          left: el.getBoundingClientRect().left,
          width: el.getBoundingClientRect().width,
        }))
        .filter((part) => part.width > 0)
        .sort((a, b) => a.left - b.left)
        .map((part) => part.name);
    }, step);
  expect(await order(0)).toEqual([
    'field',
    'puzzle',
    'divider',
    'profile',
    'menu',
  ]);
  expect(await order(2)).toEqual([
    'field',
    'tab-keeper',
    'puzzle',
    'divider',
    'profile',
    'menu',
  ]);
});

// Each step's small arrow points up at the item its badge rings.
test('each step’s pointer sits under its ringed item', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();
  const offsets = await page.evaluate(() =>
    [...document.querySelectorAll('dialog[open] ol > li')].map((li) => {
      const ring = li.querySelector('[data-ringed]');
      const arrow = li.querySelector('[data-pin-step-pointer] svg');
      if (ring === null || arrow === null)
        throw new Error('no ring or pointer');
      const centre = (el: Element) => {
        const box = el.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      return centre(arrow) - centre(ring);
    })
  );
  console.log(`[step pointers] ${JSON.stringify(offsets)}`);
  for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(2);
});

test('step 2 draws no ⋮; steps 1 and 3 keep theirs', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();
  const steps = guide(page).locator('ol > li');
  const kebabs = (n: number) =>
    steps
      .nth(n)
      .locator('.material-symbols-outlined')
      .filter({ hasText: /^more_vert$/ });
  await expect(kebabs(0)).toHaveCount(1);
  await expect(kebabs(1)).toHaveCount(0);
  await expect(kebabs(2)).toHaveCount(1);
});

test('step 2 name shows Tab Keeper whole before the cut', async ({
  context,
  extensionId,
}) => {
  await stubToolbarPin(context, { pinned: false });
  await seedSettings(context, { isPinGuideDismissed: false });
  const page = await openFullView(context, extensionId);
  await expect(guide(page)).toBeVisible();
  // Fractional edges: an integer clientWidth rounds away a sub-pixel overrun.
  const fit = await page.evaluate(() => {
    const el = document.querySelector('[data-pin-app-name]');
    const text = el?.firstChild;
    if (!(el instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('no app name text');
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 'Tab Keeper'.length);
    const probe = document.createElement('span');
    probe.textContent = '…';
    el.appendChild(probe);
    const ellipsis = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      wordEnd: range.getBoundingClientRect().right,
      ellipsis,
      boxEnd: el.getBoundingClientRect().right,
    };
  });
  console.log(`[name fit] ${JSON.stringify(fit)}`);
  expect(fit.wordEnd + fit.ellipsis).toBeLessThanOrEqual(fit.boxEnd);
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: the guide reads at 4.5:1, waiting and pinned`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await seedSettings(context, { theme, isPinGuideDismissed: false });
    const page = await openFullView(context, extensionId);
    expect(await pageGround(page)).toBe(palette.PRIMARY_COLOR);
    await expectReadable(guide(page), `${theme} pin guide, waiting`);
    await expectReadable(
      guide(page).locator('[data-pin-why]'),
      `${theme} pin guide, why line`
    );
    await setPin(page, true);
    await expect(
      guide(page).getByRole('status').locator('[data-pin-status-words]')
    ).toHaveText('Pinned. Closing…');
    await expectReadable(guide(page), `${theme} pin guide, pinned`);
  });
}

// KAN-735. The backdrop is dark in every theme: the arrow is white on the four
// light ones and the card's ink on the three dark ones.
const DARK_THEMES = ['Charcoal', 'Darkenheimer', 'Blue'];
for (const [theme, palette] of THEMES) {
  const expected = DARK_THEMES.includes(theme) ? palette.TEXT_COLOR : '#FFFFFF';
  test(`${theme}: the arrow is white on a light theme and the card's ink on a dark one, at 3:1 or more`, async ({
    context,
    extensionId,
  }) => {
    await stubToolbarPin(context, { pinned: false });
    await seedSettings(context, { theme, isPinGuideDismissed: false });
    const page = await openFullView(context, extensionId);
    await expect(guide(page)).toBeVisible();
    const boxes = await page.evaluate(() => {
      const r = (s: string) => {
        const b = document.querySelector(s)!.getBoundingClientRect();
        return { left: b.left, top: b.top, width: b.width, height: b.height };
      };
      return { arrow: r('[data-pin-arrow] svg'), guide: r('dialog[open]') };
    });
    const { arrow, guide: g } = boxes;
    const png = (await page.screenshot()).toString('base64');
    const painted = await page.evaluate(
      async ({ png, arrow, g }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const scale = img.width / innerWidth;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const hex = (x: number, y: number) =>
          '#' +
          [
            ...ctx
              .getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1)
              .data.slice(0, 3),
          ]
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase();
        const counts: Record<string, number> = {};
        const data = ctx.getImageData(
          Math.floor(arrow.left * scale),
          Math.floor(arrow.top * scale),
          Math.ceil(arrow.width * scale),
          Math.ceil(arrow.height * scale)
        ).data;
        for (let i = 0; i < data.length; i += 4) {
          const c =
            '#' +
            [data[i], data[i + 1], data[i + 2]]
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase();
          counts[c] = (counts[c] ?? 0) + 1;
        }
        return {
          scale,
          counts,
          ground: hex(arrow.left - 6, arrow.top + arrow.height / 2),
          guideFill: hex(g.left + 6, g.top + g.height - 6),
        };
      },
      { png, arrow, g }
    );
    // CONTROL: the decode reads the guide's own fill as its token.
    expect(painted.guideFill).toBe(palette.PRIMARY_COLOR);
    const strokePx = (painted.counts[expected] ?? 0) / painted.scale ** 2;
    const ratio = contrast(painted.ground, expected);
    console.log(
      `[pin arrow colour] ${theme} ${expected} ${strokePx}px on ${painted.ground} ${ratio.toFixed(2)}:1`
    );
    expect(strokePx).toBeGreaterThanOrEqual(200);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
}
