import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-221 (and KAN-220). The export toolbar's actions, reviewed against Emil
// Kowalski's animation guidance and picked by Justine:
//
// - every action dips to 97% while held, over 160ms;
// - the filled primaries (PDF / Print, Done) hold their hover fill while
//   pressed -- a deeper fill drops the label below 4.5:1 on the dark page --
//   so the dip is their press cue (KAN-220: press and hover used to be
//   identical and nothing else moved);
// - hover fills only for a fine pointer;
// - Copy all links says "Copied" in the button, not in a toast;
// - Edit and Done fade their row in, but not on arrival;
// - reduced motion keeps none of the movement.
//
// Scoped to the export page: the popup's Buttons must not change.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  isSelected: true,
});

async function openExport(
  context: BrowserContext,
  extensionId: string,
  theme = 'Light'
) {
  await seedSettings(context, {
    theme,
    isNeverAskAgainToRate: true,
    isNeverAskAgainForTabGroups: true,
  });
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-kyoto',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-kyoto`
  );
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  await waitForFontsLoaded(page);
  return page;
}

const styleOf = (button: Locator) =>
  button.evaluate((el) => {
    const s = getComputedStyle(el);
    // The matrix's first term is the x scale; `none` is 1.
    const scale = s.transform === 'none' ? 1 : new DOMMatrix(s.transform).a;
    return { scale, fill: s.backgroundColor };
  });

/** Polls until two reads 60ms apart agree, so a transition has finished. */
async function settledStyle(page: Page, button: Locator) {
  let last = '';
  for (let i = 0; i < 30; i++) {
    const now = JSON.stringify(await styleOf(button));
    if (now === last)
      return JSON.parse(now) as Awaited<ReturnType<typeof styleOf>>;
    last = now;
    await page.waitForTimeout(60);
  }
  throw new Error('the button never settled');
}

/**
 * Holds the mouse on a button and reads it, then releases OFF the button so
 * the press never becomes a click.
 */
async function held(page: Page, button: Locator) {
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const hover = await settledStyle(page, button);
  await page.mouse.down();
  // A barrier on the press itself: "two equal reads" alone passed on a press
  // that had not registered yet (scale 1, then 1), once in 11 runs.
  await expect
    .poll(() => button.evaluate((el) => el.matches(':active')))
    .toBe(true);
  await page.waitForTimeout(200);
  const press = await settledStyle(page, button);
  await page.mouse.move(2, 690);
  await page.mouse.up();
  return { hover, press };
}

for (const theme of ['Light', 'Darkenheimer']) {
  test(`${theme}: every export action dips while held`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId, theme);

    for (const name of [
      'Edit',
      'Copy all links',
      'Save as HTML',
      'PDF / Print',
    ]) {
      const { press } = await held(page, page.getByRole('button', { name }));
      expect(press.scale, `${name} held`).toBeCloseTo(0.97, 3);
    }

    await page.getByRole('button', { name: 'Edit' }).click();
    const { press } = await held(
      page,
      page.getByRole('button', { name: 'Done' })
    );
    expect(press.scale, 'Done held').toBeCloseTo(0.97, 3);
  });

  // KAN-220. The primary's fill does not deepen on press -- that is decided,
  // not missed -- so the test pins both halves: same fill, and a dip.
  test(`${theme}: PDF / Print holds its hover fill and dips when pressed`, async ({
    context,
    extensionId,
  }) => {
    const page = await openExport(context, extensionId, theme);
    const print = page.getByRole('button', { name: 'PDF / Print' });
    const rest = await settledStyle(page, print);

    const { hover, press } = await held(page, print);

    // CONTROL: hover really is a different fill, so "press equals hover" is
    // not the trivial result of nothing changing at all.
    expect(hover.fill).not.toBe(rest.fill);
    expect(press.fill).toBe(hover.fill);
    expect(press.scale).toBeCloseTo(0.97, 3);
  });
}

test('the popup keeps its buttons as they were', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, {
    ...buildContainer([SESSION]),
    selectedTabGroupId: 'session-kyoto',
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  const add = popup.getByRole('button', { name: 'Add current window' });
  await expect(add).toBeVisible();

  const { press } = await held(popup, add);

  expect(press.scale, 'a popup Button does not dip').toBe(1);
});

test('with reduced motion nothing dips', async ({ context, extensionId }) => {
  const page = await openExport(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const { press } = await held(
    page,
    page.getByRole('button', { name: 'Edit' })
  );

  expect(press.scale).toBe(1);
});

test('on a touch screen, hovering fills nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  const edit = page.getByRole('button', { name: 'Edit' });
  const rest = await settledStyle(page, edit);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  // CONTROL: the emulation really changed what the page's media queries see.
  expect(
    await page.evaluate(
      () => matchMedia('(hover: hover) and (pointer: fine)').matches
    )
  ).toBe(false);

  const box = (await edit.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  expect((await settledStyle(page, edit)).fill).toBe(rest.fill);
});

test('Copied sits beside its tick, and the button keeps its width', async ({
  context,
  extensionId,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await openExport(context, extensionId);
  const copy = page.getByRole('button', { name: 'Copy all links' });
  const widthBefore = (await copy.boundingBox())!.width;

  await copy.click();
  await page.mouse.move(2, 690);
  await expect(copy).toHaveAttribute('data-second-face-shown', 'true');
  await page.waitForTimeout(300);

  const shape = await copy.evaluate((el) => {
    const group = el.querySelector('[data-second-face]') as HTMLElement;
    const glyph = group.querySelector('.material-symbols-outlined')!;
    const word = [...group.querySelectorAll('span')].find(
      (s) => s.textContent === 'Copied'
    )!;
    const range = document.createRange();
    range.selectNodeContents(word);
    const button = el.getBoundingClientRect();
    const face = group.getBoundingClientRect();
    return {
      // Centred as a unit: equal room either side of the icon-and-word group.
      offCentre: Math.abs(
        face.left - button.left - (button.right - face.right)
      ),
      gap:
        range.getBoundingClientRect().left -
        glyph.getBoundingClientRect().right,
      opacity: Number(getComputedStyle(group).opacity),
    };
  });
  expect(shape.opacity).toBe(1);
  expect(shape.offCentre, 'the Copied group is centred').toBeLessThanOrEqual(1);
  expect(shape.gap, 'tick to word').toBeGreaterThanOrEqual(4);
  expect(shape.gap, 'tick to word').toBeLessThanOrEqual(10);
  expect((await copy.boundingBox())!.width).toBeCloseTo(widthBefore, 1);

  await expect(copy).toHaveAttribute('data-second-face-shown', 'false', {
    timeout: 3000,
  });
});

test('Edit and Done fade their row in, but the page does not on arrival', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  const row = page.locator('[data-toolbar-row]');
  const fading = () =>
    row.evaluate((el) =>
      el.getAnimations().map((a) => (a as CSSAnimation).animationName)
    );

  expect(await fading(), 'on arrival').toEqual([]);

  await page.getByRole('button', { name: 'Edit' }).click();
  expect((await fading()).length, 'after Edit').toBe(1);

  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await fading()).length, 'after Done').toBe(1);
});

test('with reduced motion the row swaps without fading', async ({
  context,
  extensionId,
}) => {
  const page = await openExport(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.getByRole('button', { name: 'Edit' }).click();

  expect(
    await page
      .locator('[data-toolbar-row]')
      .evaluate((el) => el.getAnimations().length)
  ).toBe(0);
});
