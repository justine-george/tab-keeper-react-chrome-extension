import type { BrowserContext, Locator, Page } from '@playwright/test';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { openLiveWindow } from './fixtures/liveWindows';
import { standIn } from './fixtures/standInPages';
import {
  POPUP_RUN,
  cardButton,
  landedAt,
  nextTo,
  openRunFromHelp,
} from './fixtures/run';

// KAN-825. A title cut off at its end ("…") or under what a row draws over it
// (the strip, the rename pencil) shows in full on hover and on focus; one you
// can read shows nothing. A cut-off tab title goes above its address.

const CHIP = '[data-tooltip-chip]';

const LONG_WINDOW = 'ThreadssdfThreadssdfThreadssdfThreadssdfThreadssdf';
// Fits its box at 790 wide; the strip covers its end on hover (KAN-825 round 1).
const MID_WINDOW = 'Reading for the weekend trip to Bergen';
const SHORT_WINDOW = 'Work';
const LONG_GROUP = 'Papers Threadssdf on local-first sync and conflict rules';
const MID_GROUP = 'Trail maps and hut bookings for Bergen';
const LONG_TAB =
  'Local-first software: you own your data, in spite of the cloud — Ink & Switch research essay';
const LONG_RENAME =
  'The essay everyone cites when they argue about sync engines';
const PAGE_TITLE = 'Ink & Switch';
// Selected, so its row keeps Open/Switch drawn over its end (KAN-582).
const MID_SESSION = 'Research for the sync rewrite';
// Not selected: its row draws no strip, so nothing covers it.
const OTHER_SESSION = 'Research for the sync rewrites';
// Fits the popup's header; its end (768) is under the pencil (748-780).
const HEADER_SESSION = 'Notes and research for the local-first sync rewrite';

const tab = (id: string, title: string, extra: object = {}) => ({
  tabId: id,
  favicon: '',
  title,
  url: `https://www.inkandswitch.com/${id}/local-first/`,
  ...extra,
});

const win = (
  id: string,
  title: string,
  tabs: ReturnType<typeof tab>[],
  groups?: object[]
) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title,
  tabs,
  ...(groups ? { chromeTabGroups: groups } : {}),
});

const WINDOWS = [
  win('w1', LONG_WINDOW, [
    tab('t1', LONG_TAB),
    tab('t2', 'Short page'),
    tab('t3', PAGE_TITLE, { customTitle: LONG_RENAME }),
    tab('t7', 'Pinned page', { pinned: true }),
  ]),
  win(
    'w2',
    MID_WINDOW,
    [
      tab('t4', 'Trail map', { chromeGroupId: 'g1' }),
      tab('t5', 'Hut booking', { chromeGroupId: 'g2' }),
    ],
    [
      { groupId: 'g1', title: LONG_GROUP, color: 'blue' },
      { groupId: 'g2', title: MID_GROUP, color: 'green' },
    ]
  ),
  win('w3', SHORT_WINDOW, [tab('t6', 'Inbox')]),
];

async function open(
  context: BrowserContext,
  extensionId: string,
  {
    title = MID_SESSION,
    view = 'popup',
  }: { title?: string; view?: 'popup' | 'tab' } = {}
): Promise<Page> {
  const selected = buildSession({
    tabGroupId: 's1',
    title,
    isSelected: true,
    windowCount: WINDOWS.length,
    tabCount: 7,
    windows: WINDOWS,
  });
  const other = buildSession({
    tabGroupId: 's2',
    title: OTHER_SESSION,
    windowCount: 1,
    tabCount: 1,
    windows: [win('w9', '', [tab('t9', 'List')])],
  });
  await seedSessions(context, {
    ...buildContainer([selected, other]),
    selectedTabGroupId: 's1',
  });
  await seedSettings(context, { foldSavedSessionInTabView: false });
  const page = await context.newPage();
  await page.setViewportSize(
    view === 'popup'
      ? { width: 790, height: 550 }
      : { width: 1280, height: 800 }
  );
  await page.goto(
    `chrome-extension://${extensionId}/index.html${view === 'popup' ? '' : '?view=tab'}`
  );
  await expect(page.locator('[data-drag-row-id="t1"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await away(page);
  return page;
}

// Off every control, past the warm window, so the next rest waits the first delay.
async function away(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.locator(CHIP)).toHaveCount(0);
  await page.waitForTimeout(600);
}

const textOf = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).first();

// Rests 30px into the text, as a reader would.
async function restOn(target: Locator) {
  const page = target.page();
  await away(page);
  const box = await target.boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
}

