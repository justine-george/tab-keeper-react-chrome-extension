import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import { contrast } from './fixtures/pixels';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-213. Making the add-window button visible must not move anything else.
//
// That is a geometry claim, and jsdom reports every box as 0x0, so it can only
// be made here. Three things are pinned:
//
//   1. the button is still exactly 32px tall, so the header does not grow;
//   2. the icon strip at the other end of the row has not moved;
//   3. the row still fits on ONE line, in the locale where it is tightest.
//
// (3) runs in German and Russian as well as English because the labels differ
// by 70px between them -- and the row measured 74.5px of spare width in German
// before this change, which is the smallest margin any of this had.
//
// The heights are exact rather than bounded: border-box means the 1px border
// eats inward, so 32 must stay 32. If it ever reads 34, the border has started
// growing the control and the 1 + 56 + 58 = 115 alignment between the two panes
// goes with it -- which searchRowAlignment.spec.ts then also catches, from the
// other side.

// What the button's accessible name actually renders as, per locale. `en`
// re-maps its own key, so t('Add window') is "Add current window" and not
// "Add window" (i18n keys are not display strings).
const ADD: Record<string, string> = {
  en: 'Add current window',
  de: 'Aktuelles Fenster hinzufügen',
  ru: 'Добавить текущее окно',
};

// Measured on the real build. Pinned exactly for two reasons: `playlist_add` is
// a wider drawing than `add`, and the only thing stopping the button growing is
// the explicit `width` Icon puts on the span; and dropping the right border
// takes a pixel off a shrink-to-fit box.
//
// That second one is why these read 1px less than the 157.4 / 211 / 186.2 this
// test first pinned -- the guard caught the change in all three locales, which
// is what a guard is for.
const WIDTH: Record<string, number> = { en: 156.4, de: 210, ru: 185.2 };

