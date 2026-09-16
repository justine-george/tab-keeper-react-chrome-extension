import { test, expect } from './fixtures/extension';
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

    // And the change itself: a real border, and a fill that is no longer the
    // row-hover token.
    expect(g.border).toBe('1px solid');

    // Evenly padded. A border makes the box's edges visible, so the asymmetry
    // that was there all along would have become visible with it.
    expect(
      Math.abs(g.gapLeft - g.gapRight),
      `${g.gapLeft}px before the glyph, ${g.gapRight}px after the label`
    ).toBeLessThanOrEqual(1);
    expect(g.fill).not.toBe('rgb(228, 231, 235)'); // HOVER_COLOR, the old fill
  });
}

// The button must not read as a raised plate.
//
// Giving it a border made a second thing visible that the borderless version
// had hidden: `quiet`'s rest fill is PRIMARY_COLOR, "the page's own ground",
// but this button sits on a CARD painting SECONDARY_COLOR. Measured on the real
// build, the fill came out 1.104:1 lighter than the surface behind it, ringed
// by a 6.83:1 border -- a lighter panel inside a hard dark outline on a darker
// ground is how a raised bevel is drawn. The dark themes inverted it (fill
// 1.136:1 darker than its card) and it read as inset instead.
//
// This reads PIXELS, not computed styles, and the first draft of it shows why.
// That draft compared `getComputedStyle(btn).backgroundColor` against the
// card's, which is wrong twice: a transparent fill reports `rgba(0, 0, 0, 0)`,
// which scores as BLACK and failed at 17.7:1 on correct code -- and had it been
// resolved by walking up to the first painted ancestor instead, it would have
// returned the card itself by construction and could never have failed at all.
// A declaration is not a pixel. So the page is photographed and sampled.
//
// Both themes run because the defect changed SIGN between them -- a Light-only
// check would pass on a change that made the dark one worse.
for (const theme of ['Light', 'Darkenheimer'] as const) {
  test(`the add-window button lies flat on its card (${theme})`, async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, {
      theme,
      isNeverAskAgainForTabGroups: true,
      isNeverAskAgainToRate: true,
    });
    await seedSessions(context, {
      ...buildContainer([
        buildSession({
          tabGroupId: 's0',
          title: 'A session',
          isSelected: true,
        }),
      ]),
      selectedTabGroupId: 's0',
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const add = page.getByRole('button', { name: ADD.en });
    await expect(add).toBeVisible();

    // The card is the nearest ancestor that actually paints. Found by walking
    // rather than by selector, so it is the surface the button is really seen
    // against and not one we assumed.
    const card = page.locator('#add-window-card');
    await page.evaluate((label) => {
      const btn = document.querySelector(`[aria-label="${label}"]`)!;
      const paints = (el: Element) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      };
      let el = btn.parentElement!;
      while (el && !paints(el)) el = el.parentElement!;
      el.id = 'add-window-card';
    }, ADD.en);

    const shot = (await card.screenshot()).toString('base64');

    // Sample three points on one horizontal line through the button: the card
    // just outside it, the border itself, and the button's own interior (taken
    // from the right-hand padding, which holds no glyph and no label).
    const px = await page.evaluate(
      async ({ shot, label }) => {
        const btn = document
          .querySelector(`[aria-label="${label}"]`)!
          .getBoundingClientRect();
        const box = document
          .querySelector('#add-window-card')!
          .getBoundingClientRect();
        const img = new Image();
        img.src = `data:image/png;base64,${shot}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        const ctx = c.getContext('2d')!;
        // Screenshot pixels are the card's own top-left origin.
        const at = (x: number, y: number) => {
          const d = ctx.getImageData(
            Math.round(x - box.left),
            Math.round(y - box.top),
            1,
            1
          ).data;
          return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
        };
        const y = btn.top + btn.height / 2;
        return {
          outside: at(btn.left - 3, y),
          border: at(btn.left + 0.5, y),
          inside: at(btn.right - 3, y),
        };
      },
      { shot, label: ADD.en }
    );

    // The claim: the button's interior is the SAME pixel as the card beside it.
    // Exact, not tolerant -- a bevel IS a small step, so a tolerance is the one
    // thing that would let it back in.
    expect(
      px.inside,
      `the button's interior paints ${px.inside} against a ${px.outside} card -- that step is the bevel`
    ).toBe(px.outside);

    // CONTROL. A button that had vanished entirely would also satisfy the line
    // above. It is still a button because its BORDER is a different pixel from
    // the card -- and the sampler can only make the claim above if it can tell
    // two colours apart on this same line in the first place.
    expect(
      px.border,
      `the border samples as ${px.border}, the same pixel as the card`
    ).not.toBe(px.outside);
  });
}
