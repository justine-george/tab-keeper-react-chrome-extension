import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SIGN_UP,
  hasCloudConfig,
  launchProfile,
  refusedSignUpsError,
  takeRefusedSignUps,
  workerOf,
} from './fixtures/cloud';
import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  seedCloudConsentIfSettingsAbsent,
  seedSessions,
} from './fixtures/seed';

// KAN-983. The dev cloud allows 100 anonymous sign-ups an hour per IP. Past
// that, every cloud spec failed on whatever it checked next ("received 0"),
// which read as an app bug. A refused sign-up is now recorded from every
// profile a test opens, and a failed cloud test names it.
// The refusal is faked here, so these tests spend no sign-up.

const REFUSAL = {
  error: {
    code: 400,
    message: 'QUOTA_EXCEEDED : Exceeded quota for creating account.',
  },
};

test.describe('a refused sign-up is recorded (KAN-983)', () => {
  test.use({ cloud: true });

  test('CONTROL: a sign-up that succeeds is not recorded', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    // An empty 200 is enough to be a success; the SDK then stops, so nothing reaches Google.
    await context.route(SIGN_UP, (route) =>
      route.fulfill({ status: 200, json: {} })
    );
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    const signedUp = page.waitForResponse(SIGN_UP);
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await signedUp;

    expect(await takeRefusedSignUps()).toEqual([]);
  });

  test('from the test’s own profile', async ({ context, extensionId }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    await context.route(SIGN_UP, (route) =>
      route.fulfill({ status: 400, json: REFUSAL })
    );
    await seedSessions(context, buildContainer());
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    await expect
      .poll(() => takeRefusedSignUps(), { timeout: 20_000 })
      .toEqual([`400 ${REFUSAL.error.message}`]);
  });

  // A proxy's page or an odd body still records the status.
  for (const [what, status, body] of [
    ['a body that is not JSON', 429, 'Too Many Requests'],
    ['a JSON body with no error', 400, 'null'],
  ] as const) {
    test(`with ${what}`, async ({ context, extensionId }) => {
      test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
      await context.route(SIGN_UP, (route) => route.fulfill({ status, body }));
      await seedSessions(context, buildContainer());
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/index.html`);

      await expect
        .poll(() => takeRefusedSignUps(), { timeout: 20_000 })
        .toEqual([`${status}`]);
    });
  }

  test('from a second profile', async ({ headless }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    const profile = await launchProfile(headless);
    try {
      await profile.context.route(SIGN_UP, (route) =>
        route.fulfill({ status: 400, json: REFUSAL })
      );
      await seedCloudConsentIfSettingsAbsent(profile.context);
      await seedSessions(profile.context, buildContainer());
      const worker = await workerOf(profile.context);
      const page = await profile.context.newPage();
      await page.goto(
        `chrome-extension://${new URL(worker.url()).host}/index.html`
      );
      await expect
        .poll(() => takeRefusedSignUps(), { timeout: 20_000 })
        .toEqual([`400 ${REFUSAL.error.message}`]);
    } finally {
      await profile.close();
    }
  });
});

test.describe('a failed cloud test names the refusal (KAN-983)', () => {
  test('a failure after a refusal says the cloud refused, not the app', () => {
    const error = refusedSignUpsError(['400 QUOTA_EXCEEDED'], true);
    expect(error?.message).toContain('refused 1 sign-up');
    expect(error?.message).toContain('400 QUOTA_EXCEEDED');
    expect(error?.message).toContain('100 anonymous sign-ups an hour');
  });

  test('a pass, or a failure with no refusal, adds nothing', () => {
    expect(refusedSignUpsError(['400 QUOTA_EXCEEDED'], false)).toBeNull();
    expect(refusedSignUpsError([], true)).toBeNull();
  });
});

// The fixture itself, through a real run: e2e/probes fail on purpose.
test('a run whose cloud test failed after a refusal reports it on that test only (KAN-983)', () => {
  test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
  test.setTimeout(120_000);
  const config = fileURLToPath(
    new URL('./probes/playwright.probe.config.ts', import.meta.url)
  );
  const run = spawnSync('npx', ['playwright', 'test', '--config', config], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const out = run.stdout + run.stderr;
  expect(out).toContain('1 failed');
  expect(out).toContain('1 passed');
  expect(
    out.match(/The dev cloud refused 1 sign-up \(400 PROBE_REFUSAL\)/g)
  ).toHaveLength(1);
});
