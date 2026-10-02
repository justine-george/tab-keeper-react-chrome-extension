import type { BrowserContext } from '@playwright/test';

// The dev project's auth and database.
export const CLOUD =
  /firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/;

// Each boot signs up an anonymous account; Firebase allows 100 an hour per IP (KAN-383).
export async function blockCloud(context: BrowserContext): Promise<void> {
  await context.route(CLOUD, (route) => route.abort());
}
