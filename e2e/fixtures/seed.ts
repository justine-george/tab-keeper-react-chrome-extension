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
//
// addInitScript, not page.evaluate: the popup reads localStorage during its
// first render, so anything written after navigation is already too late. This
// must therefore be called BEFORE context.newPage().
export async function seedSessions(
  context: BrowserContext,
  container: TabMasterContainer = buildContainer()
): Promise<void> {
  await context.addInitScript(
    ([key, value]: [string, string]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A profile with storage blocked would throw here. The assertions that
        // follow fail with a clearer message than this could produce.
      }
    },
    ['tabContainerData', JSON.stringify(container)] as [string, string]
  );
}
