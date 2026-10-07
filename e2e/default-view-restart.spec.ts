import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// KAN-7 §7. A stored Full is applied again when the browser starts, whatever
// Chrome kept. Its own launch: the fixture's profile dies with its context.

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const launch = (dir: string): Promise<BrowserContext> =>
  chromium.launchPersistentContext(dir, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });

const workerOf = async (context: BrowserContext): Promise<Worker> =>
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

test('a stored Full is applied again at the next browser start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabkeeper-restart-'));
  try {
    const first = await launch(dir);
    const before = await workerOf(first);
    // The page's mirror says Full; the popup disagrees, as after a lost apply.
    // The worker's own start-up applies are lost too, or one can land last (KAN-461).
    await before.evaluate(async () => {
      const setPopup = chrome.action.setPopup.bind(chrome.action);
      chrome.action.setPopup = () => Promise.resolve();
      await chrome.storage.local.set({ defaultView: 'full' });
      await setPopup({ popup: 'index.html' });
    });
    // CONTROL: the disagreement is real before the restart.
    expect(await before.evaluate(() => chrome.action.getPopup({}))).toMatch(
      /\/index\.html$/
    );
    await first.close();

    const second = await launch(dir);
    const after = await workerOf(second);
    await expect
      .poll(() => after.evaluate(() => chrome.action.getPopup({})))
      .toBe('');
    await second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
