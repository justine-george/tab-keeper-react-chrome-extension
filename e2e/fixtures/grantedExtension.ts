import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blockCloud } from './cloud';
import {
  REUSE_BROWSER,
  ReusedBrowser,
  removeDirs,
  type LaunchedBrowser,
} from './reusedBrowser';
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

export const grantedTest = base.extend<
  {
    context: BrowserContext;
    serviceWorker: Worker;
    extensionId: string;
    keepWindowBounds: boolean;
    showScrollbars: boolean;
    refuseSessions: boolean;
  },
  { reused: ReusedBrowser }
>({
  // KAN-766. Only used under E2E_REUSE_BROWSER=1.
  reused: [
    async ({}, use) => {
      const reused = new ReusedBrowser();
      await use(reused);
      await reused.close();
    },
    { scope: 'worker' },
  ],

  // Off by default. Two things in the harness move a window away from the
  // bounds windows.create gave it, measured 2026-09-24 (KAN-280): headless
  // Chromium's screen is 800x600, so a 900x640 window at 140,90 is clamped to
  // 800x600 at 0,0; and Playwright resizes the window of every page it
  // attaches to to its default 1280x720 viewport. On, the screen is
  // 1920x1080 and no viewport is imposed, so a window keeps its bounds and
  // can be maximized. Opt in with `grantedTest.use({ keepWindowBounds: true })`.
  keepWindowBounds: [false, { option: true }],

  // As in extension.ts (KAN-188): headless hides every scrollbar unless a
  // spec opts in with `grantedTest.use({ showScrollbars: true })`.
  showScrollbars: [false, { option: true }],

  // KAN-663. A close in Open now asks for `sessions` itself. With this on,
  // the copy's manifest no longer offers it, so Chrome refuses the ask and
  // Reopen recreates: the profile a refusal or a policy leaves. Opt in with
  // `grantedTest.use({ refuseSessions: true })`.
  refuseSessions: [false, { option: true }],

  // `headless` is Playwright's own option, true unless the run passes
  // --headed: a spec that needs a real window manager can then be run headed
  // on purpose (open-now-close.spec.ts test 2).
  context: async (
    { keepWindowBounds, showScrollbars, refuseSessions, headless, reused },
    use,
    testInfo
  ) => {
    const launch = async (): Promise<LaunchedBrowser> => {
      const copy = mkdtempSync(join(tmpdir(), 'tabkeeper-granted-'));
      cpSync(DIST, copy, { recursive: true });
      const manifestPath = join(copy, 'manifest.json');
      const manifest = JSON.parse(
        readFileSync(manifestPath, 'utf8')
      ) as Manifest;
      manifest.permissions = [...(manifest.permissions ?? []), 'tabGroups'];
      manifest.optional_permissions = (
        manifest.optional_permissions ?? []
      ).filter(
        (p) => p !== 'tabGroups' && !(refuseSessions && p === 'sessions')
      );
      writeFileSync(manifestPath, JSON.stringify(manifest));

      const userDataDir = mkdtempSync(join(tmpdir(), 'tabkeeper-e2e-'));
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        channel: 'chromium',
        ...(keepWindowBounds ? { viewport: null } : {}),
        ...(showScrollbars ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}),
        args: [
          `--disable-extensions-except=${copy}`,
          `--load-extension=${copy}`,
          ...(keepWindowBounds ? ['--screen-info={1920x1080}'] : []),
        ],
      });
      return { context, removeFiles: removeDirs(userDataDir, copy) };
    };

    const launched = REUSE_BROWSER ? undefined : await launch();
    const context =
      launched?.context ??
      (await reused.take(
        JSON.stringify({
          keepWindowBounds,
          showScrollbars,
          refuseSessions,
          headless,
        }),
        launch
      ));
    // KAN-259. Same as extension.ts: no granted spec is about the cloud
    // question, so the profile always starts as a user who said yes.
    await seedCloudConsentIfSettingsAbsent(context);
    // No granted spec needs the dev cloud (KAN-383).
    await blockCloud(context);
    await use(context);
    if (launched) {
      await context.close();
      launched.removeFiles();
    } else {
      await reused.giveBack(testInfo.status === testInfo.expectedStatus);
    }
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
