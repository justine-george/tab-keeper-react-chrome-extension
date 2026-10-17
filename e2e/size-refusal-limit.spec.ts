import { test, expect } from './fixtures/extension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { FULL_VIEW_PATH } from './fixtures/onboarding';
import {
  bytesToMB,
  estimateFirestoreBytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
} from '../src/utils/functions/local';

// KAN-634. The refusal toast said "1.1 MB of a 1.0 MB limit" while the Sync
// Status bar under it said "of the 1 MB sync limit". The import refusal is the
// one a CI build can raise (the sync one needs a cloud), and it is worded from
// the same limit. Sync off, so the bar shows past the limit (KAN-633) and no
// cloud write is attempted. In the full view: the popup hands its file step there (KAN-579).

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

test('the import refusal names the limit as the bar beside it does', async ({
  context,
  extensionId,
}) => {
  const tooLarge = padded(1_150_000);
  const used = estimateFirestoreBytes(tooLarge);
  // The premise: over the limit, so both the bar and the guard refuse it.
  expect(used).toBeGreaterThan(FIRESTORE_MAX_DOCUMENT_BYTES);

  await seedSessions(context, tooLarge);
  await seedSettings(context, { isAutoSync: false, cloudConsent: 'declined' });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/${FULL_VIEW_PATH}`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();

  const bar = page.getByTestId('sync-space');
  await expect(bar).toHaveAttribute('data-level', 'full');
  await expect(bar).toContainText('of the 1 MB sync limit.');

  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Load sessions from a backup' })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'too-large.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tooLarge)),
  });

  await expect(page.locator('[role="status"] [data-toast]')).toHaveText(
    `Error restoring tabs: too large to sync (${bytesToMB(used, 'en')} MB of a 1 MB limit). ` +
      'Remove some sessions from the backup and try again.'
  );
  // Both on screen at once: the moment the two used to disagree.
  await expect(bar).toContainText('of the 1 MB sync limit.');
});
