import { test, expect } from './fixtures/extension';
import { generatePlaceholderURL } from '../src/utils/functions/local';

const TARGET = 'https://example.com/';

// The tests jsdom cannot express, and the reason this harness exists.
//
// KAN-36: restoring a session lazily opens every tab past the first as a
// placeholder document, and something has to swap that placeholder for the
// real page when the user finally activates it. The popup cannot -- restoring
// focuses the new window, Chrome destroys the popup, and any listener it
// registered dies with it. So the swap lives in the service worker, and only a
// real extension with a real worker can prove it works.
test.describe('service worker', () => {
  // Distinguishes "the listener was never registered" from "the listener ran
  // and did the wrong thing" -- different bugs with the same symptom.
  test('registers its tab and message listeners', async ({ serviceWorker }) => {
    const listeners = await serviceWorker.evaluate(() => ({
      onActivated: chrome.tabs.onActivated.hasListeners(),
      onMessage: chrome.runtime.onMessage.hasListeners(),
      manifestVersion: chrome.runtime.getManifest().manifest_version,
    }));

    expect(listeners).toEqual({
      onActivated: true,
      onMessage: true,
      manifestVersion: 3,
    });
  });

  test('swaps an activated lazy-load placeholder for its real page', async ({
    serviceWorker,
  }) => {
    // Built with the app's own generator rather than a hand-rolled data URL,
    // so the test cannot pass against a placeholder shape the app never emits.
    const placeholder = generatePlaceholderURL(
      'Example Domain',
      '',
      TARGET,
      'Go to URL'
    );

    const result = await serviceWorker.evaluate(
      async ({ url, target }) => {
        const tab = await chrome.tabs.create({ url, active: false });
        const tabId = tab.id;
        if (tabId === undefined) return 'NO TAB ID';

        // Load-bearing. Activating mid-load races the in-flight data:
        // navigation, which commits over the worker's rewrite -- and the
        // listener fires either way, so the failure is silent and looks
        // exactly like a broken listener. Measured 2026-09-01.
        const loadDeadline = Date.now() + 5000;
        while (Date.now() < loadDeadline) {
          const current = await chrome.tabs.get(tabId);
          if (current.status === 'complete' && current.url) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        await chrome.tabs.update(tabId, { active: true });

        // Polled, not slept: the rewrite happens asynchronously inside the
        // worker's onActivated handler.
        const swapDeadline = Date.now() + 8000;
        while (Date.now() < swapDeadline) {
          const current = await chrome.tabs.get(tabId);
          const seen = current.url ?? current.pendingUrl ?? '';
          if (seen.startsWith(target)) return seen;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return 'NOT SWAPPED';
      },
      { url: placeholder, target: TARGET }
    );

    expect(result).toBe(TARGET);
  });
});
