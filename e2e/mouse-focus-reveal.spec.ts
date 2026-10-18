import type { Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { buildContainer, buildSession, seedSessions } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';

// KAN-636, KAN-94's rule for every other row: actions revealed for keyboard
// focus only. :focus-within also matched the focus a click leaves, so a ⋮
// closed by clicking it kept its row filled after the pointer left. Each test
// leaves mouse focus in the block (premise: focused, not :focus-visible), then
// Tabs back onto it as the keyboard control. Only navigation keys reveal
// (KAN-689): a bare Shift made Chrome's focus visible, and no longer counts.

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test/`,
  ...(g ? { chromeGroupId: g } : {}),
});

async function openSaved(
  context: Parameters<typeof seedSessions>[0],
  extensionId: string
): Promise<Page> {
  const session = buildSession({
    tabGroupId: 's1',
    title: 'Reveal',
    isSelected: true,
    windowCount: 1,
    tabCount: 3,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 3,
        title: 'w1',
        tabs: [tab('a0'), tab('g0', 'alpha'), tab('g1', 'alpha')],
        chromeTabGroups: [{ groupId: 'alpha', title: 'Alpha', color: 'blue' }],
      },
    ],
  });
  await seedSessions(context, {
    ...buildContainer([session]),
    selectedTabGroupId: 's1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 790, height: 550 });
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.locator('[data-drag-row-id="group:alpha"]')).toBeAttached();
  return page;
}

// Background and child opacities of a block, as painted.
const look = (block: Locator) =>
  block.evaluate((el) => ({
    fill: getComputedStyle(el).backgroundColor,
    shown: [...el.children].map((c) => getComputedStyle(c).opacity),
  }));

// The focus a mouse leaves. After a click on a focusable row a programmatic
// focus is not :focus-visible (KAN-94); after a click on nothing it is.
async function leaveMouseFocus(
  page: Page,
  control: Locator,
  sessionRow: string,
  away: { x: number; y: number }
): Promise<void> {
  // Near the left edge: the shown row's actions cover its middle (KAN-582).
  await page
    .getByRole('button', { name: sessionRow, exact: true })
    .click({ position: { x: 20, y: 20 } });
  await control.focus();
  await page.mouse.move(away.x, away.y);
}

// Out and back by keyboard: the same control, now under keyboard navigation.
async function tabBackOnto(page: Page, control: Locator): Promise<void> {
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
}

const POPUP_AWAY = { x: 780, y: 540 };

// Opened and closed by clicks on the trigger itself, as reported.
async function openAndCloseByClick(page: Page, trigger: Locator) {
  await trigger.hover();
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.mouse.move(POPUP_AWAY.x, POPUP_AWAY.y);
}

async function expectFocusWithoutRing(control: Locator): Promise<void> {
  expect(
    await control.evaluate((el) => [
      el === document.activeElement,
      el.matches(':focus-visible'),
    ]),
    'PREMISE: focus is on the control, and not a visible focus'
  ).toEqual([true, false]);
}

test('a window row ⋮ closed by clicking it lets the row rest once the pointer leaves', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId);
  const block = page.locator(
    '[data-row-actions]:has([aria-label^="Open in new window"])'
  );
  const trigger = block.getByRole('button', { name: 'More actions' });

  // CONTROL: the hover this test expects to go away is really drawn.
  await trigger.hover();
  await expect.poll(() => look(block)).not.toMatchObject({ fill: TRANSPARENT });
  await openAndCloseByClick(page, trigger);
  await expectFocusWithoutRing(trigger);

  await expect
    .poll(() => look(block), { message: 'the row stayed engaged' })
    .toEqual({ fill: TRANSPARENT, shown: ['0', '0', '0'] });

  await tabBackOnto(page, trigger);
  await expect
    .poll(() => look(block))
    .toMatchObject({ shown: ['1', '1', '1'] });
});

test('a group row ⋮ closed by clicking it lets the row rest; keyboard focus reveals it', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId);
  const row = page.locator(
    '[data-drag-row-id="group:alpha"] [data-group-drag-handle]'
  );
  const actions = row.locator('.group-actions');
  const trigger = actions.getByRole('button', { name: 'More actions' });

  await openAndCloseByClick(page, trigger);
  await expectFocusWithoutRing(trigger);
  await expect.poll(() => look(row)).toMatchObject({ fill: TRANSPARENT });
  await expect
    .poll(() => look(actions))
    .toMatchObject({ shown: ['0', '0', '0'] });

  await tabBackOnto(page, trigger);
  await expect.poll(() => look(row)).not.toMatchObject({ fill: TRANSPARENT });
  await expect
    .poll(() => look(actions))
    .toMatchObject({ shown: ['1', '1', '1'] });
});

test('a tab row holding mouse focus rests; keyboard focus reveals it', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId);
  const block = page
    .locator('[data-row-actions]:has([aria-label="Delete tab"])')
    .first();
  const control = block.getByRole('button', { name: 'Delete tab' });

  await leaveMouseFocus(page, control, 'Reveal', POPUP_AWAY);
  await expectFocusWithoutRing(control);
  await expect.poll(() => look(block)).toMatchObject({ fill: TRANSPARENT });

  await tabBackOnto(page, control);
  await expect.poll(() => look(block)).not.toMatchObject({ fill: TRANSPARENT });
});

test('the session header rename holding mouse focus rests; keyboard focus reveals it', async ({
  context,
  extensionId,
}) => {
  const page = await openSaved(context, extensionId);
  const pencil = page.getByRole('button', {
    name: 'Rename session',
    exact: true,
  });
  const blockOpacity = () =>
    pencil.evaluate((el) => {
      // The absolutely placed block the pencil sits in.
      let node: Element | null = el;
      while (node && getComputedStyle(node).position !== 'absolute')
        node = node.parentElement;
      return node ? getComputedStyle(node).opacity : 'none';
    });

  await leaveMouseFocus(page, pencil, 'Reveal', POPUP_AWAY);
  await expectFocusWithoutRing(pencil);
  await expect.poll(blockOpacity).toBe('0');

  await tabBackOnto(page, pencil);
  await expect.poll(blockOpacity).toBe('1');
});

test('an Open now group row holding mouse focus rests; keyboard focus reveals it', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSessions(context);
  const windowId = await serviceWorker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const [first, second] = (win?.tabs ?? []).map((t) => t.id ?? -1);
    const groupId = await chrome.tabs.group({
      tabIds: [first, second],
      createProperties: { windowId: win?.id },
    });
    await chrome.tabGroups.update(groupId, { title: 'Kyoto', color: 'blue' });
    return win?.id ?? -1;
  }, ['Temples', 'Gardens'].map(standIn));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const row = page.locator(
    `[data-open-window-id="${windowId}"] [data-group-drag-handle]`
  );
  await expect(row).toBeVisible();
  const control = row.locator('[role="button"], button').first();

  await leaveMouseFocus(page, control, 'Research', { x: 1270, y: 790 });
  await expectFocusWithoutRing(control);
  await expect.poll(() => look(row)).toMatchObject({ fill: TRANSPARENT });

  await tabBackOnto(page, control);
  await expect.poll(() => look(row)).not.toMatchObject({ fill: TRANSPARENT });
});
