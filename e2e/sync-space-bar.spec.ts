import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { stored } from './fixtures/savedWindows';
import {
  estimateFirestoreBytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
} from '../src/utils/functions/local';
import { formatSyncUsed } from '../src/utils/functions/syncSpace';

// KAN-596. Under Sync Status, how much of the 1 MB the sync may write.
// Auto Sync off (manual): PR CI builds without a cloud, and manual is shown there.

async function openSync(
  context: BrowserContext,
  extensionId: string,
  container = buildContainer()
): Promise<Page> {
  await seedSessions(context, container);
  await seedSettings(context, { isAutoSync: false });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & Backup"]').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute(
    'data-sync-state',
    'manual'
  );
  return page;
}

const bar = (page: Page) => page.getByTestId('sync-space');

test('the bar reads what the sync would write, in the shipped build', async ({
  context,
  extensionId,
}) => {
  const page = await openSync(
    context,
    extensionId,
    buildContainer([
      buildSession({ tabGroupId: 'a', title: 'Reading list' }),
      buildSession({ tabGroupId: 'b', title: '東京旅行' }),
    ])
  );
  const bytes = estimateFirestoreBytes(await stored(page));
  await expect(bar(page)).toHaveText(
    `Your sessions use ${formatSyncUsed(bytes, 'en')} of the 1 MB sync limit.`
  );
  const meter = page.getByRole('meter', { name: 'Sync limit used' });
  await expect(meter).toHaveAttribute(
    'aria-valuenow',
    String(Math.round((bytes / FIRESTORE_MAX_DOCUMENT_BYTES) * 100))
  );
  await expect(bar(page)).toHaveAttribute('data-level', 'ok');
  // KAN-625. About 1 kB, a tenth of a percent: drawn, as at least a 3px sliver.
  expect(bytes / FIRESTORE_MAX_DOCUMENT_BYTES).toBeLessThan(0.005);
  const fill = await meter.locator(':scope > div').boundingBox();
  expect(fill?.width ?? 0).toBeGreaterThanOrEqual(3);
});

test('near the limit it turns red and says what to do', async ({
  context,
  extensionId,
}) => {
  const base = buildSession({ tabGroupId: 'big' });
  const tab = base.windows[0].tabs[0];
  const big = buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [{ ...tab, url: `${tab.url}${'a'.repeat(900_000)}` }],
        },
      ],
    },
  ]);
  const page = await openSync(context, extensionId, big);
  await expect(bar(page)).toHaveAttribute('data-level', 'near');
  await expect(bar(page)).toContainText(
    'Sync stops at 1 MB: delete sessions you no longer need.'
  );
});
