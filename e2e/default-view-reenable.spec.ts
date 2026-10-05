import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// KAN-7 §7. Disabling then enabling the extension resets Chrome's popup but
// fires neither onStartup nor onInstalled: a stored Full must still hold.

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

// A second extension whose only job is chrome.management.setEnabled.
function writeHelper(dir: string): string {
  const helper = join(dir, 'helper');
  mkdirSync(helper);
  writeFileSync(
    join(helper, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Management helper',
      version: '1',
      permissions: ['management'],
      background: { service_worker: 'sw.js' },
    })
  );
  writeFileSync(join(helper, 'sw.js'), '');
  return helper;
}

test('a stored Full survives disabling and re-enabling the extension', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabkeeper-reenable-'));
  try {
    const helper = writeHelper(dir);
    const context: BrowserContext = await chromium.launchPersistentContext(
      join(dir, 'profile'),
      {
        headless: true,
        channel: 'chromium',
        args: [
          `--disable-extensions-except=${DIST},${helper}`,
          `--load-extension=${DIST},${helper}`,
        ],
      }
    );
    const workers = async (): Promise<Worker[]> => {
      await expect
        .poll(() => context.serviceWorkers().length)
        .toBeGreaterThanOrEqual(2);
      return context.serviceWorkers();
    };
    const all = await workers();
    const tabKeeper = all.find((w) => w.url().endsWith('/background.js'));
    const manager = all.find((w) => w.url().endsWith('/sw.js'));
    if (tabKeeper === undefined || manager === undefined) {
      throw new Error('workers not found');
    }
    const id = new URL(tabKeeper.url()).host;

    await tabKeeper.evaluate(async () => {
      await chrome.storage.local.set({ defaultView: 'full' });
      await chrome.action.setPopup({ popup: '' });
    });
    // CONTROL: Full is applied before the disable.
    expect(await tabKeeper.evaluate(() => chrome.action.getPopup({}))).toBe('');

    await manager.evaluate(async (target) => {
      await chrome.management.setEnabled(target, false);
      await chrome.management.setEnabled(target, true);
    }, id);

    // The old worker died with the disable; find the new one by address.
    await expect
      .poll(() =>
        context
          .serviceWorkers()
          .some((w) => w.url().endsWith('/background.js') && w !== tabKeeper)
      )
      .toBe(true);
    const reborn = context
      .serviceWorkers()
      .find((w) => w.url().endsWith('/background.js') && w !== tabKeeper);
    if (reborn === undefined) throw new Error('no restarted worker');
    await expect
      .poll(() => reborn.evaluate(() => chrome.action.getPopup({})))
      .toBe('');
    await context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
