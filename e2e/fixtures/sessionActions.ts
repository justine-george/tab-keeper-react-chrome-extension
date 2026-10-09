import type { Locator, Page } from '@playwright/test';

// The saved session's Open/Switch row, and the save row's Save all (not Open now's of the same name).
export const sessionsRow = (page: Page): Locator =>
  page.locator('[data-pane="sessions"]');

export const focusConfirm = (page: Page): Locator =>
  page.locator('dialog[open][aria-labelledby="focus-confirm-title"]');

export const saveRowSaveAll = (page: Page): Locator =>
  page.locator('[data-tour-anchor="save"]').getByRole('button', {
    name: 'Save all open windows as a session',
    exact: true,
  });

export async function pressOpen(page: Page): Promise<void> {
  await sessionsRow(page)
    .getByRole('button', { name: 'Open', exact: true })
    .click();
}

// Switch, then the confirm dialog's own Switch.
export async function pressSwitch(page: Page): Promise<void> {
  await sessionsRow(page)
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
  await focusConfirm(page)
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
}
