import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The built, pruned artifact -- what `npm run build:e2e` produces and what
// users actually install. Testing an unpruned build would test a bundle that
// never ships.
//
// Resolved from import.meta.url rather than __dirname: package.json sets
// "type": "module", so Playwright loads this as ESM and __dirname does not
// exist. Resolving relative to this file also keeps it correct regardless of
// the directory playwright was invoked from.
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  context: async ({}, use) => {
    // A throwaway profile per test: extension state (localStorage,
    // chrome.storage) persists in the profile, so sharing one would let tests
    // leak into each other.
    const userDataDir = mkdtempSync(join(tmpdir(), 'tabkeeper-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // `channel: 'chromium'` is load-bearing. Plain headless uses the
      // headless SHELL, which never loads the extension -- the service worker
      // simply never registers and waitForEvent below times out. Measured
      // 2026-09-01 across all three modes.
      headless: true,
      channel: 'chromium',
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });

    await use(context);

    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    // Measured: context.serviceWorkers() is EMPTY immediately after launch in
    // every mode tried. Awaiting the event is required, not defensive -- a
    // bare [0] here would throw every run, not intermittently.
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    // The unpacked id is derived from the load path, so it is stable for a
    // fixed checkout -- but read it rather than hardcoding it.
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
