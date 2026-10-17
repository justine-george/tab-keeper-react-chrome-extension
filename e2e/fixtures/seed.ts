import type { BrowserContext } from '@playwright/test';

import type { TabMasterContainer } from '../../src/redux/slices/tabContainerDataStateSlice';
import { buildContainer } from '../../src/tests/fixtures/sessionFixture';
import { RUN_FINISHED } from '../../src/tests/fixtures/firstRunFixture';

// Re-exported so specs have one import point for fixture data, while src/
// stays the single source of truth -- the factory is schema-checked against
// the app's own isValidTabMasterContainer in sessionFixture.test.ts.
export {
  buildSession,
  buildContainer,
} from '../../src/tests/fixtures/sessionFixture';
export { RUN_FINISHED } from '../../src/tests/fixtures/firstRunFixture';

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
 * KAN-7. Onboarding a seeded profile has already answered, so no spec boots
 * into the pin guide, the full-view callout or a run by accident (headless reports "not pinned"). A spec about
 * it passes its own value, which wins.
 */
export const ONBOARDING_ANSWERED = {
  isPinGuideDismissed: true,
  isFullViewCalloutSeen: true,
  isWhatsNew2Seen: true,
  firstRun: RUN_FINISHED,
  // KAN-578. A press that closes the full view acts at once.
  isClosesThisTabCardAnswered: true,
};

/**
 * KAN-653. The review card can come up on any page after a first save, a big
 * save or a restore, and sits over the bottom-right corner. A seeded profile
 * starts as a user who said never, the way it starts as one who answered the
 * cloud question; a spec about the card passes `false`, which wins.
 */
export const REVIEW_CARD_DECLINED = { isNeverAskAgainToRate: true };

/**
 * Seeds `settingsData`, which is what gates the review card.
 *
 * Note `extensionInstalledTime` must be a NUMBER of milliseconds, not a date
 * string: `isValidDate` (`local.ts:12`) only accepts `typeof param ===
 * 'number'`, so a plausible-looking ISO string is treated as "never
 * installed", and App silently stamps a fresh install time, so the day-after
 * ask never comes. A spec seeded that way never shows the card and reads as a
 * missing control rather than a bad fixture.
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
    ...ONBOARDING_ANSWERED,
    ...REVIEW_CARD_DECLINED,
    ...settings,
  });
}

// KAN-7. Writes settingsData only while none is stored, so a page's own save survives the next page.
export async function seedSettingsIfAbsent(
  context: BrowserContext,
  settings: Record<string, unknown>
): Promise<void> {
  await context.addInitScript(
    (value: string) => {
      try {
        if (window.localStorage.getItem('settingsData') === null) {
          window.localStorage.setItem('settingsData', value);
        }
      } catch {
        // Storage blocked; the specs' own assertions say so more clearly.
      }
    },
    JSON.stringify({
      cloudConsent: 'granted',
      ...ONBOARDING_ANSWERED,
      ...REVIEW_CARD_DECLINED,
      ...settings,
    })
  );
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
  await seedSettingsIfAbsent(context, {});
}

// How many seeds each context has registered: a seed's number orders it among them.
const seedCounts = new WeakMap<BrowserContext, number>();

// addInitScript, not page.evaluate: the popup reads localStorage during its
// first render, so anything written after navigation is already too late. This
// must therefore be called BEFORE context.newPage().
// KAN-474. An init script re-runs in every document, so each seed writes once, in the first document after it, and a later seed wins.
async function seedLocalStorage(
  context: BrowserContext,
  key: string,
  value: unknown
): Promise<void> {
  const seedNumber = (seedCounts.get(context) ?? 0) + 1;
  seedCounts.set(context, seedNumber);
  await context.addInitScript(
    ([k, v, n]: [string, string, number]) => {
      try {
        const applied = `e2e-seed:${k}`;
        if (Number(window.localStorage.getItem(applied) ?? 0) >= n) return;
        window.localStorage.setItem(k, v);
        window.localStorage.setItem(applied, String(n));
      } catch {
        // A profile with storage blocked would throw here. The assertions that
        // follow fail with a clearer message than this could produce.
      }
    },
    [key, JSON.stringify(value), seedNumber] as [string, string, number]
  );
}
