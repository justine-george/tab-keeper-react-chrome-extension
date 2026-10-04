import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext } from '@playwright/test';

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
  const assets = fileURLToPath(new URL('../../dist/assets', import.meta.url));
  return readdirSync(assets).some(
    (f) =>
      f.endsWith('.js') &&
      /AIza[\w-]{35}/.test(readFileSync(join(assets, f), 'utf8'))
  );
}
