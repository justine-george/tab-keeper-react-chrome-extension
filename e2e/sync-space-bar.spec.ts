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
import { CHALK_THEME } from '../src/hooks/useThemeColors';
import { formatSyncUsed } from '../src/utils/functions/syncSpace';
import { rgb } from './fixtures/pixels';

// KAN-596. Under Sync Status, how much of the 1 MB the sync may write.
// Auto Sync off (manual): PR CI builds without a cloud, and manual is shown there.

async function openSync(
  context: BrowserContext,
  extensionId: string,
  container = buildContainer(),
  syncOff = false
): Promise<Page> {
  await seedSessions(context, container);
  await seedSettings(
    context,
    syncOff
      ? { isAutoSync: false, cloudConsent: 'declined' }
      : { isAutoSync: false }
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
  await expect(page.getByTestId('sync-status')).toHaveAttribute(
    'data-sync-state',
    syncOff ? 'off' : 'manual'
  );
  return page;
}

// One session whose single tab's address carries `pad` extra characters.
function padded(pad: number) {
  const base = buildSession({ tabGroupId: 'big' });
  const tab = base.windows[0].tabs[0];
  return buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [{ ...tab, url: `${tab.url}${'a'.repeat(pad)}` }],
        },
      ],
    },
  ]);
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
  const page = await openSync(context, extensionId, padded(900_000));
  await expect(bar(page)).toHaveAttribute('data-level', 'near');
  await expect(bar(page)).toContainText(
    'Sync stops at 1 MB: delete sessions you no longer need.'
  );
});

// KAN-633. With sync off the bar was hidden at any size, so the size was learned only from the
// refusal after the yes. From 80% it shows there too.
test('with sync off, past the limit, the bar says it is too large before any yes', async ({
  context,
  extensionId,
}) => {
  const page = await openSync(context, extensionId, padded(1_150_000), true);
  await expect(bar(page)).toHaveAttribute('data-level', 'full');
  await expect(bar(page)).toContainText(
    'Too large to sync: delete sessions you no longer need.'
  );
  const meter = page.getByRole('meter', { name: 'Sync limit used' });
  await expect(meter).toHaveAttribute('aria-valuenow', '100');
  // KAN-725. Chalk's DANGER_MARK, the default's.
  await expect(meter.locator(':scope > div')).toHaveCSS(
    'background-color',
    rgb(CHALK_THEME.DANGER_MARK)
  );
});

test('CONTROL: with sync off and room to spare, still no bar', async ({
  context,
  extensionId,
}) => {
  const page = await openSync(context, extensionId, buildContainer(), true);
  await expect(page.getByTestId('sync-status')).toContainText('Sync is off');
  await expect(bar(page)).toHaveCount(0);
});
