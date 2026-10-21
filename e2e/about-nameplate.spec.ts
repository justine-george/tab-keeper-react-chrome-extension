import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';
import { localeStrings } from './fixtures/locales';
import { expectReadable } from './fixtures/textContrast';
import {
  BB_PINK_THEME,
  BLUE_THEME,
  DARKENHEIMER_THEME,
  LIGHT_THEME,
  WARM_LIGHT_THEME,
} from '../src/hooks/useThemeColors';

// KAN-241. Settings -> About is laid out like the other four panes -- a
// left-aligned section under the shared inset -- with a nameplate on top: the
// app's mark drawn in the page's ink beside "Tab Keeper", and the version
// under it.
//
// Measured before the change (main a0406d8, 790x550): the pane held ~210px of
// content and ~250px of gap, centred where every other pane is left-aligned,
// and the version sat at the floor in LABEL_L3 -- 2.56:1 on Paper, 2.69:1 on
// Graphite -- so the one line a bug report needs was the hardest to read.
//
// The component test pins tokens and strings. This pins what only a layout
// engine can say: that About's inset IS the Display pane's inset, that the mark
// sits on the name line, and (KAN-728) that the note, its one row of actions
// and the policy fit, or scroll without clipping, in every theme and locale.

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

type Theme = 'Light' | 'WarmLight' | 'BBPink' | 'Darkenheimer' | 'Blue';
type View = 'popup' | 'full';
const VIEWPORT = {
  popup: { width: 790, height: 550 },
  full: { width: 1280, height: 800 },
};

async function openSettings(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string,
  theme: Theme,
  {
    language = 'en',
    view = 'popup',
    rootFontSize,
  }: { language?: string; view?: View; rootFontSize?: string } = {}
): Promise<Page> {
  const strings = localeStrings(language);
  await seedSessions(context);
  await seedSettings(context, { theme, language });
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT[view]);
  await page.goto(
    `chrome-extension://${extensionId}/index.html${view === 'full' ? '?view=tab' : ''}`
  );
  // CONTROL: the seeded language took, so a German run is not passing in English.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe(language);
  if (rootFontSize) {
    // Chrome's font size setting moves the root, and every rem with it.
    await page.addStyleTag({ content: `html{font-size:${rootFontSize}}` });
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).fontSize
      )
    ).toBe(rootFontSize);
  }
  await page
    .getByRole('button', { name: strings['Settings'], exact: true })
    .click();
  await expect(page.locator('[data-settings-section]').first()).toBeVisible();
  return page;
}

async function openAbout(page: Page, language = 'en'): Promise<void> {
  await page
    .getByRole('button', {
      name: localeStrings(language)['About'] ?? 'About',
      exact: true,
    })
    .click();
  await expect(note(page)).toBeVisible();
}

// The policy URL as a literal, not common.ts's PRIVACY_POLICY_LINK: importing
// common.ts pulls manifest.json into Node ESM, which refuses it without an
// import attribute. And this is the one URL that is pasted into the Web Store
// dashboard, so the spec pinning it to the letter is the point.
const PRIVACY_POLICY_LINK =
  'https://github.com/justine-george/tab-keeper-react-chrome-extension/blob/main/PRIVACY.md';

/** The nameplate's mark (KAN-521): the header's, shutter and all. */
const mark = (page: Page) =>
  page.locator('svg:has([data-mark-part="shutter"])');
const versionLine = (page: Page) => page.getByText(/^Version \d+\.\d+\.\d+$/);
/** KAN-728. The signed note: two paragraphs, then the name and the role. */
const note = (page: Page) => page.locator('[data-about-note]');
const noteLines = (page: Page) => note(page).locator('p, span');

const en = localeStrings('en');
const rateButton = (page: Page, language = 'en') =>
  page.getByRole('button', {
    name: localeStrings(language)['Rate Tab Keeper'],
    exact: true,
  });
const shareButton = (page: Page, language = 'en') =>
  page.getByRole('button', {
    name: localeStrings(language)['Share feedback'],
    exact: true,
  });
const policyLink = (page: Page, language = 'en') =>
  page.getByRole('link', {
    name: localeStrings(language)['Privacy policy'],
    exact: true,
  });

