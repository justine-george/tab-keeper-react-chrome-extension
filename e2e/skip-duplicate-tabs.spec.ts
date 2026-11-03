import type { BrowserContext, Page } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  CARD,
  S1,
  onto,
  session,
  sessionOf,
  sessionRow,
  tab,
  toasts,
  win,
} from './fixtures/betweenSessions';
import { dataUrl, liveRow, openLiveWindow } from './fixtures/liveWindows';
import { ON_TITLE } from './fixtures/savedRow';
import { boxOf, stored } from './fixtures/sessionDrag';
import { standIn } from './fixtures/standInPages';
import { buildContainer, seedSessions, seedSettings } from './fixtures/seed';
import type { TabMasterContainer } from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-906 on the real artifact: Settings › Sessions › Skip duplicate tabs. Off, every path adds and saves what it is
// given; On, a page a session already has is left out, and the toast says so. Replace is a whole new fill: unchanged.

const FULL = { width: 1280, height: 800 };
const SESSION = 'Porto weekend';

const savedTab = (id: string, url: string) => ({ ...tab(id), url });

// A saved session holding one tab per url.
const holding = (id: string, title: string, urls: string[]) =>
  session(id, title, [
    win(
      `${id}-w`,
      urls.map((url, i) => savedTab(`${id}-${i}`, url))
    ),
  ]);

const urlsOf = (c: TabMasterContainer, id: string) =>
  sessionOf(c, id).windows.flatMap((w) => w.tabs.map((t) => t.url));

// Only the pages a spec opened: the harness' own blank tabs are not its business.
const ours = (urls: string[]) => urls.filter((u) => u.includes('127.0.0.1'));

// This window gets one page per name, in this context's window (which the full view then shares).
async function openHere(context: BrowserContext, names: string[]) {
  for (const name of names) {
    const page = await context.newPage();
    await page.goto(standIn(name));
  }
}

async function openFullView(
  context: BrowserContext,
  extensionId: string,
  sessions: ReturnType<typeof holding>[],
  settings: Record<string, unknown>
): Promise<Page> {
  await seedSettings(context, {
    isNeverAskAgainForTabGroups: true,
    foldSavedSessionInTabView: false,
    ...settings,
  });
  await seedSessions(context, {
    ...buildContainer(sessions.map((s, i) => ({ ...s, isSelected: i === 0 }))),
    selectedTabGroupId: sessions[0]?.tabGroupId ?? '',
  });
  const page = await context.newPage();
  await page.setViewportSize(FULL);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  await page.locator('[data-tour-anchor="save"]').waitFor();
  return page;
}

const addWindow = (page: Page) =>
  page
    .locator('[data-pane="detail"]')
    .getByRole('button', { name: 'Add current window' });

async function saveByEnter(page: Page, name: string): Promise<void> {
  await page.locator('input#name').fill(name);
  await page.locator('input#name').press('Enter');
  await expect(
    page.getByRole('button', { name, exact: true }).first()
  ).toBeVisible();
}

