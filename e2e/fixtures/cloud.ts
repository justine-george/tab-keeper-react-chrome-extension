import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type BrowserContext, type Page } from '@playwright/test';

import {
  buildContainer,
  buildSession,
  seedCloudConsentIfSettingsAbsent,
} from './seed';

// The dev project's auth and database.
export const CLOUD =
  /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/;

// Each boot signs up an anonymous account; Firebase allows 100 an hour per IP (KAN-383).
export async function blockCloud(context: BrowserContext): Promise<void> {
  await context.route(CLOUD, (route) => route.abort());
}

// Registered after blockCloud, so it runs first; still aborts.
export async function countCloudRequests(
  context: BrowserContext
): Promise<string[]> {
  const hits: string[] = [];
  await context.route(CLOUD, (route) => {
    hits.push(route.request().url());
    return route.abort();
  });
  return hits;
}

// A Google API key is in the bundle only if the build had a Firebase config.
// Read on call: every spec imports this module through the fixture.
export function hasCloudConfig(): boolean {
  const dist = fileURLToPath(new URL('../../dist', import.meta.url));
  return readdirSync(dist, { recursive: true, encoding: 'utf8' }).some(
    (f) =>
      f.endsWith('.js') &&
      /AIza[\w-]{35}/.test(readFileSync(join(dist, f), 'utf8'))
  );
}

export const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
export const COMMIT = /firestore\.googleapis\.com\/.*documents:commit/;

// Once per profile: init scripts re-run on every navigation, and a spec reloads.
export async function seedOnce(
  context: BrowserContext,
  sessions: ReturnType<typeof buildSession>[]
): Promise<void> {
  await context.addInitScript(
    (value: string) => {
      try {
        if (window.localStorage.getItem('e2e-seeded') !== null) return;
        window.localStorage.setItem('e2e-seeded', '1');
        window.localStorage.setItem('tabContainerData', value);
      } catch {
        // Storage blocked; the assertions below say so more clearly.
      }
    },
    JSON.stringify(buildContainer(sessions))
  );
}

// Resolves true once a write has LANDED in the cloud (the response, not the request), false after 20s.
export function commitLanded(page: Page): Promise<boolean> {
  return page.waitForResponse(COMMIT, { timeout: 20_000 }).then(
    () => true,
    () => false
  );
}

export interface SecondDevice {
  page: Page;
  // Whether the first load's sync wrote to the cloud.
  committed: Promise<boolean>;
  reload(): Promise<void>;
  close(): Promise<void>;
}

// A second profile that adopts `token` (a device id is only a uuid in chrome.storage.sync) and
// opens the popup holding `sessions`; it stays open until close().
export async function openSecondDevice(
  token: string,
  sessions: ReturnType<typeof buildSession>[]
): Promise<SecondDevice> {
  const dir = mkdtempSync(join(tmpdir(), 'tabkeeper-e2e-b-'));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  const close = async () => {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    await seedCloudConsentIfSettingsAbsent(context);
    await seedOnce(context, sessions);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await worker.evaluate(
      (t: string) => chrome.storage.sync.set({ tokenValue: t }),
      token
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 790, height: 550 });
    const committed = commitLanded(page);
    await page.goto(
      `chrome-extension://${new URL(worker.url()).host}/index.html`
    );
    return {
      page,
      committed,
      reload: async () => {
        await page.reload();
      },
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
