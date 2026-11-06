import {
  chromium,
  expect as baseExpect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blockCloud } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';

// KAN-932, KAN-933. Settings › Display › Toolbar icon, in the real build. Chrome
// has no way to read a toolbar icon back, so these pin what reaches setIcon.

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const LANGS = [
  'en',
  'de',
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
];
const VIEWS = [
  { name: 'popup', path: 'index.html', width: 790, height: 550 },
  { name: 'full view', path: 'index.html?view=tab', width: 1280, height: 800 },
] as const;

// Written out, so a mix-up in toolbarIconPath fails here.
const LIGHT_ICON = {
  16: 'icons/toolbar-light-16.png',
  32: 'icons/toolbar-light-32.png',
};
const DARK_ICON = {
  16: 'icons/toolbar-dark-16.png',
  32: 'icons/toolbar-dark-32.png',
};

// Every path a page hands setIcon, as window.iconsSet.
const recordIcons = (context: BrowserContext) =>
  context.addInitScript(() => {
    const action = (globalThis as { chrome?: typeof chrome }).chrome?.action;
    if (!action?.setIcon) return;
    const set = action.setIcon.bind(action);
    const seen: unknown[] = [];
    Object.assign(window, { iconsSet: seen });
    action.setIcon = ((details: chrome.action.TabIconDetails) => {
      seen.push(details.path);
      return set(details);
    }) as typeof action.setIcon;
  });
const iconsSet = (page: Page) =>
  page.evaluate(() => (window as unknown as { iconsSet: unknown[] }).iconsSet);

test('Monochrome mirrors for the worker, draws for the mode, and stays chosen after a reopen', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await recordIcons(context);
  await seedSessions(context, buildContainer());
  await seedSettings(context, {});
  const page = await context.newPage();
  const refused: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Could not')) refused.push(message.text());
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const group = page.getByRole('group', { name: 'Toolbar icon', exact: true });
  await expect(group.getByRole('button', { name: 'Color' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(await iconsSet(page)).toEqual([]);

  await group.getByRole('button', { name: 'Monochrome' }).click();

  await expect.poll(() => iconsSet(page)).toEqual([LIGHT_ICON]);
  await expect
    .poll(() =>
      serviceWorker.evaluate(() =>
        chrome.storage.local.get(['toolbarIcon', 'toolbarMode'])
      )
    )
    .toEqual({ toolbarIcon: 'monochrome', toolbarMode: 'dark' });
  expect(refused).toEqual([]);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => iconsSet(page)).toEqual([LIGHT_ICON, DARK_ICON]);

  await group.getByRole('button', { name: 'Color' }).click();
  await expect
    .poll(() => iconsSet(page))
    .toEqual([LIGHT_ICON, DARK_ICON, 'icons/icon128.png']);

  // CONTROL: on Colour, a mode change touches nothing.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  expect(await iconsSet(page)).toHaveLength(3);

  await group.getByRole('button', { name: 'Monochrome' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    group.getByRole('button', { name: 'Monochrome' })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => iconsSet(page)).toEqual([LIGHT_ICON]);
});

test('another open page shows the choice without a reload', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer());
  await seedSettings(context, {});
  const open = async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    return page.getByRole('group', { name: 'Toolbar icon', exact: true });
  };
  const here = await open();
  const there = await open();

  await here.getByRole('button', { name: 'Monochrome' }).click();

  await expect(
    there.getByRole('button', { name: 'Monochrome' })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('every icon file is in the build and Chrome takes it', async ({
  serviceWorker,
}) => {
  for (const path of ['icons/icon128.png', LIGHT_ICON, DARK_ICON]) {
    await serviceWorker.evaluate((details) => chrome.action.setIcon(details), {
      path,
    });
  }
  // CONTROL: Chrome refuses a file the build lacks.
  await expect(
    serviceWorker.evaluate(() =>
      chrome.action.setIcon({ path: 'icons/toolbar-none-16.png' })
    )
  ).rejects.toThrow();
});

test('the tiles draw their icons from the build, at 16px', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context, buildContainer());
  await seedSettings(context, {});
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const group = page.getByRole('group', { name: 'Toolbar icon', exact: true });
  const images = group.locator('img');
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((all) =>
        all.map((image) => {
          const img = image as HTMLImageElement;
          return [img.complete && img.naturalWidth > 0, img.width];
        })
      )
    )
    .toEqual([
      [true, 16],
      [true, 16],
    ]);
});