test.describe('the setting', () => {
  test('Settings › Sessions shows Skip duplicate tabs Off by default; On survives a reload', async ({
    context,
    extensionId,
  }) => {
    const page = await openFullView(
      context,
      extensionId,
      [holding('s0', SESSION, [standIn('Here')])],
      {}
    );
    const open = async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      return page.getByRole('group', { name: 'Skip duplicate tabs' });
    };

    let pair = await open();
    await expect(pair.getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await pair.getByRole('button', { name: 'On' }).click();
    await expect(pair.getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await page.reload();
    await page.locator('[data-tour-anchor="save"]').waitFor();
    pair = await open();
    await expect(pair.getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(pair.getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});

test.describe('Add current window', () => {
  test('On: a session holding one of the window pages gets the rest, and the toast says one was left out', async ({
    context,
    extensionId,
  }) => {
    await openHere(context, ['Here', 'There']);
    const page = await openFullView(
      context,
      extensionId,
      [holding('s0', SESSION, [standIn('Here')])],
      { skipDuplicateTabs: true }
    );

    await addWindow(page).click();

    await expect
      .poll(async () => ours(urlsOf(await stored(page), 's0')))
      .toEqual([standIn('There'), standIn('Here')]);
    // Here stayed once: only There arrived.
    await expect
      .poll(() => toasts(page))
      .toEqual([
        expect.objectContaining({
          text: expect.stringContaining('1 duplicate tab left out.'),
        }),
      ]);
  });

  test('On: every page already there changes nothing and the toast says so', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await openHere(context, ['Here']);
    // The session holds every page the window has, whatever the harness left open besides Here.
    const everyPage = await serviceWorker.evaluate(async () =>
      (await chrome.tabs.query({}))
        .map((t) => t.url ?? '')
        .filter((u) => u !== '' && !u.startsWith('chrome-extension://'))
    );
    // PREMISE: Here is among them.
    expect(everyPage).toContain(standIn('Here'));
    const page = await openFullView(
      context,
      extensionId,
      [holding('s0', SESSION, everyPage)],
      { skipDuplicateTabs: true }
    );
    const before = await stored(page);

    await addWindow(page).click();

    await expect
      .poll(() => toasts(page))
      .toEqual([
        {
          text: 'Nothing to add: this session already has every tab in this window.',
          show: false,
        },
      ]);
    expect(await stored(page)).toEqual(before);
  });

  test('Off: the same Add adds every tab, the page the session has again included', async ({
    context,
    extensionId,
  }) => {
    await openHere(context, ['Here', 'There']);
    const page = await openFullView(
      context,
      extensionId,
      [holding('s0', SESSION, [standIn('Here')])],
      {}
    );

    await addWindow(page).click();

    await expect
      .poll(async () => ours(urlsOf(await stored(page), 's0')).sort())
      .toEqual([standIn('Here'), standIn('Here'), standIn('There')].sort());
    expect(await toasts(page)).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('left out') })
    );
  });
});

test.describe('a save', () => {
  test('On: a window with a page open twice saves one copy and says so', async ({
    context,
    extensionId,
  }) => {
    await openHere(context, ['Twice', 'Twice', 'Once']);
    const page = await openFullView(
      context,
      extensionId,
      [holding('s0', 'Already saved', ['https://x.test/'])],
      { skipDuplicateTabs: true }
    );

    await saveByEnter(page, 'Fresh');

    const fresh = (await stored(page)).tabGroups.find(
      (g) => g.title === 'Fresh'
    );
    expect(
      ours(fresh?.windows.flatMap((w) => w.tabs.map((t) => t.url)) ?? [])
    ).toEqual([standIn('Twice'), standIn('Once')]);
    await expect
      .poll(() => toasts(page))
      .toEqual([
        expect.objectContaining({
          text: expect.stringContaining('1 duplicate tab left out.'),
        }),
      ]);
  });

  test('Off: the same window saves both copies', async ({
    context,
    extensionId,
  }) => {
    await openHere(context, ['Twice', 'Twice', 'Once']);
    const page = await openFullView(
      context,
      extensionId,
      [holding('s0', 'Already saved', ['https://x.test/'])],
      {}
    );

    await saveByEnter(page, 'Fresh');

    const fresh = (await stored(page)).tabGroups.find(
      (g) => g.title === 'Fresh'
    );
    expect(
      ours(fresh?.windows.flatMap((w) => w.tabs.map((t) => t.url)) ?? [])
    ).toEqual([standIn('Twice'), standIn('Twice'), standIn('Once')]);
  });
});

test.describe('Replace', () => {
  test('On: replacing a session with the open windows keeps both copies of a page open twice', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const twin = standIn('Twin');
    await serviceWorker.evaluate(async (url) => {
      for (let i = 0; i < 2; i++)
        await chrome.windows.create({ url, focused: false });
    }, twin);
    const page = await openFullView(
      context,
      extensionId,
      [holding('s0', SESSION, ['https://old.test/'])],
      { skipDuplicateTabs: true }
    );
    await expect
      .poll(() =>
        serviceWorker.evaluate(
          async (url) => (await chrome.tabs.query({ url })).length,
          twin
        )
      )
      .toBe(2);

    await page
      .locator('[data-pane="sessions"] [data-drag-row-id="s0"]')
      .hover();
    await page
      .locator('[data-pane="sessions"] [data-drag-row-id="s0"]')
      .getByRole('button', { name: 'Replace', exact: true })
      .click();

    await expect
      .poll(async () => ours(urlsOf(await stored(page), 's0')))
      .toEqual([twin, twin]);
    await expect(
      page.getByText('Session replaced with all open windows.')
    ).toBeVisible();
    expect(await toasts(page)).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('left out') })
    );
  });
});

// ---- copies from Currently open (the tab view: session list, saved detail, Open now) ----

