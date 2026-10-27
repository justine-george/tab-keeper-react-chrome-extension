import type { Locator, Page } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import {
  VIEWS,
  boxOf,
  openSaved,
  session,
  stored,
} from './fixtures/savedWindows';
import type { windowGroupData } from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-824 on the real artifact: Rename tab in a saved tab's right-click menu,
// and a saved tab's address on hover.

const PAGE = 'Alex Jo on X: "Sync is hard" / X';
const LONG = `https://example.test/${'very-long-path-segment/'.repeat(8)}end`;
const W1: windowGroupData = {
  windowId: 'w1',
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 3,
  title: 'Reading',
  tabs: [
    { tabId: 't1', favicon: '', title: PAGE, url: 'https://x.com/alexjo/1' },
    {
      tabId: 't2',
      favicon: '',
      title: 'Kagi Search',
      url: 'https://kagi.com/',
      customTitle: 'Search',
    },
    { tabId: 't3', favicon: '', title: 'Long one', url: LONG },
  ],
};
const SESSIONS = [session('S1', 'Trip', [W1])];

const row = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Open in new tab: ${name}`, exact: true });
const field = (page: Page, name: string): Locator =>
  page.getByRole('textbox', { name: `Rename tab: ${name}`, exact: true });
const tabRow = (page: Page, tabId: string): Locator =>
  page.locator(`[data-pane="detail"] [data-drag-row-id="${tabId}"]`);
const chip = (page: Page): Locator => page.locator('[data-tooltip-chip]');

async function startRename(page: Page, name: string): Promise<Locator> {
  await row(page, name).click({ button: 'right' });
  await page
    .locator('[role="menu"][data-row-menu]')
    .getByRole('menuitem', { name: 'Rename tab', exact: true })
    .click();
  const input = field(page, name);
  await expect(input).toBeFocused();
  return input;
}

const customTitleOf = async (page: Page, tabId: string) =>
  (await stored(page)).tabGroups[0].windows[0].tabs.find(
    (t) => t.tabId === tabId
  )?.customTitle;

// Off every control and past the warm window, so the next hover waits its full delay.
async function pointerAway(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(chip(page)).toHaveCount(0);
  await page.waitForTimeout(600);
}

for (const view of VIEWS) {
  test(`${view}: Rename tab, type, Enter: the row shows the name, and it survives a reload`, async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, view, {
      sessions: SESSIONS,
    });
    const input = await startRename(page, PAGE);
    await expect(input).toHaveValue(PAGE);
    // All of it selected, so typing replaces it.
    expect(
      await input.evaluate(
        (el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!
      )
    ).toBe(PAGE.length);

    await page.keyboard.type('Sync notes');
    await page.keyboard.press('Enter');

    await expect(row(page, 'Sync notes')).toBeFocused();
    await expect(row(page, PAGE)).toHaveCount(0);
    expect(await customTitleOf(page, 't1')).toBe('Sync notes');

    await page.reload();
    await expect(row(page, 'Sync notes')).toBeVisible();
  });
}

test('the tick sits inside the field, replaces Delete, and saves', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const input = await startRename(page, PAGE);
  const r = tabRow(page, 't1');
  await expect(r.getByRole('button', { name: 'Delete tab' })).toHaveCount(0);
  const tick = r.getByRole('button', { name: 'Save changes' });
  await expect(tick).toBeVisible();

  const f = await boxOf(input);
  const t = await boxOf(tick);
  expect(t.x).toBeGreaterThanOrEqual(f.x);
  expect(t.x + t.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
  expect(t.y).toBeGreaterThanOrEqual(f.y - 0.5);
  expect(t.y + t.height).toBeLessThanOrEqual(f.y + f.height + 0.5);

  await input.fill('Sync notes');
  await tick.click();
  await expect(row(page, 'Sync notes')).toBeVisible();
  expect(await customTitleOf(page, 't1')).toBe('Sync notes');
});

test('a click away saves', async ({ context, extensionId }) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const input = await startRename(page, PAGE);
  await input.fill('Sync notes');
  // Empty detail space below the last tab row.
  const pane = await boxOf(page.locator('[data-pane="detail"]'));
  const last = await boxOf(tabRow(page, 't3'));
  await page.mouse.click(
    last.x + 40,
    (last.y + last.height + pane.y + pane.height) / 2
  );

  await expect(row(page, 'Sync notes')).toBeVisible();
  expect(await customTitleOf(page, 't1')).toBe('Sync notes');
});

test("a right-click in the field keeps it open with Chrome's own menu", async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const input = await startRename(page, PAGE);
  await input.fill('Sync');
  await input.click({ button: 'right' });
  await expect(page.locator('[data-row-menu]')).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Sync');
  // CONTROL: the same press on another tab row opens the row's menu.
  await page.keyboard.press('Escape');
  await row(page, 'Search').click({ button: 'right' });
  await expect(page.locator('[data-row-menu]')).toHaveCount(1);
});

test('Esc keeps the old name', async ({ context, extensionId }) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const input = await startRename(page, 'Search');
  await input.fill('Other');
  await page.keyboard.press('Escape');

  await expect(row(page, 'Search')).toBeFocused();
  expect(await customTitleOf(page, 't2')).toBe('Search');
});

test('an empty field shows the page title, and Enter goes back to it', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  const input = await startRename(page, 'Search');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', 'Kagi Search');
  await page.keyboard.press('Enter');

  await expect(row(page, 'Kagi Search')).toBeVisible();
  expect(await customTitleOf(page, 't2')).toBeUndefined();
});

test('one undo takes a rename back', async ({ context, extensionId }) => {
  const page = await openSaved(context, extensionId, 'popup', {
    sessions: SESSIONS,
  });
  await startRename(page, PAGE);
  await page.keyboard.type('Sync notes');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Sync notes')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(row(page, PAGE)).toBeVisible();
  expect(await customTitleOf(page, 't1')).toBeUndefined();
});

test.describe('hover', () => {
  test('a saved tab shows its address', async ({ context, extensionId }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    await pointerAway(page);
    await row(page, PAGE).hover();
    await expect(chip(page)).toHaveText('https://x.com/alexjo/1');
  });

  test('a renamed tab shows its page title, then its address, on two lines', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    await pointerAway(page);
    await row(page, 'Search').hover();
    await expect(chip(page)).toBeVisible();
    // innerText is what is drawn: the break only survives if the chip renders it.
    expect(
      await chip(page).evaluate((el) => (el as HTMLElement).innerText)
    ).toBe('Kagi Search\nhttps://kagi.com/');
  });

  test('a long address wraps inside the chip', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'popup', {
      sessions: SESSIONS,
    });
    await pointerAway(page);
    await row(page, 'Long one').hover();
    await expect(chip(page)).toHaveText(LONG);
    const fits = await chip(page).evaluate(
      (el) => el.scrollWidth <= el.clientWidth
    );
    expect(fits).toBe(true);
  });
});