const box = async (l: Locator) => (await l.boundingBox())!;

/** The pane that scrolls: the first ancestor of the note with overflow-y auto or scroll. */
const paneRect = (page: Page) =>
  note(page).evaluate((el) => {
    let sc: HTMLElement | null = el.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY))
      sc = sc.parentElement;
    const r = sc!.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      scrolls: sc!.scrollHeight > sc!.clientHeight,
      scrollsSideways: sc!.scrollWidth > sc!.clientWidth,
    };
  });

const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

// KAN-728. Scrolling down is a pass, clipping is a fail: the row wraps
// rather than run past the section's edge, no label is cut inside its button,
// the two buttons stay apart, and every control is reachable inside the pane.
async function expectNothingCut(page: Page, language: string) {
  const rate = rateButton(page, language);
  const share = shareButton(page, language);
  // PREMISE: the row did wrap, so this run is the case the wrap exists for.
  expect((await box(share)).y).toBeGreaterThan((await box(rate)).y);
  expect((await paneRect(page)).scrollsSideways).toBe(false);
  const edge = await page
    .locator('[data-settings-section]')
    .evaluate(
      (el) =>
        el.getBoundingClientRect().right -
        parseFloat(getComputedStyle(el).paddingRight)
    );
  for (const b of [rate, share]) {
    const cut = await b.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(cut, await b.innerText()).toBe(false);
    const r = await box(b);
    expect(r.x + r.width).toBeLessThanOrEqual(edge);
  }
  expect(overlap(await box(rate), await box(share))).toBe(false);
  const noteCut = await note(page).evaluate(
    (el) => el.scrollWidth > el.clientWidth
  );
  expect(noteCut).toBe(false);
  for (const control of [rate, share, policyLink(page, language)]) {
    await control.scrollIntoViewIfNeeded();
    const r = await box(control);
    const pane = await paneRect(page);
    expect(r.y).toBeGreaterThanOrEqual(pane.top);
    expect(r.y + r.height).toBeLessThanOrEqual(pane.bottom);
  }
}

