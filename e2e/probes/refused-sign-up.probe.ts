import { SIGN_UP } from '../fixtures/cloud';
import { test, expect } from '../fixtures/extension';
import { buildContainer, seedSessions } from '../fixtures/seed';

// KAN-983. Run by e2e/cloud-sign-up-refused.spec.ts. Both tests meet a refused
// sign-up (faked, so none is spent); one then fails, one passes.
test.use({ cloud: true });

test.beforeEach(async ({ context, extensionId }) => {
  await context.route(SIGN_UP, (route) =>
    route.fulfill({
      status: 400,
      json: { error: { message: 'PROBE_REFUSAL' } },
    })
  );
  await seedSessions(context, buildContainer());
  const page = await context.newPage();
  const refused = page.waitForResponse(SIGN_UP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await refused;
});

test('fails after a refusal', () => {
  expect('the app').toBe('broken');
});

test('passes after a refusal', () => {
  expect(true).toBe(true);
});
