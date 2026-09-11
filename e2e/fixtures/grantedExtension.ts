import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
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

// tabGroups is OPTIONAL in the shipped manifest, and an optional permission
// cannot be pre-granted in a Playwright profile, so every group band is
// unreachable through extension.ts. This loads a scratch COPY of the pruned
// dist whose manifest makes tabGroups required: Chrome grants required
// permissions at install. The shipped manifest and dist/ are never touched.
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

interface Manifest {
  permissions?: string[];
  optional_permissions?: string[];
}

export const grantedTest = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const copy = mkdtempSync(join(tmpdir(), 'tabkeeper-granted-'));
    cpSync(DIST, copy, { recursive: true });
    const manifestPath = join(copy, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    manifest.permissions = [...(manifest.permissions ?? []), 'tabGroups'];
    manifest.optional_permissions = (
      manifest.optional_permissions ?? []
    ).filter((p) => p !== 'tabGroups');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const userDataDir = mkdtempSync(join(tmpdir(), 'tabkeeper-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      channel: 'chromium',
      args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(copy, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = grantedTest.expect;
