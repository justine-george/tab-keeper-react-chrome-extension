import type { Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { THEMES } from './fixtures/onboarding';
import { localeStrings } from './fixtures/locales';
import { expectReadable } from './fixtures/textContrast';
import { rgbToHex } from './fixtures/pixels';
import { mixHex } from '../src/styles/mixHex';

// KAN-450, KAN-732. The tab-group offer closes like the sync dialog: Not now
// outlined, then a filled Turn on half as wide again, paired at the right.

async function openOffer(
  context: Parameters<typeof seedSessions>[0],
  serviceWorker: Worker,
  extensionId: string,
  settings: Record<string, unknown> = {}
): Promise<Page> {
  const groups = await serviceWorker.evaluate(async () => {
    const newTab = () =>
      new Promise<chrome.tabs.Tab>((resolve) =>
        chrome.tabs.create({ url: 'about:blank', active: false }, resolve)
      );
    const [a, b] = [await newTab(), await newTab()];
    await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
    const tabs = await chrome.tabs.query({});
    return new Set(
      tabs.map((t) => t.groupId).filter((g) => g !== undefined && g !== -1)
    ).size;
  });
  expect(groups, 'fixture must create a real tab group').toBe(1);
  await seedSettings(context, settings);
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole('dialog')).toBeVisible();
  return page;
}

const buttonsOf = (page: Page) => ({
  notNow: page.getByRole('button', { name: 'Not now', exact: true }),
  turnOn: page.getByRole('button', { name: 'Turn on', exact: true }),
});

test('Not now then a filled Turn on, paired at the right, 48px', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await openOffer(context, serviceWorker, extensionId);
  const { notNow, turnOn } = buttonsOf(page);
  await expect(turnOn).toBeVisible();
  const [n, t, d] = await Promise.all([
    notNow.boundingBox(),
    turnOn.boundingBox(),
    page.getByRole('dialog').boundingBox(),
  ]);
  // One row, Not now first, both right of the dialog's centre.
  expect(Math.abs(n!.y + n!.height / 2 - (t!.y + t!.height / 2))).toBeLessThan(
    2
  );
  expect(n!.x + n!.width).toBeLessThanOrEqual(t!.x);
  expect(n!.x).toBeGreaterThan(d!.x + d!.width / 2);
  // Flush with the card's padding on the right.
  expect(d!.x + d!.width - (t!.x + t!.width)).toBeLessThan(25);
  expect(n!.height).toBe(48);
  expect(t!.height).toBe(48);
  // Half as wide again (first-run-look's expectRatio).
  expect(Math.abs(t!.width - 1.5 * n!.width)).toBeLessThanOrEqual(1);
  const style = (
    l: typeof turnOn,
    prop: 'backgroundColor' | 'textDecorationLine' | 'borderTopWidth'
  ) => l.evaluate((el, p) => getComputedStyle(el)[p], prop);
  expect(rgbToHex(await style(turnOn, 'backgroundColor'))).not.toBe(
    rgbToHex(
      await page
        .getByRole('dialog')
        .evaluate((el) => getComputedStyle(el).backgroundColor)
    )
  );
  // Outlined, not a link.
  expect(await style(notNow, 'textDecorationLine')).toBe('none');
  expect(await style(notNow, 'borderTopWidth')).toBe('1px');
  await expect(
    page.getByRole('button', { name: 'Enable tab group support' })
  ).toHaveCount(0);
});

test('a user who answered once on 1.9 gets the same two buttons', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await openOffer(context, serviceWorker, extensionId, {
    isTabGroupsPromptAnsweredOnce: true,
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: "Don't ask again", exact: true })
  ).toHaveCount(0);
  // Retired on load: settings are written back without it.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('settingsData') ?? '{}')
  );
  expect(stored).not.toHaveProperty('isTabGroupsPromptAnsweredOnce');
});

// Every language at Chrome's Medium, Large and Very large: one row, nothing clipped.
const ALL_LANGS = [
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'sv',
  'zh',
  'zh-TW',
] as const;

