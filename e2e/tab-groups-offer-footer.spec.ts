import type { Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { THEMES } from './fixtures/onboarding';
import { expectReadable } from './fixtures/textContrast';
import { rgbToHex } from './fixtures/pixels';

// KAN-450. The tab-group offer closes like the other first-open dialogs: Not
// now as a link on the left, a filled Turn on on the right.

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

test('Not now is on the left, a filled Turn on on the right, one row', async ({
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
  expect(n!.x + n!.width).toBeLessThanOrEqual(t!.x);
  expect(Math.abs(n!.y + n!.height / 2 - (t!.y + t!.height / 2))).toBeLessThan(
    2
  );
  // Flush with the card's padding on each side.
  expect(n!.x - d!.x).toBeLessThan(25);
  expect(d!.x + d!.width - (t!.x + t!.width)).toBeLessThan(25);
  const fill = (l: typeof turnOn) =>
    l.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(rgbToHex(await fill(turnOn))).not.toBe(
    rgbToHex(await fill(page.getByRole('dialog')))
  );
  expect(
    await notNow.evaluate((el) => getComputedStyle(el).textDecorationLine)
  ).toBe('underline');
  await expect(
    page.getByRole('button', { name: 'Enable tab group support' })
  ).toHaveCount(0);
});

test('Don’t ask again, once earned, sits under the footer', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await openOffer(context, serviceWorker, extensionId, {
    isTabGroupsPromptAnsweredOnce: true,
  });
  const never = page.getByRole('button', {
    name: "Don't ask again",
    exact: true,
  });
  await expect(never).toBeVisible();
  const [t, v] = await Promise.all([
    buttonsOf(page).turnOn.boundingBox(),
    never.boundingBox(),
  ]);
  expect(v!.y).toBeGreaterThanOrEqual(t!.y + t!.height);
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
    await expect(fillIs(palette.SELECTION_COLOR)).toPass();
    await expectReadable(turnOn, `${theme} Turn on, rest`);
    await expectReadable(notNow, `${theme} Not now, rest`);

    await turnOn.hover();
    await expect(fillIs(palette.ICON_HOVER_COLOR)).toPass();
    await expectReadable(turnOn, `${theme} Turn on, hover`);

    await page.mouse.down();
    await expect(fillIs(palette.ICON_ACTIVE_COLOR)).toPass();
    await expectReadable(turnOn, `${theme} Turn on, press`);
    await page.mouse.up();
  });
}