async function chipAfterRest(target: Locator): Promise<string> {
  await restOn(target);
  const chip = target.page().locator(CHIP);
  await expect(chip).toBeVisible();
  return (await chip.textContent()) ?? '';
}

async function noChipAfterRest(target: Locator) {
  await restOn(target);
  await target.page().waitForTimeout(900);
  await expect(target.page().locator(CHIP)).toHaveCount(0);
}

// Where the text ends against what is drawn over it, read where the pointer rests.
const coverOf = (target: Locator) =>
  target.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.min(text.right, box.right) - 2,
      box.top + box.height / 2
    );
    return {
      fits: el.scrollWidth <= el.clientWidth,
      underSomething: hit !== null && !el.contains(hit),
    };
  });

const addressOf = (page: Page, tabId: string) =>
  page
    .locator(`[data-drag-row-id="${tabId}"] [data-tooltip-lead]`)
    .getAttribute('data-tooltip');

test.describe('saved windows and groups', () => {
  test('a long saved window name shows in full', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await chipAfterRest(textOf(page, LONG_WINDOW))).toBe(LONG_WINDOW);
  });

  test('a window name under the strip shows in full', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const title = textOf(page, MID_WINDOW);
    expect(await chipAfterRest(title)).toBe(MID_WINDOW);
    // PREMISE: it fits its box, and the strip drawn on hover covers its end.
    expect(await coverOf(title)).toEqual({ fits: true, underSomething: true });
  });

  test('a window name under the strip shows in full at Large font size', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await page.addStyleTag({ content: 'html { font-size: 20px; }' });
    expect(await chipAfterRest(textOf(page, MID_WINDOW))).toBe(MID_WINDOW);
  });

  test('a window name that fits shows nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await noChipAfterRest(textOf(page, SHORT_WINDOW));
  });

  test('a long saved group name shows in full', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await chipAfterRest(textOf(page, LONG_GROUP))).toBe(LONG_GROUP);
  });
});

test('a long Currently open group name shows in full', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const live = await openLiveWindow(serviceWorker, [
    'Trail map',
    'Hut booking',
    'Weather',
  ]);
  await serviceWorker.evaluate(
    async ({ ids, title }) => {
      const group = await chrome.tabs.group({ tabIds: ids });
      await chrome.tabGroups.update(group, { title, color: 'green' });
    },
    {
      ids: [live.idOf('Trail map'), live.idOf('Hut booking')],
      title: LONG_GROUP,
    }
  );
  const page = await open(context, extensionId, { view: 'tab' });
  const title = page
    .locator('[data-pane="open-now"]')
    .getByText(LONG_GROUP, { exact: true })
    .first();
  await expect(title).toBeVisible();
  expect(await chipAfterRest(title)).toBe(LONG_GROUP);
});

test.describe('session titles', () => {
  test('a session row title under Open/Switch shows in full', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const title = page
      .locator('[data-pane="sessions"]')
      .getByText(MID_SESSION, { exact: true });
    expect(await chipAfterRest(title)).toBe(MID_SESSION);
    // PREMISE: it fits, and the row's Open/Switch cover its end.
    expect(await coverOf(title)).toEqual({ fits: true, underSomething: true });
  });

  test('a session row title that fits, on a row with no strip, shows nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const title = page
      .locator('[data-pane="sessions"]')
      .getByText(OTHER_SESSION, { exact: true });
    await noChipAfterRest(title);
    // PREMISE: the same length as the selected title, read in full.
    expect(await coverOf(title)).toEqual({
      fits: true,
      underSomething: false,
    });
  });

  test('the session title under the rename pencil shows in full', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId, { title: HEADER_SESSION });
    const title = page
      .locator('[data-pane="detail"] [data-tour-anchor="title"]')
      .getByText(HEADER_SESSION, { exact: true });
    expect(await chipAfterRest(title)).toBe(HEADER_SESSION);
    expect(await coverOf(title)).toEqual({ fits: true, underSomething: true });
  });
});

test.describe('tab rows', () => {
  test('a long tab title shows above its address', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const address = await addressOf(page, 't1');
    expect(address).toBe('https://www.inkandswitch.com/t1/local-first/');
    expect(await chipAfterRest(textOf(page, LONG_TAB))).toBe(
      `${LONG_TAB}\n${address}`
    );
  });

  test("a renamed tab's long name leads", async ({ context, extensionId }) => {
    const page = await open(context, extensionId);
    const tooltip = await addressOf(page, 't3');
    expect(tooltip).toBe(
      `${PAGE_TITLE}\nhttps://www.inkandswitch.com/t3/local-first/`
    );
    expect(await chipAfterRest(textOf(page, LONG_RENAME))).toBe(
      `${LONG_RENAME}\n${tooltip}`
    );
  });

  test('a tab whose title fits shows the address only', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await chipAfterRest(textOf(page, 'Short page'))).toBe(
      await addressOf(page, 't2')
    );
  });

  test('a pinned tab whose title fits shows the address only', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    expect(await chipAfterRest(textOf(page, 'Pinned page'))).toBe(
      await addressOf(page, 't7')
    );
  });
});

