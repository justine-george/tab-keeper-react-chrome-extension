import { test, expect } from './fixtures/extension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { openFullView, openPopup } from './fixtures/onboarding';

// Every anchor the run's steps name is drawn once, in the view that names it.

const ANCHORS_EVERYWHERE = [
  '[data-pane="sessions"] [data-tour-anchor="save"]',
  '[data-pane="sessions"] [data-tour-anchor="sessions"]',
  '[data-pane="detail"] [data-tour-anchor="windows"]',
  '[data-pane="detail"] [data-tour-anchor="tab-dot"]',
  '[data-pane="sessions"] [data-tour-anchor="row-open"]',
  '[data-pane="sessions"] [data-tour-anchor="row-delete"]',
];

test.beforeEach(async ({ context }) => {
  await seedSessions(
    context,
    buildContainer([buildSession({ title: 'Kept', isSelected: true })])
  );
});

test('popup: the shared anchors, Switch and ⤢', async ({
  context,
  extensionId,
}) => {
  const page = await openPopup(context, extensionId);
  for (const selector of [
    ...ANCHORS_EVERYWHERE,
    '[data-tour-anchor="row-switch"]',
    '[data-tour-anchor="expand"]',
  ]) {
    await expect(page.locator(selector).first(), selector).toBeAttached();
  }
  await expect(page.locator('[data-tour-anchor="fold"]')).toHaveCount(0);
});

test('full view, unfolded: the shared anchors, «, and no Switch or ⤢', async ({
  context,
  extensionId,
}) => {
  const page = await openFullView(context, extensionId);
  await page
    .getByRole('button', { name: 'Show the saved session', exact: true })
    .click();
  for (const selector of [
    ...ANCHORS_EVERYWHERE,
    '[data-pane="open-now"] [data-tour-anchor="fold"]',
    '[data-pane="open-now"] [data-open-now-search]',
  ]) {
    await expect(page.locator(selector).first(), selector).toBeAttached();
  }
  await expect(page.locator('[data-tour-anchor="row-switch"]')).toHaveCount(0);
  await expect(page.locator('[data-tour-anchor="expand"]')).toHaveCount(0);
});