for (const lang of ['en', 'de', 'ru'] as const) {
  test(`the add-window button is visible without moving the row (${lang})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, {
      language: lang,
      isNeverAskAgainForTabGroups: true,
      isNeverAskAgainToRate: true,
    });
    await seedSessions(context, {
      ...buildContainer([
        buildSession({
          tabGroupId: 's0',
          title: 'Pull requests · justine-george/tab-keeper-react',
          isSelected: true,
        }),
      ]),
      selectedTabGroupId: 's0',
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    const add = page.getByRole('button', { name: ADD[lang] });
    await expect(add).toBeVisible();

    // The icon font can land AFTER the popup mounts. Until it does, Material
    // Symbols has nothing to substitute, so the span still lays out its
    // ligature SOURCE: the twelve characters "playlist_add", 98px of them.
    //
    // Measuring before this barrier does not merely flake, it reports a
    // plausible number. The pre-font reading for `add` was 29px -- three
    // characters -- which is close enough to a real glyph's width to look like
    // a measurement rather than a mistake. See fixtures/fonts.ts for why this
    // is not `document.fonts.check` (KAN-215).
    await waitForFontsLoaded(page, ['Material Symbols Outlined']);

    const g = await page.evaluate((label) => {
      const cs = (el: Element) => getComputedStyle(el as HTMLElement);
      const btn = document.querySelector(
        `[aria-label="${label}"]`
      ) as HTMLElement;
      // The row is the nearest ancestor laid out space-between; the strip is
      // its first child. Located by layout rather than by nth-child, so a
      // future control added to either end does not silently retarget this.
      let row: HTMLElement = btn;
      while (row && cs(row).justifyContent !== 'space-between')
        row = row.parentElement!;
      const strip = row.firstElementChild as HTMLElement;
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return {
          w: +b.width.toFixed(1),
          h: +b.height.toFixed(1),
          left: +b.left.toFixed(1),
          top: +b.top.toFixed(1),
        };
      };
      return {
        btn: r(btn),
        strip: r(strip),
        row: r(row),
        fill: cs(btn).backgroundColor,
        border: cs(btn).borderTopWidth + ' ' + cs(btn).borderTopStyle,
        // One line == the button's top edge sits inside the row's first 32px.
        onOneLine:
          btn.getBoundingClientRect().top <
          row.getBoundingClientRect().top + 33,
        // KAN-212's metric, applied to this button for the first time: the gap
        // before the glyph against the gap after the label. Invisible while the
        // control had no border, which is why 4px 9px 3px 2px survived.
        gapLeft: Math.round(
          btn
            .querySelector('.material-symbols-outlined')!
            .getBoundingClientRect().left - btn.getBoundingClientRect().left
        ),
        // The glyph's own box, and its INK. Icon sets an explicit `width` on
        // the span, so the BOX is 20px whatever the ligature does -- including
        // when it does nothing. Only `scrollWidth` can see the difference,
        // which is the KAN-206 lesson: a probe reading the styled box passed
        // against a deliberately misspelt `unfold_lesss`.
        glyphText: btn.querySelector('.material-symbols-outlined')!.textContent,
        glyphBox: +btn
          .querySelector('.material-symbols-outlined')!
          .getBoundingClientRect()
          .width.toFixed(1),
        glyphInk: (
          btn.querySelector('.material-symbols-outlined') as HTMLElement
        ).scrollWidth,
        gapRight: Math.round(
          btn.getBoundingClientRect().right -
            [...btn.children]
              .filter((c) => c.tagName === 'SPAN')
              .pop()!
              .getBoundingClientRect().right
        ),
      };
    }, ADD[lang]);

    // 1. Exactly 32, not merely "about right" -- see the header note.
    expect(g.btn.h, 'the button must not grow the header').toBe(32);

    // 2. The strip is anchored at the other end and must be untouched. Its
    //    width is four 32px icons; its left edge is the row's own.
    expect(g.strip.w, 'the icon strip has not changed width').toBe(128);
    expect(g.strip.left, 'the icon strip has not moved').toBe(g.row.left);

    // 3. One row. The button grows leftward into slack that already existed,
    //    so it must never wrap under the strip.
    expect(g.onOneLine, 'the row must stay on one line').toBe(true);

    // KAN-214: a chip, so no border at all -- the fill does the work, and
    // add-window chip tests below measure it.
    expect(g.border).toBe('0px none');

    // Evenly padded. A border makes the box's edges visible, so the asymmetry
    // that was there all along would have become visible with it.
    expect(
      Math.abs(g.gapLeft - g.gapRight),
      `${g.gapLeft}px before the glyph, ${g.gapRight}px after the label`
    ).toBeLessThanOrEqual(1);
    expect(g.fill).not.toBe('rgb(228, 231, 235)'); // HOVER_COLOR, the old fill

    // The glyph names the KIND of action: `playlist_add` (append to the list on
    // screen) rather than a bare plus, which is the mark the two session-CREATING
    // controls in the left pane already wear.
    expect(g.glyphText).toBe('playlist_add');

    // And it must actually RESOLVE. Material Symbols draws by ligature, so a
    // misspelt name is not an error -- it renders the name as literal text.
    // The styled box cannot see that (Icon pins it to ICON.SMALL either way),
    // so this reads the ink: a resolved glyph overflows 20px slightly, while
    // the twelve characters of "playlist_add" run past 100px.
    expect(g.glyphBox, 'the glyph box is ICON.SMALL').toBe(20);
    expect(
      g.glyphInk,
      `the glyph rendered ${g.glyphInk}px of ink -- anything past its 20px box means the ligature did not resolve and the NAME is being drawn ("add" reads 29, "playlist_add" reads 98)`
    ).toBeLessThanOrEqual(20);

    // A guard, not a discriminator: these pass before and after the glyph swap,
    // and that is the point -- changing the mark must not move the control.
    // Widths differ per locale because the label does.
    expect(g.btn.w, 'the button width must not change').toBe(WIDTH[lang]);
  });
}

// KAN-214. A tinted chip, flush in the card's corner.
//
// No border; the fill does the work. So the claims move from the outline to
// the fill: that it PAINTS the chip token, that it separates from the card by
// at least the visible floor, and that no line is drawn at any edge.
//
// Pixels, not computed styles. KAN-213's first draft compared
// `getComputedStyle(btn).backgroundColor` against the card's: a transparent
// fill reports `rgba(0, 0, 0, 0)`, which scores as BLACK -- a declaration is not
// a pixel. So the page is photographed and sampled.
//
// All five themes. KAN-213's defect changed SIGN between light and dark, and
// the chip is darker than its card in three themes and lighter in two.
const CHIP: Record<string, { card: string; chip: string }> = {
  Light: { card: '#E9ECF0', chip: '#D5D8DC' },
  WarmLight: { card: '#EDE8D0', chip: '#D9D4BC' },
  BBPink: { card: '#F9BFD2', chip: '#E7ADC0' },
  Darkenheimer: { card: '#333333', chip: '#404040' },
  Blue: { card: '#333340', chip: '#3F3F4C' },
};

async function openInTheme(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string,
  theme: string
) {
  await seedSettings(context, {
    theme,
    isNeverAskAgainForTabGroups: true,
    isNeverAskAgainToRate: true,
  });
  await seedSessions(context, {
    ...buildContainer([
      buildSession({ tabGroupId: 's0', title: 'A session', isSelected: true }),
    ]),
    selectedTabGroupId: 's0',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('button', { name: ADD.en })).toBeVisible();
  await waitForFontsLoaded(page, ['Material Symbols Outlined']);
  // Park the pointer: a hovered chip paints ICON_HOVER_COLOR, not its rest.
  await page.mouse.move(0, 0);
  return page;
}

/** Samples `#RRGGBB` at viewport points from one fresh screenshot. */
async function sample(
  page: Awaited<ReturnType<typeof openInTheme>>,
  pick: string
): Promise<Record<string, string>> {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ shot, label, pick }) => {
      const btn = document.querySelector(`[aria-label="${label}"]`)!;
      const b = btn.getBoundingClientRect();
      let card = btn.parentElement!;
      while (card && getComputedStyle(card).borderTopWidth === '0px')
        card = card.parentElement!;
      const c = card.getBoundingClientRect();
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const at = (x: number, y: number) =>
        '#' +
        [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data]
          .slice(0, 3)
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      const midY = b.top + b.height / 2;
      const points: Record<string, [number, number]> = {
        // The card just left of the chip, and the chip's right-hand padding,
        // which holds no glyph and no label.
        card: [b.left - 3, midY],
        inside: [b.right - 3, midY],
        // The chip's own outermost pixels on each side. With no border these
        // are fill; KAN-213's outline drew its line exactly here. Half a pixel
        // in, because the box starts at a fractional x (623.6): flooring it
        // samples the card pixel OUTSIDE the chip, which is where the first
        // draft of this read the card colour against a correct chip.
        topEdge: [b.right - 3, b.top + 0.5],
        leftEdge: [b.left + 0.5, midY],
        // The card's border one pixel outside the chip's right and bottom:
        // flush means the chip's fill meets it directly.
        cardRight: [c.right - 0.5, midY],
        cardBottom: [b.right - 3, c.bottom - 0.5],
      };
      return Object.fromEntries(
        pick.split(',').map((k) => [k, at(...points[k])])
      );
    },
    { shot, label: ADD.en, pick }
  );
}