for (const [theme, palette] of [
  ['Light', LIGHT_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
] as const) {
  test.describe(`Settings -> About on ${theme}`, () => {
    test('shares the Display pane inset instead of centring', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      const themes = await box(page.getByText('Themes', { exact: true }));

      await openAbout(page);
      const glyph = await box(mark(page));
      const story = await box(noteLines(page).first());
      const rate = await box(rateButton(page));

      // The same left edge the Display pane's first label has.
      expect(glyph.x).toBe(themes.x);
      expect(story.x).toBe(themes.x);
      expect(rate.x).toBe(themes.x);
    });

    // KAN-521. Option C: the 40px mark beside the name, with the version under the name.
    test('puts the 40px mark beside the name and the version, centred on the pair', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const g = await box(mark(page));
      const name = await box(page.getByText('Tab Keeper', { exact: true }));
      const v = await box(versionLine(page));

      expect(g.width).toBe(40);
      expect(g.height).toBe(40);
      expect(name.x).toBe(g.x + 40 + 12);
      expect(v.x).toBe(name.x);
      const pairMid = (name.y + v.y + v.height) / 2;
      expect(Math.abs(g.y + g.height / 2 - pairMid)).toBeLessThanOrEqual(1);
    });

    test('sets the version in LABEL_L1 right under the name', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const version = versionLine(page);
      const name = await box(page.getByText('Tab Keeper', { exact: true }));
      const v = await box(version);

      expect(await version.evaluate((el) => getComputedStyle(el).color)).toBe(
        rgb(palette.LABEL_L1_COLOR)
      );
      expect(Math.abs(v.y - (name.y + name.height + 2))).toBeLessThanOrEqual(1);
    });

    // KAN-728. The note 24px under the nameplate; its blocks 12px apart; the signature's two lines 2px apart.
    test('spaces the note under the nameplate and its blocks evenly', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const g = await box(mark(page));
      const [story, promise, name, role] = await Promise.all(
        [0, 1, 2, 3].map((i) => box(noteLines(page).nth(i)))
      );
      expect(story.y).toBe(g.y + g.height + 24);
      expect(promise.y).toBe(story.y + story.height + 12);
      expect(name.y).toBe(promise.y + promise.height + 12);
      expect(role.y).toBe(name.y + name.height + 2);
    });

    // KAN-728. One row 24px under the signature, each button sized to its label, 12px apart.
    test('lays Rate and Share in one row under the signature', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const role = await box(noteLines(page).nth(3));
      const rate = await box(rateButton(page));
      const share = await box(shareButton(page));

      expect(rate.y).toBe(role.y + role.height + 24);
      expect(share.y).toBe(rate.y);
      expect(share.x).toBe(rate.x + rate.width + 12);
      expect(rate.width).toBeLessThan(250);
      expect(share.width).toBeLessThan(250);
      // KAN-511. Share on X is gone.
      await expect(
        page.getByRole('button', { name: 'Share on X' })
      ).toHaveCount(0);
    });

    // KAN-260, KAN-728. A quiet line 24px under the actions, in LABEL_L2. It
    // opens the policy in a tab and leaves the popup where it is -- a popup
    // that follows a link navigates itself away.
    test('links the privacy policy under the actions, on the inset', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      const themes = await box(page.getByText('Themes', { exact: true }));
      await openAbout(page);

      const link = policyLink(page);
      const rate = await box(rateButton(page));
      const l = await box(link);

      expect(l.x).toBe(themes.x);
      expect(l.y).toBe(rate.y + rate.height + 24);
      expect(await link.evaluate((el) => getComputedStyle(el).color)).toBe(
        rgb(palette.LABEL_L2_COLOR)
      );
      expect(await link.getAttribute('href')).toBe(PRIVACY_POLICY_LINK);

      // No network: the tab's navigation is answered locally, so what is
      // pinned is the URL Chrome was told to open, not GitHub's availability.
      await context.route('https://github.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '' })
      );
      const opened = context.waitForEvent('page');
      await link.click();
      const tab = await opened;
      await expect.poll(() => tab.url()).toBe(PRIVACY_POLICY_LINK);
      // The popup is still the popup.
      expect(page.url()).toBe(`chrome-extension://${extensionId}/index.html`);
      await expect(note(page)).toBeVisible();
    });

    // KAN-511. Rate is the filled main action: the theme's text colour as the fill, its ground as the ink.
    test('Rate is the filled button with the star, in this theme’s colours', async ({
      context,
      extensionId,
    }) => {
      const page = await openSettings(context, extensionId, theme);
      await openAbout(page);

      const drawn = await rateButton(page).evaluate((el) => {
        const glyph = el.querySelector('.material-symbols-outlined');
        return {
          fill: getComputedStyle(el).backgroundColor,
          ink: getComputedStyle(el).color,
          glyph: glyph?.textContent,
          glyphInk: glyph ? getComputedStyle(glyph).color : null,
        };
      });
      expect(drawn).toEqual({
        fill: rgb(palette.TEXT_COLOR),
        ink: rgb(palette.PRIMARY_COLOR),
        glyph: 'star',
        glyphInk: rgb(palette.PRIMARY_COLOR),
      });
    });
  });
}

// KAN-728. The note speaks in one voice -- one size, weight and colour -- and
// it and the policy read at 4.5:1 or better on every theme.
for (const [theme, palette] of [
  ['Light', LIGHT_THEME],
  ['WarmLight', WARM_LIGHT_THEME],
  ['BBPink', BB_PINK_THEME],
  ['Darkenheimer', DARKENHEIMER_THEME],
  ['Blue', BLUE_THEME],
] as const) {
  test(`the note is one voice on ${theme}`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSettings(context, extensionId, theme);
    await openAbout(page);

    const styles = await noteLines(page).evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return {
          text: el.textContent,
          size: s.fontSize,
          weight: s.fontWeight,
          color: s.color,
        };
      })
    );
    expect(styles.map((s) => s.text)).toEqual([
      en.AboutStory,
      en.AboutPromise,
      'Justine George',
      en['Tab Keeper Creator'],
    ]);
    for (const s of styles) {
      expect(s, s.text!).toMatchObject({
        size: '12.8px',
        weight: '400',
        color: rgb(palette.TEXT_COLOR),
      });
    }
    await expectReadable(note(page), `note on ${theme}`);
    await expectReadable(policyLink(page), `policy on ${theme}`);
  });
}

