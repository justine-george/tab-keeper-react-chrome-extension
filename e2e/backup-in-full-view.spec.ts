import type { BrowserContext, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { FULL_VIEW_PATH, openFullView, openPopup } from './fixtures/onboarding';

// KAN-579. A native file picker takes the focus, and Chrome closes a popup that loses it: Cancel or Esc in the
// picker closed the popup. The popup now hands Save and Load to the full view, which opens on Sync & Backup and
// does the file step there. Headless cannot show the popup closing; where the download or chooser lands is the proof.

const HERE = buildContainer([
  buildSession({ tabGroupId: 'h1', title: 'Here one' }),
]);
const FROM_FILE = buildContainer([
  buildSession({ tabGroupId: 'f1', title: 'From the file' }),
]);

// Each page's file steps, by kind, recorded from the moment the page exists.
// `lateBy` attaches to new pages that much later, as a loaded run can.
function recordFileSteps(context: BrowserContext, { lateBy = 0 } = {}) {
  const steps: { page: Page; kind: 'download' | 'chooser'; name?: string }[] =
    [];
  const watch = (page: Page) => {
    page.on('download', (d) =>
      steps.push({ page, kind: 'download', name: d.suggestedFilename() })
    );
    page.on('filechooser', (chooser) => {
      steps.push({ page, kind: 'chooser' });
      void chooser.setFiles({
        name: 'backup.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(FROM_FILE)),
      });
    });
  };
  context.pages().forEach(watch);
  context.on('page', (page) =>
    lateBy ? setTimeout(() => watch(page), lateBy) : watch(page)
  );
  return steps;
}

async function popupOnSyncAndBackup(
  context: BrowserContext,
  extensionId: string
) {
  const popup = await openPopup(context, extensionId);
  await popup.locator('[aria-label="Settings"]').click();
  await popup.locator('button[aria-label="Sync & Backup"]').click();
  return popup;
}

const isFullView = (page: Page) => page.url().endsWith(FULL_VIEW_PATH);

// The full view the worker opened, on Settings: waitForFullView waits for home's Sort sessions, which Settings hides.
async function fullViewOnSyncAndBackup(context: BrowserContext): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = context.pages().find(isFullView);
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error('no full view page');
  await expect(
    found.getByRole('button', { name: 'Load sessions from a backup' })
  ).toBeVisible();
  return found;
}

test.describe('the popup hands the backup file step to the full view (KAN-579)', () => {
  test('Save: a full view opens on Sync & Backup and the backup downloads there, not in the popup', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, HERE);
    const steps = recordFileSteps(context);
    const popup = await popupOnSyncAndBackup(context, extensionId);

    await popup
      .getByRole('button', { name: 'Save sessions to a file' })
      .click();

    const full = await fullViewOnSyncAndBackup(context);
    await expect
      .poll(() => steps.map((s) => [isFullView(s.page), s.kind]))
      .toEqual([[true, 'download']]);
    expect(steps[0].name).toMatch(/^tabkeeper_backup_.*\.json$/);
    await expect(
      full.getByRole('button', { name: 'Save sessions to a file' })
    ).toBeVisible();
  });

  test('Load, no full view open: one opens on Sync & Backup, its chooser opens, and the file is asked about there', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, HERE);
    const steps = recordFileSteps(context);
    const popup = await popupOnSyncAndBackup(context, extensionId);

    await popup
      .getByRole('button', { name: 'Load sessions from a backup' })
      .click();

    const full = await fullViewOnSyncAndBackup(context);
    await expect
      .poll(() => steps.map((s) => [isFullView(s.page), s.kind]))
      .toEqual([[true, 'chooser']]);
    await expect(
      full.getByRole('dialog', { name: 'Load 1 session from this backup?' })
    ).toBeVisible();
  });

  test('Load, a full view already open: that one is focused, goes to Sync & Backup and opens the chooser', async ({
    context,
    extensionId,
  }) => {
    await seedSessions(context, HERE);
    const full = await openFullView(context, extensionId);
    const steps = recordFileSteps(context);
    const popup = await popupOnSyncAndBackup(context, extensionId);

    await popup
      .getByRole('button', { name: 'Load sessions from a backup' })
      .click();

    await expect
      .poll(() => steps.map((s) => [s.page === full, s.kind]))
      .toEqual([[true, 'chooser']]);
    await expect(
      full.getByRole('dialog', { name: 'Load 1 session from this backup?' })
    ).toBeVisible();
    await expect(
      full.getByRole('button', { name: 'Load sessions from a backup' })
    ).toBeVisible();
  });
});

// KAN-619. A new page reaches the test ~50ms before the full view starts its
// file step, and a step Playwright has no listener for is never reported.
test.describe('a recorder that attaches late still sees the file step (KAN-619)', () => {
  test('Save', async ({ context, extensionId }) => {
    await seedSessions(context, HERE);
    const steps = recordFileSteps(context, { lateBy: 1500 });
    const popup = await popupOnSyncAndBackup(context, extensionId);

    await popup
      .getByRole('button', { name: 'Save sessions to a file' })
      .click();

    await fullViewOnSyncAndBackup(context);
    await expect
      .poll(() => steps.map((s) => [isFullView(s.page), s.kind]))
      .toEqual([[true, 'download']]);
  });

  test('Load', async ({ context, extensionId }) => {
    await seedSessions(context, HERE);
    const steps = recordFileSteps(context, { lateBy: 1500 });
    const popup = await popupOnSyncAndBackup(context, extensionId);

    await popup
      .getByRole('button', { name: 'Load sessions from a backup' })
      .click();

    const full = await fullViewOnSyncAndBackup(context);
    await expect
      .poll(() => steps.map((s) => [isFullView(s.page), s.kind]))
      .toEqual([[true, 'chooser']]);
    await expect(
      full.getByRole('dialog', { name: 'Load 1 session from this backup?' })
    ).toBeVisible();
  });
});
