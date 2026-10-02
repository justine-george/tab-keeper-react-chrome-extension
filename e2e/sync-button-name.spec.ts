import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { seedSessions, seedSettings } from './fixtures/seed';

// KAN-342, settled as S2. The header's sync button was named "Sync now" in
// every state: signed out, the accessibility tree read
// `button "Sync now" [disabled]`, with nothing saying why. Now a clickable
// button keeps "Sync now" and is DESCRIBED by its state, with the state as
// the tooltip's first line; a dimmed one is NAMED by its state.
//
// The three states a browser can reach deterministically, in a build with or
// without a cloud: describeSyncState settles unavailable, off and manual
// before it asks whether a cloud is configured. Syncing, failed and synced
// need a real sign-in, which Firebase's signUp rate limit refuses; the
// component tests drive those through the store (syncButtonName.test.tsx).

async function openHome(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  await seedSessions(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // Barrier: goto resolves before React mounts.
  await page.getByRole('button', { name: 'Sort sessions' }).waitFor();
  return page;
}

interface AxButton {
  name: string;
  description: string;
  disabled: boolean;
}

/**
 * What Chromium's own accessibility tree says about the button with this
 * name: what a screen reader is given, not a library's reading of the DOM.
 */
async function chromeAx(page: Page, name: string): Promise<AxButton[]> {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodes } = await cdp.send('Accessibility.queryAXTree', {
    nodeId: root.nodeId,
    accessibleName: name,
    role: 'button',
  });
  await cdp.detach();
  return nodes.map((n) => ({
    name: String(n.name?.value ?? ''),
    description: String(n.description?.value ?? ''),
    disabled:
      n.properties?.some((p) => p.name === 'disabled' && p.value.value) ??
      false,
  }));
}

const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

/** chrome.storage.sync holds a token no document id can be made from. */
async function seedUnusableToken(serviceWorker: Worker): Promise<void> {
  await serviceWorker.evaluate(() =>
    chrome.storage.sync.set({ tokenValue: 12345 })
  );
}

test.describe('the header sync button says what is true (KAN-342)', () => {
  test('unavailable: dimmed, and named for why', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedUnusableToken(serviceWorker);
    const page = await openHome(context, extensionId);
    // PREMISE: the token has been read and refused. The store starts signed
    // out, so without this the button reads "Sync unavailable" at mount
    // whatever the token says, and a broken token path could still pass.
    await expect(page.getByRole('status')).toContainText(
      'Sync unavailable: your saved account token could not be read.'
    );

    const sync = button(page, 'Sync unavailable');
    await expect(sync).toHaveAttribute('aria-disabled', 'true');
    await expect(sync).toHaveAttribute('title', 'Sync unavailable');
    await expect(sync).not.toHaveAttribute('aria-description');
    // With no aria-description, Chrome takes the tooltip as the description,
    // so it repeats the name, as it does for every header icon (KAN-345).
    expect(await chromeAx(page, 'Sync unavailable')).toEqual([
      {
        name: 'Sync unavailable',
        description: 'Sync unavailable',
        disabled: true,
      },
    ]);
    // The defect as it read on main: a dimmed "Sync now".
    const tree = await page.locator('body').ariaSnapshot();
    expect(tree).not.toContain('button "Sync now" [disabled]');
    expect(tree).toContain('button "Sync unavailable" [disabled]');
  });

  test('off: "Sync now", described as off', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { cloudConsent: 'declined' });
    const page = await openHome(context, extensionId);

    const sync = button(page, 'Sync now');
    await expect(sync).not.toHaveAttribute('aria-disabled');
    await expect(sync).toHaveAttribute('title', 'Sync is off\nSync now');
    await expect(sync).toHaveAttribute('aria-description', 'Sync is off');
    expect(await chromeAx(page, 'Sync now')).toEqual([
      { name: 'Sync now', description: 'Sync is off', disabled: false },
    ]);
  });

  test('manual: "Sync now", described as manual', async ({
    context,
    extensionId,
  }) => {
    await seedSettings(context, { isAutoSync: false });
    const page = await openHome(context, extensionId);

    const sync = button(page, 'Sync now');
    await expect(sync).not.toHaveAttribute('aria-disabled');
    await expect(sync).toHaveAttribute('title', 'Manual sync\nSync now');
    await expect(sync).toHaveAttribute('aria-description', 'Manual sync');
    expect(await chromeAx(page, 'Sync now')).toEqual([
      { name: 'Sync now', description: 'Manual sync', disabled: false },
    ]);
  });
});
