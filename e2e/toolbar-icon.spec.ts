import { chromium, expect as baseExpect, test as base } from '@playwright/test';
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

import { test, expect } from './fixtures/extension';
import { localeStrings } from './fixtures/locales';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import { toolbarIconPath } from '../src/utils/functions/toolbarIcon';

// KAN-932. Settings › Display › Toolbar icon, in the real build. Chrome has no
// way to read a toolbar icon back, so these pin what reaches setIcon.

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

test('a tile mirrors for the worker, sets the icon and stays chosen after a reopen', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSessions(context, buildContainer());
  await seedSettings(context, {});
  const page = await context.newPage();
  const refused: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Could not')) refused.push(message.text());
  });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const group = page.getByRole('group', { name: 'Toolbar icon', exact: true });
  await expect(group.getByRole('button', { name: 'Colour' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await group.getByRole('button', { name: 'Dark' }).click();

  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () => (await chrome.storage.local.get('toolbarIcon')).toolbarIcon
      )
    )
    .toBe('dark');
  await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(refused).toEqual([]);

  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
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

  await here.getByRole('button', { name: 'Light' }).click();

  await expect(there.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('every icon file is in the build and Chrome takes it', async ({
  serviceWorker,
}) => {
  for (const icon of ['colour', 'light', 'dark'] as const) {
    const path = toolbarIconPath(icon);
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

test('the tile draws its icon from the build, at 16px, before the puzzle piece', async ({
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
  await expect(images).toHaveCount(3);
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
      [true, 16],
    ]);
  const order = await group
    .locator('[data-toolbar-part]')
    .evaluateAll((parts) =>
      parts.slice(0, 3).map((part) => ({
        name: part.getAttribute('data-toolbar-part'),
        left: part.getBoundingClientRect().left,
      }))
    );
  expect(order.map((part) => part.name)).toEqual(['icon', 'puzzle', 'menu']);
  expect(order[0].left).toBeLessThan(order[1].left);
  expect(order[1].left).toBeLessThan(order[2].left);
});

for (const view of VIEWS) {
  for (const lang of LANGS) {
    test(`${view.name}, ${lang}: the three tiles fit the pane at 16, 20 and 24px`, async ({
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
      await expect(group.getByRole('button')).toHaveCount(3);
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
const startWith = async (stored: unknown): Promise<unknown[]> => {
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
    ).evaluate(
      (value) => chrome.storage.local.set({ toolbarIcon: value }),
      stored
    );
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

base('a restart applies the stored icon', async () => {
  const seen = await startWith('light');
  baseExpect(new Set(seen.map((path) => JSON.stringify(path)))).toEqual(
    new Set([JSON.stringify(toolbarIconPath('light'))])
  );
});

base('worst path: a stored value no build wrote starts on Colour', async () => {
  const seen = await startWith('neon');
  baseExpect(new Set(seen)).toEqual(new Set([toolbarIconPath('colour')]));
});
