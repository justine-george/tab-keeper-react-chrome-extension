import type { BrowserContext, Page, Worker } from '@playwright/test';

import { hasCloudConfig } from './fixtures/cloud';
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
    // PREMISE: the token has been read and refused. Until the read lands the
    // button reads "Sync now" (KAN-750 R19), so this waits for the refusal.
    await expect(page.getByRole('status')).toContainText(
      'Sync unavailable: your saved account token could not be read.'
    );

    const sync = button(page, 'Sync unavailable');
    await expect(sync).toHaveAttribute('aria-disabled', 'true');
    await expect(sync).toHaveAttribute('data-tooltip', 'Sync unavailable');
    // None: a tooltip that repeats the name is no description (KAN-345).
    await expect(sync).not.toHaveAttribute('aria-description');
    expect(await chromeAx(page, 'Sync unavailable')).toEqual([
      {
        name: 'Sync unavailable',
        description: '',
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
    await expect(sync).toHaveAttribute(
      'data-tooltip',
      'Sync is off · Sync now'
    );
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
    await expect(sync).toHaveAttribute(
      'data-tooltip',
      'Manual sync · Sync now'
    );
    await expect(sync).toHaveAttribute('aria-description', 'Manual sync');
    expect(await chromeAx(page, 'Sync now')).toEqual([
      { name: 'Sync now', description: 'Manual sync', disabled: false },
    ]);
  });

  // KAN-750. isCloudConfigured was written after the first paint, so a cloud
  // build's button was described as "Sync unavailable" for its first frame.
  test('in a cloud build, no frame describes it as unavailable', async ({
    context,
    extensionId,
  }) => {
    test.skip(!hasCloudConfig(), 'this build has no cloud config (CI)');
    // Every description the button is drawn with, from its first commit on:
    // the observer runs before paint, and an old value catches one replaced.
    await context.addInitScript(() => {
      if (window !== window.top) return;
      const seen: string[] = [];
      Object.assign(window, { syncDescriptions: seen });
      const note = (value: string | null) => {
        if (value !== null && seen[seen.length - 1] !== value) seen.push(value);
      };
      new MutationObserver((records) => {
        const sync = document
          .querySelector('[data-glyph]')
          ?.closest('[role="button"]');
        if (!sync) return;
        for (const r of records)
          if (r.target === sync && r.attributeName === 'aria-description')
            note(r.oldValue);
        note(sync.getAttribute('aria-description'));
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-description'],
        attributeOldValue: true,
      });
    });
    const page = await openHome(context, extensionId);
    const sync = button(page, 'Sync now');
    // PREMISE: granted with Auto Sync on, the one state the config decides.
    await expect(sync).toHaveAttribute('aria-description', /.+/);
    const seen = await page.evaluate(() => {
      const value: unknown = Reflect.get(window, 'syncDescriptions');
      return Array.isArray(value) ? value.map(String) : [];
    });
    expect(seen.length, 'the observer saw the button').toBeGreaterThan(0);
    expect(seen).not.toContain('Sync unavailable');
  });
});
