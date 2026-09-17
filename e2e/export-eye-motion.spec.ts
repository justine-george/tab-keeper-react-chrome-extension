import type { BrowserContext, Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { waitForFontsLoaded } from './fixtures/fonts';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';

// KAN-222. The eye at the end of each Edit-mode row on the export page,
// measured before the change:
//
// - pressing looked exactly like hovering (the KAN-220 rule order);
// - a hidden row dimmed its eye with it, to 1.95:1 light and 2.40:1 dark,
//   below the 3:1 a control needs -- the control that brings the row back;
// - hiding snapped: 45% and the struck-through glyph in one frame.
//
// Picked by Justine from a mock: the eye stays whole on a hidden row, dips to
// 95% while held, fills one step past hover, crossfades its glyph with a 2px
// blur, and the row's content fades to 45% over 150ms.

const SESSION = buildSession({
  tabGroupId: 'session-kyoto',
  title: 'Weekend in Kyoto',
  isSelected: true,
  windowCount: 1,
  tabCount: 2,
  windows: [
    {
      windowId: 'w-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Trip planning',
      tabs: [
        {
          tabId: 't-1',
          favicon: '',
          title: 'Fushimi Inari',
          url: 'https://inari.jp/en/',
        },
        {
          tabId: 't-2',
          favicon: '',
          title: 'Kyoto bus map',
          url: 'https://bus.example/',
        },
      ],
    },
  ],
});

async function openEditor(
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
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto(
    `chrome-extension://${extensionId}/export.html?session=session-kyoto`
  );
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(eyeOf(page, 'Fushimi Inari')).toBeVisible();
  await waitForFontsLoaded(page);
  return page;
}

const eyeOf = (page: Page, name: string) =>
  page.getByRole('button', { name: `Hide: ${name}` });

const styleOf = (button: Locator) =>
  button.evaluate((el) => {
    const s = getComputedStyle(el);
    const scale = s.transform === 'none' ? 1 : new DOMMatrix(s.transform).a;
    return { scale, fill: s.backgroundColor };
  });

async function settledStyle(page: Page, button: Locator) {
  let last = '';
  for (let i = 0; i < 30; i++) {
    const now = JSON.stringify(await styleOf(button));
    if (now === last)
      return JSON.parse(now) as Awaited<ReturnType<typeof styleOf>>;
    last = now;
    await page.waitForTimeout(60);
  }
  throw new Error('the eye never settled');
}

/** Hover, then hold, reading each; releases off the button so it never clicks. */
async function held(page: Page, button: Locator) {
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const hover = await settledStyle(page, button);
  await page.mouse.down();
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
  // The eye's glyph against the file ground, at the opacity it is DRAWN at --
  // its own times every ancestor's -- read from what the browser computes.
  test(`${theme}: on a hidden row the eye still reads at 3:1`, async ({
    context,
    extensionId,
  }) => {
    const page = await openEditor(context, extensionId, theme);
    const eye = eyeOf(page, 'Fushimi Inari');
    await eye.click();
    await page.mouse.move(2, 690);
    await page.waitForTimeout(400);

    const read = await eye.evaluate((el) => {
      const rgb = (c: string) =>
        (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      let opacity = 1;
      let ground = '';
      for (let n: Element | null = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        opacity *= parseFloat(s.opacity);
        if (!ground && n !== el && s.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          ground = s.backgroundColor;
        }
      }
      const glyph = el.querySelector('.material-symbols-outlined')!;
      const ink = rgb(getComputedStyle(glyph).color);
      const bg = rgb(ground);
      const drawn = ink.map((v, i) => v * opacity + bg[i] * (1 - opacity));
      const [hi, lo] = [lum(drawn), lum(bg)].sort((a, b) => b - a);
      return {
        opacity,
        ratio: (hi + 0.05) / (lo + 0.05),
        pressed: el.getAttribute('aria-pressed'),
      };
    });

    expect(read.pressed, 'the row really is hidden').toBe('true');
    expect(read.opacity).toBe(1);
    expect(read.ratio).toBeGreaterThanOrEqual(3);
  });

  test(`${theme}: pressing the eye fills past hover and dips`, async ({
    context,
    extensionId,
  }) => {
    const page = await openEditor(context, extensionId, theme);

    const { hover, press } = await held(page, eyeOf(page, 'Fushimi Inari'));

    expect(press.fill, 'press is its own state').not.toBe(hover.fill);
    expect(press.scale).toBeCloseTo(0.95, 3);
  });
}

test('hiding fades the row and crossfades the glyph', async ({
  context,
  extensionId,
}) => {
  const page = await openEditor(context, extensionId);
  const eye = eyeOf(page, 'Fushimi Inari');
  const title = page.getByRole('textbox', {
    name: 'Rename tab: Fushimi Inari',
  });

  await eye.click();

  const titleFading = await title.evaluate((el) =>
    el.getAnimations().map((a) => (a as CSSTransition).transitionProperty)
  );
  const faceFading = await eye.evaluate((el) =>
    el
      .querySelector('[data-second-face]')!
      .getAnimations()
      .map((a) => (a as CSSTransition).transitionProperty)
  );
  expect(titleFading).toContain('opacity');
  expect(faceFading).toEqual(expect.arrayContaining(['opacity', 'filter']));
  // And it lands where it should.
  await expect
    .poll(() => title.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('0.45');
});

test('with reduced motion the eye neither dips nor blurs', async ({
  context,
  extensionId,
}) => {
  const page = await openEditor(context, extensionId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const eye = eyeOf(page, 'Fushimi Inari');

  const { press } = await held(page, eye);
  expect(press.scale).toBe(1);

  await eye.click();
  expect(
    await eye.evaluate(
      (el) => getComputedStyle(el.querySelector('[data-second-face]')!).filter
    )
  ).toBe('none');
});

test('on a touch screen, hovering the eye fills nothing', async ({
  context,
  extensionId,
}) => {
  const page = await openEditor(context, extensionId);
  const eye = eyeOf(page, 'Fushimi Inari');
  const rest = await settledStyle(page, eye);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  expect(
    await page.evaluate(
      () => matchMedia('(hover: hover) and (pointer: fine)').matches
    ),
    'CONTROL: the emulation reached the media queries'
  ).toBe(false);

  const box = (await eye.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  expect((await settledStyle(page, eye)).fill).toBe(rest.fill);
});