for (const view of VIEWS) {
  for (const lang of LANGS) {
    test(`${view.name}, ${lang}: both tiles fit the pane at 16, 20 and 24px`, async ({
      context,
      extensionId,
    }) => {
      const L = localeStrings(lang);
      await seedSessions(context, buildContainer());
      await seedSettings(context, lang === 'en' ? {} : { language: lang });
      const page = await context.newPage();
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.goto(`chrome-extension://${extensionId}/${view.path}`);
      await page.locator(`[aria-label="${L['Settings']}"]`).first().click();
      const group = page.getByRole('group', {
        name: L['Toolbar icon'],
        exact: true,
      });
      await expect(group.getByRole('button')).toHaveCount(2);
      for (const root of [16, 20, 24]) {
        await page.evaluate((px) => {
          document.documentElement.style.fontSize = `${px}px`;
        }, root);
        const fit = await group.evaluate((node) => {
          const section = node.closest('[data-settings-section]');
          if (!section) throw new Error('no settings section');
          const pad = parseFloat(getComputedStyle(section).paddingRight);
          const right = section.getBoundingClientRect().right - pad;
          return {
            over: [...node.querySelectorAll('button')].filter(
              (button) => button.getBoundingClientRect().right > right + 1
            ).length,
            sideways:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          };
        });
        expect(fit, `${root}px`).toEqual({ over: 0, sideways: false });
      }
    });
  }
}

// The worker's own apply, on a real start. setIcon is wrapped in a copy of the
// build, ahead of the worker's first line, because nothing can reach it sooner.
const startWith = async (
  stored: Record<string, string>
): Promise<unknown[]> => {
  const dir = mkdtempSync(join(tmpdir(), 'tabkeeper-icon-'));
  try {
    const copy = join(dir, 'tk');
    cpSync(DIST, copy, { recursive: true });
    const file = join(copy, 'background.js');
    writeFileSync(
      file,
      `globalThis.iconsSet=[];{const set=chrome.action.setIcon.bind(chrome.action);chrome.action.setIcon=(d)=>{globalThis.iconsSet.push(d.path);return set(d);};}\n${readFileSync(file, 'utf8')}`
    );
    const launch = () =>
      chromium.launchPersistentContext(join(dir, 'profile'), {
        headless: true,
        channel: 'chromium',
        args: [
          `--disable-extensions-except=${copy}`,
          `--load-extension=${copy}`,
        ],
      });
    const workerOf = async (context: Awaited<ReturnType<typeof launch>>) =>
      context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker');

    const first = await launch();
    await (
      await workerOf(first)
    ).evaluate((items) => chrome.storage.local.set(items), stored);
    await first.close();

    const second = await launch();
    const worker = await workerOf(second);
    let seen: unknown[] = [];
    await baseExpect
      .poll(async () => {
        seen = await worker.evaluate(
          () => (globalThis as unknown as { iconsSet: unknown[] }).iconsSet
        );
        return seen.length;
      })
      .toBeGreaterThan(0);
    await second.close();
    return seen;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

base('a restart applies Monochrome in the last mode a page saw', async () => {
  const seen = await startWith({
    toolbarIcon: 'monochrome',
    toolbarMode: 'dark',
  });
  baseExpect(new Set(seen.map((path) => JSON.stringify(path)))).toEqual(
    new Set([JSON.stringify(LIGHT_ICON)])
  );
});

base('worst path: a stored value no build wrote starts on Colour', async () => {
  const seen = await startWith({ toolbarIcon: 'neon', toolbarMode: 'dusk' });
  baseExpect(new Set(seen)).toEqual(new Set(['icons/icon128.png']));
});

// The real thing: Chrome's own Mode setting, which emulateMedia only stands in for.
base('an open page follows Chrome’s real Mode setting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabkeeper-mode-'));
  const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
    headless: true,
    channel: 'chromium',
    colorScheme: null,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  try {
    await blockCloud(context);
    await recordIcons(context);
    await seedSessions(context, buildContainer());
    await seedSettings(context, { toolbarIcon: 'monochrome' });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${new URL(worker.url()).host}/index.html?view=tab`
    );
    const settings = await context.newPage();
    await settings.goto('chrome://settings/appearance');
    const mode = settings.locator('#colorSchemeModeSelect');
    const last = async () => (await iconsSet(page)).slice(-1)[0];

    await mode.selectOption({ label: 'Light' });
    await baseExpect.poll(last).toEqual(DARK_ICON);
    await mode.selectOption({ label: 'Dark' });
    await baseExpect.poll(last).toEqual(LIGHT_ICON);
    await mode.selectOption({ label: 'Light' });
    await baseExpect.poll(last).toEqual(DARK_ICON);
    await baseExpect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.storage.local.get('toolbarMode')).toolbarMode
        )
      )
      .toBe('light');
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