async function openTabView(
  context: BrowserContext,
  extensionId: string,
  target: ReturnType<typeof holding>,
  settings: Record<string, unknown>
): Promise<Page> {
  await seedSettings(context, {
    foldSavedSessionInTabView: false,
    ...settings,
  });
  await seedSessions(context, {
    ...buildContainer(
      [S1(), target].map((s) => ({ ...s, isSelected: s.tabGroupId === 'S1' }))
    ),
    selectedTabGroupId: 'S1',
  });
  const page = await context.newPage();
  await page.setViewportSize(FULL);
  await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
  const row = sessionRow(page, 'S1');
  await expect(row).toBeVisible();
  await row.click(ON_TITLE);
  await expect(page.locator('[data-drag-row-id="w1"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.paneMove))
    .toBeUndefined();
  return page;
}

// Presses a live row, moves past the activation distance, then out of Open now's pane: the copy card shows.
async function carryLiveTab(page: Page, tabId: number) {
  const row = liveRow(page, tabId);
  await expect(row).toBeVisible();
  const b = await boxOf(row);
  const x = b.x + Math.min(60, b.width / 2);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect(page.locator('[data-drag-held]')).toHaveCount(1);
  const pane = await boxOf(page.locator('[data-pane="open-now"]'));
  await page.mouse.move(pane.x - 40, y + 10, { steps: 6 });
  await expect(page.locator(CARD)).toHaveCount(1);
}

test.describe('a copy from Currently open', () => {
  test('On: a live tab the session has copies nothing, and the toast says the session already has it', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    const page = await openTabView(
      context,
      extensionId,
      holding('S2', 'Target', [dataUrl('Live A')]),
      { skipDuplicateTabs: true }
    );
    const before = await stored(page);

    await carryLiveTab(page, live.idOf('Live A'));
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: '“Target” already has this tab.', show: true }]);
    expect(urlsOf(await stored(page), 'S2')).toEqual(urlsOf(before, 'S2'));
    expect(await stored(page)).toEqual(before);
  });

  test('On, CONTROL: a live tab the session lacks is copied', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const live = await openLiveWindow(serviceWorker, ['Live B']);
    const page = await openTabView(
      context,
      extensionId,
      holding('S2', 'Target', [dataUrl('Live A')]),
      { skipDuplicateTabs: true }
    );

    await carryLiveTab(page, live.idOf('Live B'));
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(async () => urlsOf(await stored(page), 'S2'))
      .toContain(dataUrl('Live B'));
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'Copied to “Target”.', show: true }]);
  });

  test('Off: a live tab the session has is copied again', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const live = await openLiveWindow(serviceWorker, ['Live A']);
    const page = await openTabView(
      context,
      extensionId,
      holding('S2', 'Target', [dataUrl('Live A')]),
      {}
    );

    await carryLiveTab(page, live.idOf('Live A'));
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(async () => urlsOf(await stored(page), 'S2'))
      .toEqual([dataUrl('Live A'), dataUrl('Live A')]);
  });
});

// A live window's handle in Open now.
const liveWindowHandle = (page: Page, windowId: number) =>
  page.locator(
    `[data-open-window-id="${windowId}"] [data-open-window-drag-handle]`
  );

// The one toast on screen: its message, whether the message is cut, and its chips.
const toastFit = (page: Page) =>
  page.evaluate(() => {
    const toast = document.querySelector<HTMLElement>(
      '[role="status"] [data-toast]:not([aria-hidden="true"])'
    );
    const message = toast?.querySelector<HTMLElement>(':scope > span');
    if (!toast || !message) return null;
    return {
      text: message.textContent ?? '',
      cut:
        message.scrollWidth > message.clientWidth ||
        message.getBoundingClientRect().right >
          toast.getBoundingClientRect().right,
      chips: [...toast.querySelectorAll('button')].map(
        (b) => b.textContent?.trim() ?? ''
      ),
    };
  });

test.describe('the left-out count on a toast with Show', () => {
  // German runs long: the count sentence was cut off by an ellipsis here.
  test('On, in German: a live window copied onto a session off screen says, uncut, that one was left out', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const live = await openLiveWindow(serviceWorker, [
      'Live A',
      'Live B',
      'Live C',
    ]);
    const page = await openTabView(
      context,
      extensionId,
      holding('S2', SESSION, [dataUrl('Live A')]),
      { skipDuplicateTabs: true, language: 'de' }
    );
    // PREMISE: the UI is in German.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe('de');
    const handle = liveWindowHandle(page, live.windowId);
    await expect(handle).toBeVisible();

    const b = await boxOf(handle);
    const x = b.x + Math.min(40, b.width / 2);
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 10, { steps: 3 });
    await expect(page.locator(CARD)).toHaveCount(1);
    await onto(page, 'S2');
    await page.mouse.up();

    await expect
      .poll(async () => urlsOf(await stored(page), 'S2'))
      .toEqual([dataUrl('Live B'), dataUrl('Live C'), dataUrl('Live A')]);
    await expect
      .poll(() => toastFit(page))
      .toEqual({
        text: '2 Tabs nach „Porto weekend“ kopiert. 1 doppelter Tab ausgelassen.',
        cut: false,
        chips: ['Anzeigen'],
      });
  });
});