test('the pair is one row in every language at 16, 20 and 24px', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const page = await openOffer(context, serviceWorker, extensionId);
  const slack: Record<string, number> = {};
  for (const lang of ALL_LANGS) {
    await page.evaluate((l) => {
      const s = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
      localStorage.setItem(
        'settingsData',
        JSON.stringify({ ...s, language: l })
      );
    }, lang);
    await page.reload();
    const { 'Not now': notNowLabel, 'Turn on': turnOnLabel } =
      localeStrings(lang);
    // In the dialog: zh-TW's Turn on (開啟) is also a session row's Open behind it.
    const dialog = page.getByRole('dialog');
    const notNow = dialog.getByRole('button', {
      name: notNowLabel,
      exact: true,
    });
    const turnOn = dialog.getByRole('button', {
      name: turnOnLabel,
      exact: true,
    });
    await expect(turnOn).toBeVisible();
    for (const px of [16, 20, 24]) {
      const at = `${lang} at ${px}px`;
      await page.evaluate(
        (p) => (document.documentElement.style.fontSize = `${p}px`),
        px
      );
      const m = await page.getByRole('dialog').evaluate((d) => {
        const cs = getComputedStyle(d);
        const right =
          d.getBoundingClientRect().right -
          parseFloat(cs.paddingRight) -
          parseFloat(cs.borderRightWidth);
        const left =
          d.getBoundingClientRect().left +
          parseFloat(cs.paddingLeft) +
          parseFloat(cs.borderLeftWidth);
        const [a, b] = [...d.querySelectorAll('button')];
        // A squeezed label wraps inside the fixed 48px rather than overflowing sideways.
        const lines = (el: Element) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set([...r.getClientRects()].map((x) => Math.round(x.top)))
            .size;
        };
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return {
          rowGap: Math.abs(ra.top + ra.height / 2 - (rb.top + rb.height / 2)),
          overRight: rb.right - right,
          slack: ra.left - left,
          clipped:
            a.scrollWidth > a.clientWidth || b.scrollWidth > b.clientWidth,
          wrapped: lines(a) > 1 || lines(b) > 1,
        };
      });
      expect(m.rowGap, at).toBeLessThan(2);
      expect(m.overRight, at).toBeLessThanOrEqual(0.5);
      expect(m.clipped, at).toBe(false);
      expect(m.wrapped, at).toBe(false);
      slack[at] = Math.round(m.slack);
    }
    await expect(notNow).toBeVisible();
  }
  const [tightest, px] = Object.entries(slack).sort((x, y) => x[1] - y[1])[0];
  console.log(`tightest: ${tightest}, ${px}px to spare`);
  expect(px).toBeGreaterThan(0);
});

for (const [theme, palette] of THEMES) {
  test(`${theme}: Turn on (rest, hover, press) and Not now read at 4.5:1`, async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const page = await openOffer(context, serviceWorker, extensionId, {
      theme,
    });
    const { notNow, turnOn } = buttonsOf(page);
    const fillIs = (hex: string) => () =>
      turnOn
        .evaluate((el) => getComputedStyle(el).backgroundColor)
        .then((c) => expect(rgbToHex(c)).toBe(hex));

    await page.mouse.move(0, 0);
    await expect(fillIs(palette.TEXT_COLOR)).toPass();
    await expectReadable(turnOn, `${theme} Turn on, rest`);
    await expectReadable(notNow, `${theme} Not now, rest`);

    await turnOn.hover();
    await expect(
      fillIs(mixHex(palette.TEXT_COLOR, palette.PRIMARY_COLOR, 0.88))
    ).toPass();
    await expectReadable(turnOn, `${theme} Turn on, hover`);

    await page.mouse.down();
    await expect(
      fillIs(mixHex(palette.TEXT_COLOR, palette.PRIMARY_COLOR, 0.76))
    ).toPass();
    await expectReadable(turnOn, `${theme} Turn on, press`);
    await page.mouse.up();
  });
}