for (const [theme, t] of Object.entries(CHIP)) {
  test(`the add-window chip paints its fill against the card (${theme})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openInTheme(context, extensionId, theme);
    const px = await sample(page, 'card,inside');

    // CONTROL: the sampler reads the card as the card, or every comparison
    // below is against the wrong surface.
    expect(px.card, 'the card beside the chip').toBe(t.card);
    expect(px.inside, 'the chip interior paints CHIP_COLOR').toBe(t.chip);
    expect(contrast(px.inside, px.card)).toBeGreaterThanOrEqual(1.2);
  });

  test(`the add-window chip draws no outline, flush in the corner (${theme})`, async ({
    context,
    extensionId,
  }) => {
    const page = await openInTheme(context, extensionId, theme);

    const gaps = await page.evaluate((label) => {
      const btn = document.querySelector(`[aria-label="${label}"]`)!;
      const b = btn.getBoundingClientRect();
      let card = btn.parentElement!;
      while (card && getComputedStyle(card).borderTopWidth === '0px')
        card = card.parentElement!;
      const cs = getComputedStyle(card);
      const r = card.getBoundingClientRect();
      return {
        right: +(r.right - parseFloat(cs.borderRightWidth) - b.right).toFixed(
          2
        ),
        bottom: +(
          r.bottom -
          parseFloat(cs.borderBottomWidth) -
          b.bottom
        ).toFixed(2),
      };
    }, ADD.en);
    // The premise of "flush": the fill runs to the card's own border.
    expect(gaps).toEqual({ right: 0, bottom: 0 });

    const px = await sample(page, 'topEdge,leftEdge,cardRight,cardBottom');
    expect(px.topEdge, 'top edge is fill, not a line').toBe(t.chip);
    expect(px.leftEdge, 'left edge is fill, not a line').toBe(t.chip);
    // CONTROL: the card's border IS a line, so the sampler can see one when
    // one is there, one pixel from the same chip.
    expect(px.cardRight).not.toBe(t.chip);
    expect(px.cardBottom).not.toBe(t.chip);
  });
}
