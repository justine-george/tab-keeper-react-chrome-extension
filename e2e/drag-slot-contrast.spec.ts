import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-234. The dashed outline that marks where a dragged row will land is
// legible in every theme.
//
// It was drawn `currentColor` at 30%, and the code said currentColor kept it
// legible everywhere. Measured, currentColor resolved to #000000 in all five
// themes: no ancestor of a row sets `color` from the theme -- the theme's
// text colour is painted leaf by leaf, never on a container -- so the slot was
// a black dashed line at 30%, which on the dark themes is 1.17:1 against the
// page. On Light it read 2.09:1, which is how it passed a human eye for as
// long as it did.
//
// WCAG 1.4.11 asks 3:1 for a graphical indicator. The slot now takes its
// colour from a root variable the theme publishes, at a ceiling chosen by the
// KAN-95 rule -- the quietest token that clears 3:1 on every backdrop -- and
// the fade-by-distance rule (KAN-166) is unchanged: a slot near the held row
// still fades so it does not read as an outline around it.
//
// Every theme, because a defect of this kind changes sign between them (a
// dark line vanishes on dark and shouts on light), and the tightest backdrop
// is not the one you would guess.

const THEMES = ['Light', 'WarmLight', 'BBPink', 'Darkenheimer', 'Blue'];

const tab = (id: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
});

const WINDOW = {
  windowId: 'w0',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 6,
  title: 'w0',
  tabs: ['t0', 't1', 't2', 't3', 't4', 't5'].map(tab),
};

async function open(
  context: BrowserContext,
  extensionId: string,
  theme: string
): Promise<Page> {
  await seedSessions(context, {
    ...buildContainer([
      buildSession({
        tabGroupId: 's1',
        title: 'Slot contrast',
        isSelected: true,
        windowCount: 1,
        tabCount: WINDOW.tabs.length,
        windows: [WINDOW],
      }),
    ]),
    selectedTabGroupId: 's1',
  });
  // The enum's exact casing; 'DARKENHEIMER' seeds nothing, silently.
  await seedSettings(context, { theme });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('[data-drag-row-id="t1"]')).toBeVisible();
  return page;
}

/** Picks t1 up and holds it over `toId`'s centre, without releasing. */
async function hold(page: Page, toId: string) {
  const from = (await page.locator('[data-drag-row-id="t1"]').boundingBox())!;
  const to = (await page
    .locator(`[data-drag-row-id="${toId}"]`)
    .boundingBox())!;
  const x = from.x + 60;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 + 8);
  await page.mouse.move(x, to.y + to.height / 2, { steps: 10 });
  // The slot's opacity follows the pointer; the rows animate aside. Let both
  // settle before reading.
  await page.waitForTimeout(350);
}

/**
 * The slot as it is actually drawn: its border colour composited at its
 * opacity over whatever is painted behind it, against that backdrop.
 *
 * The backdrop is found by walking up from the element under the slot's own
 * centre to the first painted background -- the slot is transformed away from
 * the held row, so its parent's ancestry is the wrong place to look.
 */
const slotContrast = (page: Page) =>
  page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>(
      '[data-drag-landing-slot]'
    )!;
    const cs = getComputedStyle(slot);
    const rgb = (s: string) =>
      (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const border = rgb(cs.borderTopColor);
    const opacity = parseFloat(cs.opacity);

    const r = slot.getBoundingClientRect();
    let el = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    let bgText = 'rgba(0, 0, 0, 0)';
    while (el && (bgText === 'rgba(0, 0, 0, 0)' || bgText === 'transparent')) {
      bgText = getComputedStyle(el).backgroundColor;
      el = el.parentElement;
    }
    const bg = rgb(bgText);

    const lum = (c: number[]) => {
      const [x, y, z] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * x + 0.7152 * y + 0.0722 * z;
    };
    const drawn = border.map((v, i) => v * opacity + bg[i] * (1 - opacity));
    const L1 = lum(drawn);
    const L2 = lum(bg);
    return {
      border: cs.borderTopColor,
      opacity,
      backdrop: bgText,
      contrast: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05),
    };
  });

for (const theme of THEMES) {
  test(`the landing slot clears 3:1 against the page (${theme})`, async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, theme);
    // Three rows away: well past one footprint, so the fade is at its ceiling
    // and this measures the slot at full strength.
    await hold(page, 't4');

    const s = await slotContrast(page);
    // The specific defect: a colour that never came from the theme.
    expect(s.border).not.toBe('rgb(0, 0, 0)');
    expect(s.contrast).toBeGreaterThanOrEqual(3);

    await page.mouse.up();
  });
}

// CONTROL: the fade-by-distance rule (KAN-166) is still live. Held barely off
// its own place, the slot must be dimmer than at full strength -- a slot
// pinned at its ceiling would pass every contrast test above while reading
// as an outline around the dragged row, which is the thing that rule exists
// to prevent.
test('the slot still fades when the held row is close to it', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId, 'Darkenheimer');
  await hold(page, 't4');
  const far = await slotContrast(page);

  const t2 = (await page.locator('[data-drag-row-id="t2"]').boundingBox())!;
  // Back up to less than half a row past t2's centre: close to the slot.
  const from = (await page.locator('[data-drag-row-id="t1"]').boundingBox())!;
  await page.mouse.move(from.x + 60, t2.y + t2.height * 0.6, { steps: 6 });
  await page.waitForTimeout(350);
  const near = await slotContrast(page);

  expect(near.opacity).toBeLessThan(far.opacity);
  expect(near.opacity).toBeGreaterThan(0);
  await page.mouse.up();
});
