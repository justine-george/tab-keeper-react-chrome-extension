import { chromium } from '@playwright/test';

import { launchProfile } from './fixtures/cloud';
import { test, expect } from './fixtures/extension';

// KAN-478. --headed sets Playwright's `headless` option to false, so both
// launches must pass the option on. Each launch here records what it was asked
// for, then runs headless anyway: a headed one would open windows on the
// machine running the suite.
test.use({ headless: false });

const asked: (boolean | undefined)[] = [];
const launch = chromium.launchPersistentContext.bind(chromium);

test.beforeEach(() => {
  asked.length = 0;
  chromium.launchPersistentContext = (userDataDir, options) => {
    asked.push(options?.headless);
    return launch(userDataDir, { ...options, headless: true });
  };
});

test.afterEach(() => {
  chromium.launchPersistentContext = launch;
});

test('the fixture and a second profile both ask for what the option says', async ({
  extensionId,
  headless,
}) => {
  expect(extensionId).not.toBe('');
  expect(headless).toBe(false);

  const profile = await launchProfile(headless);
  await profile.close();

  expect(asked).toEqual([false, false]);
});
