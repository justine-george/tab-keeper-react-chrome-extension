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

import { seedCloudConsentIfSettingsAbsent } from './seed';

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
  keepWindowBounds: boolean;
}>({
  // Off by default. Two things in the harness move a window away from the
  // bounds windows.create gave it, measured 2026-09-24 (KAN-280): headless
  // Chromium's screen is 800x600, so a 900x640 window at 140,90 is clamped to
  // 800x600 at 0,0; and Playwright resizes the window of every page it
  // attaches to to its default 1280x720 viewport. On, the screen is
  // 1920x1080 and no viewport is imposed, so a window keeps its bounds and
  // can be maximized. Opt in with `grantedTest.use({ keepWindowBounds: true })`.
  keepWindowBounds: [false, { option: true }],

  // `headless` is Playwright's own option, true unless the run passes
  // --headed: a spec that needs a real window manager can then be run headed
  // on purpose (open-now-close.spec.ts test 2).
  context: async ({ keepWindowBounds, headless }, use) => {
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
      headless,
      channel: 'chromium',
      ...(keepWindowBounds ? { viewport: null } : {}),
      args: [
        `--disable-extensions-except=${copy}`,
        `--load-extension=${copy}`,
        ...(keepWindowBounds ? ['--screen-info={1920x1080}'] : []),
      ],
    });
    // KAN-259. Same as extension.ts: no granted spec is about the cloud
    // question, so the profile always starts as a user who said yes.
    await seedCloudConsentIfSettingsAbsent(context);
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
