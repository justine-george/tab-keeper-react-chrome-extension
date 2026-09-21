import type { BrowserContext } from '@playwright/test';

import type { TabMasterContainer } from '../../src/redux/slices/tabContainerDataStateSlice';
import { buildContainer } from '../../src/tests/fixtures/sessionFixture';

// Re-exported so specs have one import point for fixture data, while src/
// stays the single source of truth -- the factory is schema-checked against
// the app's own isValidTabMasterContainer in sessionFixture.test.ts.
export {
  buildSession,
  buildContainer,
} from '../../src/tests/fixtures/sessionFixture';

// Sessions live in localStorage under `tabContainerData`; only the device id
// lives in chrome.storage.sync. For a signed-out run this is the whole seeding
// surface.
export async function seedSessions(
  context: BrowserContext,
  container: TabMasterContainer = buildContainer()
): Promise<void> {
  await seedLocalStorage(context, 'tabContainerData', container);
}

/**
 * Seeds `settingsData`, which is what gates the rate-and-review prompt.
 *
 * Note `extensionInstalledTime` must be a NUMBER of milliseconds, not a date
 * string: `isValidDate` (`local.ts:12`) only accepts `typeof param ===
 * 'number'`, so a plausible-looking ISO string is treated as "never
 * installed", and App silently stamps a fresh install time and declines to
 * prompt. A spec seeded that way never opens the modal and reads as a missing
 * control rather than a bad fixture.
 */
export async function seedSettings(
  context: BrowserContext,
  settings: Record<string, unknown>
): Promise<void> {
  // KAN-259. The profile starts as a user who answered the cloud question
  // (fixtures/extension.ts); a seed that says nothing about it keeps that
  // answer, so no spec boots into the welcome by accident. A seed that sets
  // cloudConsent -- to '' for the question itself -- wins.
  await seedLocalStorage(context, 'settingsData', {
    cloudConsent: 'granted',
    ...settings,
  });
}

/**
 * KAN-259. Starts the profile as a user who answered the cloud question, so no
 * spec boots into the welcome (a modal that takes every pointer event behind
 * it) by accident. Only when `settingsData` is absent: a later `seedSettings`
 * writes its own (merged with 'granted' above), and an answer the popup saved
 * must survive a reopen -- init scripts re-run on every page.
 *
 * Every fixture that launches a context calls this. There are two
 * (`extension.ts`, `grantedExtension.ts`); a third that forgets it fails the
 * way the drag specs did on 2026-09-21 -- every drop landing where it started,
 * because the dialog had the pointer -- with nothing naming the cause.
 */
export async function seedCloudConsentIfSettingsAbsent(
  context: BrowserContext
): Promise<void> {
  await context.addInitScript(() => {
    try {
      if (window.localStorage.getItem('settingsData') === null) {
        window.localStorage.setItem(
          'settingsData',
          JSON.stringify({ cloudConsent: 'granted' })
        );
      }
    } catch {
      // Storage blocked; the specs' own assertions say so more clearly.
    }
  });
}

// addInitScript, not page.evaluate: the popup reads localStorage during its
// first render, so anything written after navigation is already too late. This
// must therefore be called BEFORE context.newPage().
async function seedLocalStorage(
  context: BrowserContext,
  key: string,
  value: unknown
): Promise<void> {
  await context.addInitScript(
    ([k, v]: [string, string]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        // A profile with storage blocked would throw here. The assertions that
        // follow fail with a clearer message than this could produce.
      }
    },
    [key, JSON.stringify(value)] as [string, string]
  );
}