test.describe('keyboard', () => {
  // Shift+Tab off the title, then Tab back: a key's focus move, as a reader's.
  async function tabTo(button: Locator) {
    const page = button.page();
    await button.focus();
    await page.keyboard.press('Shift+Tab', { delay: 50 });
    await page.keyboard.press('Tab', { delay: 50 });
    await expect(button).toBeFocused();
  }
  const titleButton = (page: Page, name: string) =>
    page.getByRole('button', { name, exact: true });

  test('Tab to a cut-off window title shows it', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await tabTo(titleButton(page, `Rename window: ${LONG_WINDOW}`));
    await expect(page.locator(CHIP)).toHaveText(LONG_WINDOW);
  });

  test('Tab to a group title the just-revealed strip covers shows it', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    const button = titleButton(page, `Rename group: ${MID_GROUP}`);
    await tabTo(button);
    await expect(page.locator(CHIP)).toHaveText(MID_GROUP);
    // PREMISE: it fits; once shown, the strip covers its end.
    expect(await coverOf(textOf(page, MID_GROUP))).toEqual({
      fits: true,
      underSomething: true,
    });
  });

  test('Tab to a window title that fits shows nothing', async ({
    context,
    extensionId,
  }) => {
    const page = await open(context, extensionId);
    await tabTo(titleButton(page, `Rename window: ${SHORT_WINDOW}`));
    await page.waitForTimeout(900);
    await expect(page.locator(CHIP)).toHaveCount(0);
  });
});

test('during the tour a title that fits, under the dim, shows nothing', async ({
  context,
  extensionId,
}) => {
  await seedSessions(context);
  await seedSettings(context, {});
  await (await context.newPage()).goto(standIn('Inbox'));
  const page = await openRunFromHelp(context, extensionId, POPUP_RUN);
  await cardButton(page, 'Use an example').click();
  await nextTo(page, 3);
  await landedAt(page, 3);
  const button = page.getByRole('button', { name: /^Rename window: / }).first();
  const title = button.locator(':scope > *').first();
  // PREMISE: under the dim, and its text fits.
  const premise = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      dimmed:
        document
          .elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          ?.hasAttribute('data-coach-dim') ?? false,
    };
  });
  expect(premise.dimmed).toBe(true);
  expect((await coverOf(title)).fits).toBe(true);
  await button.focus();
  await page.keyboard.press('Shift+Tab', { delay: 50 });
  await page.keyboard.press('Tab', { delay: 50 });
  await expect(button).toBeFocused();
  await page.waitForTimeout(900);
  await expect(page.locator(CHIP)).toHaveCount(0);
});

test('the title controls keep their names, and say nothing more', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const live = await openLiveWindow(serviceWorker, ['Trail map', 'Weather']);
  await serviceWorker.evaluate(
    async ({ ids, title }) => {
      const group = await chrome.tabs.group({ tabIds: ids });
      await chrome.tabGroups.update(group, { title, color: 'green' });
    },
    { ids: [live.idOf('Trail map')], title: LONG_GROUP }
  );
  const page = await open(context, extensionId, { view: 'tab' });
  // As on main: the tooltip and its lead are seen, never said.
  const described: [string, string][] = [
    [`Rename window: ${LONG_WINDOW}`, ''],
    [`Rename session: ${MID_SESSION}`, ''],
    [`Open in new tab: ${LONG_TAB}`, ''],
    [`Open in new tab: ${LONG_RENAME}`, ''],
    // Its own aria-describedby (KAN-280), not the tooltip.
    ['Switch to tab: Trail map', 'Last used tab'],
  ];
  for (const [name, description] of described) {
    const control = page.getByRole('button', { name, exact: true }).first();
    await expect(control, name).toHaveAccessibleName(name);
    await expect(control, name).toHaveAccessibleDescription(description);
  }
  const groups = page.getByRole('button', {
    name: `Rename group: ${LONG_GROUP}`,
    exact: true,
  });
  await expect(groups).toHaveCount(2);
  for (const control of await groups.all()) {
    await expect(control).toHaveAccessibleDescription('');
  }
});
