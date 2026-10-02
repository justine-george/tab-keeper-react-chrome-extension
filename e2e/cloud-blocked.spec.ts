import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from './fixtures/extension';
import { seedSessions } from './fixtures/seed';

// A Google API key is in the bundle only if the build had a Firebase config.
const ASSETS = fileURLToPath(new URL('../dist/assets', import.meta.url));
const hasCloudConfig = readdirSync(ASSETS).some(
  (f) =>
    f.endsWith('.js') &&
    /AIza[\w-]{35}/.test(readFileSync(join(ASSETS, f), 'utf8'))
);

// KAN-383. A boot signs up an anonymous account; by default the fixture stops
// it before it reaches Firebase, so specs cannot spend the per-IP signUp limit.
test('a default boot tries to sign up, and the request never leaves the browser', async ({
  context,
  extensionId,
}) => {
  // PR CI builds without one (KAN-147), and then nothing tries to sign up.
  test.skip(!hasCloudConfig, 'this build has no cloud config (CI)');
  const isSignUp = (url: string) => url.includes('accounts:signUp');
  // The first word on the sign-up: refused here, or answered by Firebase.
  const outcome = new Promise<string>((resolve) => {
    context.on('requestfailed', (r) => {
      if (isSignUp(r.url())) resolve(`failed ${r.failure()?.errorText}`);
    });
    context.on('response', (r) => {
      if (isSignUp(r.url())) resolve(`answered ${r.status()}`);
    });
  });
  await seedSessions(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();

  // A failure is also the CONTROL that the app did try.
  expect(await outcome).toBe('failed net::ERR_FAILED');
});
