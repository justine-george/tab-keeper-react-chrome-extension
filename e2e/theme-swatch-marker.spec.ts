import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSettings } from './fixtures/seed';
import { contrast, pixelsAt } from './fixtures/pixels';
import { THEMES as PALETTES } from './fixtures/savedWindows';

// KAN-95. The active theme swatch was marked with `outline: 2px solid
// TEXT_COLOR; outline-offset: 2px`, which is wrong in two separable ways.
//
// Too loud: TEXT_COLOR against the page is 9.2-13.8:1, focus-ring weight for
// a passive state marker. Contrast was the right axis to measure and the wrong
// one to maximise -- the same mistake as KAN-87's accent bar, rejected on
// sight within the hour for the same reason.
//
// Cramped: 2px of outline plus 2px of offset is 4px of ring, and the swatches
// sit in a flex row with gap: 4px, so the ring consumed the whole gap and
// touched its neighbours. Each swatch also carries its own 1px border, so the
// active one drew two concentric lines with a space between them.
//
// The marker is now the swatch's OWN border, thickened. One line instead of
// two, nothing drawn outside the box, so the collision cannot recur by
// construction. box-sizing: border-box keeps the swatch the same size as it
// thickens -- avoiding the layout shift that made KAN-88 reach for an outline
// in the first place.
//
// Asserted at every swatch rather than only the active one: "the active
// swatch differs" is satisfied by a build where ALL of them are 2px, which is
// no marker at all.

async function openThemes(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await expect(page.getByText('Themes')).toBeVisible();
  return page;
}

const THEMES = ['Paper', 'Parchment', 'Petal', 'Graphite', 'Ink'];

const swatch = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true });

// The marker is on the TILE inside the button (KAN-237): the button holds the
// tile and the theme's name, and the frame -- and so the marker, and the box
// whose size must not change -- is the tile's.
async function markerOf(
  s: Locator
): Promise<{ border: string; outline: string; width: number }> {
  return s.locator('[data-theme-tile]').evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      border: cs.borderTopWidth,
      outline: cs.outlineStyle,
      width: el.getBoundingClientRect().width,
    };
  });
}

test.describe('the active theme swatch is marked by its own border', () => {
  test('only the active swatch is thickened, and no outline is drawn', async ({
    context,
    extensionId,
  }) => {
    const page = await openThemes(context, extensionId);

    // Pick a theme explicitly rather than trusting whatever the profile had.
    await swatch(page, 'Petal').click();
    await expect(swatch(page, 'Petal')).toHaveAttribute('aria-pressed', 'true');

    const active = await markerOf(swatch(page, 'Petal'));

    expect(
      active.border,
      'the active swatch should carry a thicker border'
    ).toBe('2px');
    expect(
      active.outline,
      'no outline at all -- an outline is drawn outside the box and is what ' +
        'collided with the neighbouring swatches'
    ).toBe('none');

    // CONTROL: every other swatch stays thin. Without this the assertion above
    // passes on a build where all five are 2px, which marks nothing.
    for (const name of THEMES.filter((n) => n !== 'Petal')) {
      const other = await markerOf(swatch(page, name));
      expect(
        other.border,
        `${name} is not active and should keep the thin border`
      ).toBe('1px');
      expect(other.outline, `${name} should have no outline`).toBe('none');
    }
  });

  test('thickening the border does not resize the swatch', async ({
    context,
    extensionId,
  }) => {
    const page = await openThemes(context, extensionId);

    // The width of one swatch while it is NOT active, then while it is. This
    // is the whole reason KAN-88 used an outline: a border that changes the
    // box shoves the other four sideways as selection moves. box-sizing:
    // border-box is what makes the border safe to use here, and this is the
    // assertion that holds it to that.
    await swatch(page, 'Paper').click();
    const inactive = (await markerOf(swatch(page, 'Ink'))).width;

    await swatch(page, 'Ink').click();
    await expect(swatch(page, 'Ink')).toHaveAttribute('aria-pressed', 'true');
    const activeWidth = (await markerOf(swatch(page, 'Ink'))).width;

    expect(
      activeWidth,
      'the swatch must not change size when it activates'
    ).toBe(inactive);
  });
});

// KAN-398. The current theme's cue is a 2px LABEL_L1 frame and a check on a knob square,
// each at least 3:1 on the page (WCAG 1.4.11); the frame under the pointer stays put.
const SHOWN: Record<string, string> = {
  Light: 'Paper',
  WarmLight: 'Parchment',
  BBPink: 'Petal',
  Darkenheimer: 'Graphite',
  Blue: 'Ink',
};

