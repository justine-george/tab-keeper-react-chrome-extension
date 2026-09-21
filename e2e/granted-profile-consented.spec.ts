import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';

// KAN-259. The granted fixture launches its own context, so the consent that
// fixtures/extension.ts gives the profile has to be given here too. Without
// it, a profile with saved sessions is an existing user who has not answered
// the cloud question, and the popup opens the "currently synced" dialog: a
// modal that takes every pointer event behind it. The drag specs then all
// fail the same way -- the drop lands where it started -- which names the
// symptom, not the cause. This pins the cause.

test('a granted profile with saved sessions opens with no cloud question', async ({
  context,
  extensionId,
}) => {
  await seedSessions(
    context,
    buildContainer([
      buildSession({ tabGroupId: 's1', title: 'Saved', isSelected: true }),
    ])
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  // goto resolves before React mounts (KAN-105): wait for the popup itself.
  await expect(page.getByText('Saved').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