test('in English the buttons share a row and the pane does not scroll', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'Light');
  await openAbout(page);

  expect((await box(shareButton(page))).y).toBe(
    (await box(rateButton(page))).y
  );
  expect((await paneRect(page)).scrolls).toBe(false);
});

// The widest locale at the default size (French, 455px of labels for 434px of
// row, measured 2026-10-21): the row wraps, and nothing is cut.
test('in French the row wraps and nothing is cut', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'Light', {
    language: 'fr',
  });
  await openAbout(page, 'fr');
  // CONTROL: the note is in French.
  await expect(note(page)).toContainText(localeStrings('fr').AboutStory);

  await expectNothingCut(page, 'fr');
});

// Chrome's font size Large sets the root to 20px, and every rem grows with it.
test('at a 20px root nothing is clipped', async ({ context, extensionId }) => {
  const page = await openSettings(context, extensionId, 'Light', {
    rootFontSize: '20px',
  });
  await openAbout(page);

  await expectNothingCut(page, 'en');
});

test('in the full view the note stays a readable width', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'Light', {
    view: 'full',
  });
  await openAbout(page);

  const root = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize)
  );
  const width = (await box(note(page))).width;
  // PREMISE: the pane is wider than the cap, so the cap is what holds the note.
  const pane = await paneRect(page);
  expect(pane.right - pane.left).toBeGreaterThan(36 * root);
  expect(width).toBeLessThanOrEqual(36 * root);
});

test('Tab reaches Rate, Share, then the policy, each with a ring', async ({
  context,
  extensionId,
}) => {
  const page = await openSettings(context, extensionId, 'Light');
  await openAbout(page);

  await rateButton(page).focus();
  const ring = (l: Locator) =>
    l.evaluate((el) => getComputedStyle(el).outlineStyle);
  await page.keyboard.press('Tab');
  await expect(shareButton(page)).toBeFocused();
  expect(await ring(shareButton(page))).not.toBe('none');
  await page.keyboard.press('Shift+Tab');
  await expect(rateButton(page)).toBeFocused();
  expect(await ring(rateButton(page))).not.toBe('none');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(policyLink(page)).toBeFocused();
  expect(await ring(policyLink(page))).not.toBe('none');
});

test('the thank-you heading is gone', async ({ context, extensionId }) => {
  const page = await openSettings(context, extensionId, 'Light');
  await openAbout(page);

  await expect(page.getByText(/Thank you for using/)).toHaveCount(0);
  // KAN-728. And so are the credit, its heart and the Feedback heading.
  await expect(page.getByRole('img', { name: 'love' })).toHaveCount(0);
  await expect(page.getByText(/Made with/)).toHaveCount(0);
  await expect(page.getByText('Feedback', { exact: true })).toHaveCount(0);
});

// KAN-521. A click on About's mark plays the header's beat, and the shutter click once it has shut.
test('a click on the About mark slides its shutter, then clicks once as it shuts', async ({
  context,
  extensionId,
}) => {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    const log: { what: string; at: number }[] = [];
    Object.defineProperty(window, '__beat', { value: log });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.getAttribute('data-mark-part') === 'shutter')
        log.push({ what: 'shutter', at: performance.now() });
      return animate.call(this, keyframes, options);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      log.push({ what: 'tick', at: performance.now() });
      start.call(this, when, offset, duration);
    };
  });
  const page = await openSettings(context, extensionId, 'Light');
  await openAbout(page);
  await mark(page).click();

  const read = () =>
    page.evaluate(
      () => Reflect.get(window, '__beat') as { what: string; at: number }[]
    );
  await expect.poll(async () => (await read()).length).toBe(3);
  const log = await read();
  const shutter = log.find((e) => e.what === 'shutter')!;
  const ticks = log.filter((e) => e.what === 'tick');
  // PREMISE: the shutter slid, and one click (two ticks) sounded.
  expect(shutter).toBeDefined();
  expect(ticks).toHaveLength(2);
  // The 60ms delay plus the 300ms slide: the click once it has shut, not as it starts.
  expect(ticks[0].at - shutter.at).toBeGreaterThanOrEqual(340);
});