for (const [theme, colours] of PALETTES) {
  test(`${theme}: the current theme reads at 3:1, and only it carries the check`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { theme });
    const page = await openThemes(context, extensionId);
    const current = swatch(page, SHOWN[theme]);
    await expect(current).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0);

    const tile = await current.locator('[data-theme-tile]').boundingBox();
    const check = current.locator('[data-theme-check]');
    await expect(check).toBeVisible();
    const box = await check.boundingBox();
    if (!tile || !box) throw new Error('no tile or check box');
    const read = async () =>
      pixelsAt(page, [
        [tile.x + tile.width / 2, tile.y + 0.5],
        [box.x + 1, box.y + 1],
        [tile.x + tile.width / 2, tile.y - 6],
        // The ring, where the check overlaps the tile's header band.
        [box.x - 1, box.y + box.height - 4],
      ]);

    const [frame, knob, page_, ring] = await read();
    console.log(
      `[${theme}] frame ${frame} ${contrast(frame, page_).toFixed(2)}, knob ${knob} ${contrast(
        knob,
        page_
      ).toFixed(2)} on ${page_}`
    );
    // CONTROL: the ground read is the page itself.
    expect(page_).toBe(colours.PRIMARY_COLOR);
    expect(frame).toBe(colours.LABEL_L1_COLOR);
    expect(contrast(frame, page_)).toBeGreaterThanOrEqual(3);
    expect(knob).toBe(colours.TEXT_COLOR);
    expect(contrast(knob, page_)).toBeGreaterThanOrEqual(3);
    expect(ring).toBe(colours.PRIMARY_COLOR);

    for (const name of Object.values(SHOWN).filter((n) => n !== SHOWN[theme])) {
      await expect(
        swatch(page, name).locator('[data-theme-check]')
      ).toHaveCount(0);
    }

    // The pointer on the current tile leaves its frame as it was (the KAN-96 rule).
    await current.locator('[data-theme-tile]').hover();
    await page.waitForTimeout(400);
    expect((await read())[0]).toBe(frame);
  });
}

// KAN-96. Hovering the SELECTED settings category erased its background
// instead of leaving it alone.
//
// `background-color: unset` was presumably meant as "leave this property
// alone". It is not: background-color is not inherited, so `unset` resolves to
// `initial`, which is `transparent`. And the :hover rule outranks the bare
// declaration below it, so the selected fill was actively erased -- the row
// read as unselected for exactly as long as the pointer was on it.
//
// The way to leave a property alone is to not declare it. Asserted by
// comparing the row against ITSELF unhovered rather than against a literal
// colour, so the test says "hovering changes nothing here" and cannot rot into
// a palette change detector.
test.describe('hovering the selected settings category leaves it alone', () => {
  test('the selected category keeps its fill under the pointer', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.locator('[aria-label="Settings"]').click();
    await expect(page.getByText('Themes')).toBeVisible();

    const selected = page.getByRole('button', { name: 'Display' });
    const other = page.getByRole('button', { name: 'Sessions' });
    const fill = (l: Locator) =>
      l.evaluate((el) => getComputedStyle(el).backgroundColor);

    await selected.click();
    await page.mouse.move(0, 0);
    const atRest = await fill(selected);

    // CONTROL: hovering a DIFFERENT row does change that row, so the harness
    // can see hover at all. Without this, "nothing changed" could just mean
    // the pointer never arrived.
    const otherAtRest = await fill(other);
    await other.hover();
    await expect
      .poll(() => fill(other), {
        message: 'hover should change an unselected row',
      })
      .not.toBe(otherAtRest);

    await selected.hover();

    // Wait for the transition to SETTLE before asserting, then read once.
    //
    // The first version of this used expect.poll(...).toBe(atRest), which
    // passed against the broken build: poll succeeds the moment it matches,
    // and the very first read lands before the 0.2s background-color
    // transition has started, so it matched the old value and returned green
    // while the row was on its way to transparent. "Eventually equals" is the
    // wrong question here -- the question is what it settles on.
    await page.waitForTimeout(400);

    expect(
      await fill(selected),
      'the selected category must keep its fill while hovered, not be ' +
        'erased to transparent'
    ).toBe(atRest);
  });
});

// KAN-247. The tiles sit 14px apart, and the row is flex-wrap: wrap -- so the
// gap is bounded by the widest locale. In ja two katakana captions are wider
// than their 72px tiles, and at the real 790px popup 16px is the exact ceiling
// before Ink wraps to a second line. Asserted where it would break: ja, 790
// wide, all five swatches on one row.
test.describe('the theme tiles keep to one row in the widest locale', () => {
  test('in Japanese at 790px, five swatches share a top edge and sit 14px apart', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { language: 'ja' });
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.locator('[aria-label="設定"]').click();
    await page.locator('button[aria-label="表示"]').click();
    await expect(swatch(page, 'ペーパー')).toBeVisible();

    const tops = await Promise.all(
      ['ペーパー', 'パーチメント', '花びら', 'グラファイト', 'インク'].map(
        (name) =>
          swatch(page, name).evaluate((el) => el.getBoundingClientRect().top)
      )
    );
    expect(new Set(tops).size, `swatch tops: ${tops.join(', ')}`).toBe(1);

    const gap = await swatch(page, 'ペーパー').evaluate(
      (el) => getComputedStyle(el.parentElement!).gap
    );
    expect(gap).toBe('14px');
  });
});
