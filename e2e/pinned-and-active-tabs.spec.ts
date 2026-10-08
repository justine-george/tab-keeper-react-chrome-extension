import type { BrowserContext, Page, Worker } from '@playwright/test';

import { test, expect } from './fixtures/extension';
import { grantedTest } from './fixtures/grantedExtension';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { openPage, POPUP } from './fixtures/onboarding';
import {
  boxOf,
  groupedWindow,
  openSaved,
  savedWindow,
  session as savedSession,
  stored,
} from './fixtures/savedWindows';
import { groupHandle, pickUp, tabHandle } from './fixtures/sessionDrag';
import type {
  tabData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';

// KAN-458. The spec's "Through Save / Open / Switch" table for pinned tabs and the active tab, in the real browser.
const page = (name: string) => `data:text/html,<title>${name}</title>`;
const PLACEHOLDER = 'data:text/html;base64,';
// Measured 2026-10-07: windows.create and tabs.create reject it from an extension.
const REFUSED = 'chrome://kill';

type TabFact = {
  id: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  status: string;
};
type WindowFact = { id: number; tabs: TabFact[] };

const windowsNow = (worker: Worker): Promise<WindowFact[]> =>
  worker.evaluate(async () =>
    (
      await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
    ).map((w) => ({
      id: w.id ?? -1,
      tabs: (w.tabs ?? [])
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          id: t.id ?? -1,
          title: t.title ?? '',
          url: t.url || t.pendingUrl || '',
          pinned: t.pinned,
          active: t.active,
          status: t.status ?? '',
        })),
    }))
  );

// A tab as the user meets it: its page loaded, or a placeholder waiting for a click.
const shape = ({ title, url, pinned, active }: TabFact) => ({
  title,
  loaded: !url.startsWith(PLACEHOLDER),
  pinned,
  active,
});

// The new window holding a tab titled `title`, once every tab loaded and the strip reads the same twice.
async function settledWindowWith(
  worker: Worker,
  title: string,
  before: number[]
): Promise<TabFact[]> {
  const read = async () =>
    (await windowsNow(worker)).find(
      (w) => !before.includes(w.id) && w.tabs.some((t) => t.title === title)
    )?.tabs;
  await expect
    .poll(async () => (await read())?.every((t) => t.status === 'complete'))
    .toBe(true);
  const first = await read();
  await new Promise((done) => setTimeout(done, 1000));
  expect(await read()).toEqual(first);
  if (first === undefined) throw new Error(`no new window holds ${title}`);
  return first;
}

const savedTab = (name: string, pinned = false): tabData =>
  pinned
    ? { tabId: name, favicon: '', title: name, url: page(name), pinned: true }
    : { tabId: name, favicon: '', title: name, url: page(name) };

const oneWindow = (tabs: tabData[], activeTabId?: string) =>
  buildContainer([
    buildSession({
      tabGroupId: 's1',
      title: 'Trip',
      windowCount: 1,
      tabCount: tabs.length,
      windows: [
        {
          windowId: 'w1',
          windowHeight: 600,
          windowWidth: 800,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: tabs.length,
          title: '',
          tabs,
          ...(activeTabId === undefined ? {} : { activeTabId }),
        },
      ],
    }),
  ]);

async function seedOneWindow(
  context: BrowserContext,
  tabs: tabData[],
  activeTabId?: string
) {
  await seedSettings(context, {});
  await seedSessions(context, oneWindow(tabs, activeTabId));
}

const sessionsRow = (p: Page) => p.locator('[data-pane="sessions"]');
const focusDialog = (p: Page) =>
  p.locator('dialog[open][aria-labelledby="focus-confirm-title"]');

async function pressSwitch(popup: Page) {
  await sessionsRow(popup)
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
  await focusDialog(popup)
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
}

async function pressOpen(popup: Page) {
  await sessionsRow(popup)
    .getByRole('button', { name: 'Open', exact: true })
    .click();
}

const ids = async (worker: Worker) =>
  (await windowsNow(worker)).map((w) => w.id);

test('Save keeps two pinned tabs and the active third; Switch brings them back that way', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await seedSettings(context, {});
  const popup = await openPage(context, extensionId, 'index.html', POPUP);
  await serviceWorker.evaluate(async (urls) => {
    const win = await chrome.windows.create({ url: urls, focused: false });
    const tabIds = (win?.tabs ?? [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .flatMap((t) => (t.id === undefined ? [] : [t.id]));
    await chrome.tabs.update(tabIds[0], { pinned: true });
    await chrome.tabs.update(tabIds[1], { pinned: true });
    await chrome.tabs.update(tabIds[2], { active: true });
  }, ['PinnedOne', 'PinnedTwo', 'ActiveThree', 'LastFour'].map(page));
  // PREMISE: Chrome shows the window that way.
  await expect
    .poll(
      async () =>
        (await windowsNow(serviceWorker))
          .find((w) => w.tabs.some((t) => t.title === 'LastFour'))
          ?.tabs.map(({ title, pinned, active }) => ({ title, pinned, active }))
    )
    .toEqual([
      { title: 'PinnedOne', pinned: true, active: false },
      { title: 'PinnedTwo', pinned: true, active: false },
      { title: 'ActiveThree', pinned: false, active: true },
      { title: 'LastFour', pinned: false, active: false },
    ]);

  await popup
    .locator('[data-tour-anchor="save"]')
    .getByRole('button', {
      name: 'Save all open windows as a session',
      exact: true,
    })
    .click();

  // Save: both fields stored.
  await expect.poll(async () => (await stored(popup)).tabGroups.length).toBe(1);
  const saved = (await stored(popup)).tabGroups[0].windows.find((w) =>
    w.tabs.some((t) => t.title === 'LastFour')
  );
  expect(saved?.tabs.map((t) => [t.title, t.pinned === true])).toEqual([
    ['PinnedOne', true],
    ['PinnedTwo', true],
    ['ActiveThree', false],
    ['LastFour', false],
  ]);
  expect(saved?.activeTabId).toBe(saved?.tabs[2].tabId);

  // A5: the pin mark and the "Pinned" description, on pinned rows only.
  const pinnedRow = popup.getByRole('button', {
    name: 'Open in new tab: PinnedOne',
    exact: true,
  });
  await expect(pinnedRow.locator('[data-pin]')).toBeVisible();
  await expect(pinnedRow).toHaveAccessibleDescription('Pinned');
  const activeRow = popup.getByRole('button', {
    name: 'Open in new tab: ActiveThree',
    exact: true,
  });
  await expect(activeRow.locator('[data-pin]')).toHaveCount(0);
  await expect(activeRow).not.toHaveAttribute('aria-describedby');

  // Switch: pinned tabs first, the active tab loaded and active, the rest lazy.
  const before = await ids(serviceWorker);
  await pressSwitch(popup);
  const tabs = await settledWindowWith(serviceWorker, 'LastFour', before);
  expect(tabs.map(shape)).toEqual([
    { title: 'PinnedOne', loaded: false, pinned: true, active: false },
    { title: 'PinnedTwo', loaded: false, pinned: true, active: false },
    { title: 'ActiveThree', loaded: true, pinned: false, active: true },
    { title: 'LastFour', loaded: false, pinned: false, active: false },
  ]);
});

test.describe('Open', () => {
  test('an old-format session opens on its first tab, loaded; the rest lazy', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedOneWindow(context, [
      savedTab('First'),
      savedTab('Second'),
      savedTab('Third'),
    ]);
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    const before = await ids(serviceWorker);
    await pressOpen(popup);
    const tabs = await settledWindowWith(serviceWorker, 'Third', before);
    expect(tabs.map(shape)).toEqual([
      { title: 'First', loaded: true, pinned: false, active: true },
      { title: 'Second', loaded: false, pinned: false, active: false },
      { title: 'Third', loaded: false, pinned: false, active: false },
    ]);
  });

  test('pinned tabs and no saved active tab: opens on the first unpinned tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedOneWindow(context, [
      savedTab('Pinned', true),
      savedTab('Second'),
      savedTab('Third'),
    ]);
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    const before = await ids(serviceWorker);
    await pressOpen(popup);
    const tabs = await settledWindowWith(serviceWorker, 'Third', before);
    expect(tabs.map(shape)).toEqual([
      { title: 'Pinned', loaded: false, pinned: true, active: false },
      { title: 'Second', loaded: true, pinned: false, active: true },
      { title: 'Third', loaded: false, pinned: false, active: false },
    ]);
  });

  test('a saved active tab Chrome refuses: opens on the first unpinned tab', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedOneWindow(
      context,
      [
        savedTab('Pinned', true),
        savedTab('Second'),
        { tabId: 'r', favicon: '', title: 'Refused', url: REFUSED },
      ],
      'r'
    );
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    const before = await ids(serviceWorker);
    await pressOpen(popup);
    const tabs = await settledWindowWith(serviceWorker, 'Second', before);
    expect(tabs.map(shape)).toEqual([
      { title: 'Pinned', loaded: false, pinned: true, active: false },
      { title: 'Second', loaded: true, pinned: false, active: true },
      { title: 'Refused', loaded: false, pinned: false, active: false },
    ]);
  });
});

// Switch saves only unsaved work: a pin is content, the active tab is not.
test.describe('Open, then Switch to the same session', () => {
  async function openTrip(
    context: BrowserContext,
    extensionId: string,
    worker: Worker
  ) {
    await seedSettings(context, {});
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    // Seeded once, not by init script: that re-seeds every page, erasing a save made before it opened.
    await popup.evaluate(
      (data) => localStorage.setItem('tabContainerData', data),
      JSON.stringify(
        oneWindow(
          [savedTab('Pinned', true), savedTab('Second'), savedTab('Third')],
          'Third'
        )
      )
    );
    await popup.reload();
    await expect(
      sessionsRow(popup).getByRole('button', { name: 'Open', exact: true })
    ).toBeVisible();
    // Only the restored window may hold a page Switch would save.
    await Promise.all(
      context
        .pages()
        .filter((p) => !p.url().startsWith('chrome-extension://'))
        .map((p) => p.close())
    );
    const before = await ids(worker);
    await pressOpen(popup);
    const tabs = await settledWindowWith(worker, 'Third', before);
    // PREMISE: the restore re-pinned the pinned tab and opened on the saved active one.
    expect(tabs.map(shape)).toEqual([
      { title: 'Pinned', loaded: false, pinned: true, active: false },
      { title: 'Second', loaded: false, pinned: false, active: false },
      { title: 'Third', loaded: true, pinned: false, active: true },
    ]);
    // PREMISE: no other window holds a page outside Tab Keeper.
    const own = `chrome-extension://${extensionId}/`;
    expect(
      (await windowsNow(worker)).filter((w) =>
        w.tabs.some((t) => !t.url.startsWith(own))
      )
    ).toHaveLength(1);
    return { popup, tabs };
  }

  // Switch closes the popup's window; a fresh page reads the same storage.
  async function sessionsAfterSwitch(
    context: BrowserContext,
    extensionId: string,
    worker: Worker,
    popup: Page
  ) {
    const before = await ids(worker);
    await focusDialog(popup)
      .getByRole('button', { name: 'Switch', exact: true })
      .click();
    await settledWindowWith(worker, 'Third', before);
    await expect.poll(async () => (await ids(worker)).length).toBe(1);
    const reader = await openPage(context, extensionId, 'index.html', POPUP);
    return (await stored(reader)).tabGroups;
  }

  test('as restored: nothing new is saved', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { popup } = await openTrip(context, extensionId, serviceWorker);
    await sessionsRow(popup)
      .getByRole('button', { name: 'Switch', exact: true })
      .click();
    await expect(focusDialog(popup)).toContainText('already saved');
    const sessions = await sessionsAfterSwitch(
      context,
      extensionId,
      serviceWorker,
      popup
    );
    expect(sessions.map((s) => s.tabGroupId)).toEqual(['s1']);
  });

  test('another tab made active: still nothing new is saved', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { popup, tabs } = await openTrip(context, extensionId, serviceWorker);
    await serviceWorker.evaluate(
      (id) => chrome.tabs.update(id, { active: true }),
      tabs[1].id
    );
    await expect
      .poll(async () =>
        (await windowsNow(serviceWorker))
          .flatMap((w) => w.tabs)
          .find((t) => t.id === tabs[1].id)
      )
      .toMatchObject({ active: true, status: 'complete' });
    await sessionsRow(popup)
      .getByRole('button', { name: 'Switch', exact: true })
      .click();
    await expect(focusDialog(popup)).toContainText('already saved');
    const sessions = await sessionsAfterSwitch(
      context,
      extensionId,
      serviceWorker,
      popup
    );
    expect(sessions.map((s) => s.tabGroupId)).toEqual(['s1']);
  });

  test('CONTROL, a tab pinned since: the window is saved as a new session, the pin kept', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const { popup, tabs } = await openTrip(context, extensionId, serviceWorker);
    await serviceWorker.evaluate(
      (id) => chrome.tabs.update(id, { pinned: true }),
      tabs[1].id
    );
    await expect
      .poll(
        async () =>
          (await windowsNow(serviceWorker))
            .flatMap((w) => w.tabs)
            .find((t) => t.id === tabs[1].id)?.pinned
      )
      .toBe(true);
    await sessionsRow(popup)
      .getByRole('button', { name: 'Switch', exact: true })
      .click();
    await expect(focusDialog(popup)).toContainText('will be saved');
    const sessions = await sessionsAfterSwitch(
      context,
      extensionId,
      serviceWorker,
      popup
    );
    expect(sessions).toHaveLength(2);
    const copy = sessions.find((s) => s.tabGroupId !== 's1');
    expect(
      copy?.windows[0].tabs.map((t) => [t.title, t.pinned === true])
    ).toEqual([
      ['Pinned', true],
      ['Second', true],
      ['Third', false],
    ]);
  });
});

// KNOWN DEFECT (A4): Chrome stamps a never-activated tab's lastAccessed at creation, so the last placeholder outranks the target.
test.fail(
  'Open, then the pinned full view made active: Save keeps the tab the window opened on',
  async ({ context, extensionId, serviceWorker }) => {
    await seedSettings(context, { pinTabKeeperInNewWindows: true });
    const popup = await openPage(context, extensionId, 'index.html', POPUP);
    // Seeded once, not by init script: that re-seeds every page, erasing the save.
    await popup.evaluate(
      (data) => localStorage.setItem('tabContainerData', data),
      JSON.stringify(
        oneWindow(
          [
            savedTab('First'),
            savedTab('Target'),
            savedTab('Third'),
            savedTab('Last'),
          ],
          'Target'
        )
      )
    );
    await popup.reload();
    await Promise.all(
      context
        .pages()
        .filter((p) => !p.url().startsWith('chrome-extension://'))
        .map((p) => p.close())
    );
    const before = await ids(serviceWorker);
    await pressOpen(popup);
    const tabs = await settledWindowWith(serviceWorker, 'Last', before);
    // PREMISE: the stub first, then the window open on Target with placeholders made after it.
    expect(tabs[0].url).toMatch(
      new RegExp(`^chrome-extension://${extensionId}/`)
    );
    expect(tabs[0]).toMatchObject({ pinned: true, active: false });
    expect(tabs.slice(1).map(shape)).toEqual([
      { title: 'First', loaded: false, pinned: false, active: false },
      { title: 'Target', loaded: true, pinned: false, active: true },
      { title: 'Third', loaded: false, pinned: false, active: false },
      { title: 'Last', loaded: false, pinned: false, active: false },
    ]);

    await serviceWorker.evaluate(
      (id) => chrome.tabs.update(id, { active: true }),
      tabs[0].id
    );
    await expect
      .poll(async () =>
        (await windowsNow(serviceWorker))
          .flatMap((w) => w.tabs)
          .find((t) => t.id === tabs[0].id)
      )
      .toMatchObject({ active: true });
    await popup
      .locator('[data-tour-anchor="save"]')
      .getByRole('button', {
        name: 'Save all open windows as a session',
        exact: true,
      })
      .click();

    await expect
      .poll(async () => (await stored(popup)).tabGroups.length)
      .toBe(2);
    const saved = (await stored(popup)).tabGroups
      .find((s) => s.tabGroupId !== 's1')
      ?.windows.find((w) => w.tabs.some((t) => t.title === 'Last'));
    expect(saved?.tabs.find((t) => t.tabId === saved.activeTabId)?.title).toBe(
      'Target'
    );
  }
);

// Where the preview shows the held row among a window's rows, read off their shifts (group-drag.spec.ts's reading).
const previewIndex = (p: Page, windowId: string, rowSelector: string) =>
  p.evaluate(
    ({ windowId, rowSelector }) => {
      const block = document.querySelector(
        `[data-pane="detail"] [data-drag-row-id="${windowId}"]`
      );
      const rows = [
        ...(block?.querySelectorAll<HTMLElement>(rowSelector) ?? []),
      ];
      const from = rows.findIndex((r) => r.hasAttribute('data-drag-held'));
      const shift = (r: HTMLElement) =>
        Number(/translateY\((-?[\d.]+)px\)/.exec(r.style.transform)?.[1] ?? 0);
      const up = rows.filter((r, i) => i !== from && shift(r) < 0).length;
      const down = rows.filter((r, i) => i !== from && shift(r) > 0).length;
      return from + up - down;
    },
    { windowId, rowSelector }
  );
const TAB_ROWS = '[data-drag-row-id^="w1-t"]';
const ITEM_ROWS = '[data-drag-row-id^="tab:"], [data-drag-row-id^="group:"]';

const pin = (t: tabData): tabData => ({ ...t, pinned: true });
const w1Tabs = async (p: Page) =>
  (await stored(p)).tabGroups[0].windows[0].tabs.map((t) => [
    t.tabId,
    t.pinned === true,
  ]);
// w1: two pinned tabs, then two unpinned ones.
const pinnedFirstTwo = (): windowGroupData => {
  const w = savedWindow('w1', '', 4);
  return { ...w, tabs: w.tabs.map((t, i) => (i < 2 ? pin(t) : t)) };
};
const markOn = (p: Page, title: string) =>
  p
    .getByRole('button', { name: `Open in new tab: ${title}`, exact: true })
    .locator('[data-pin]');

test.describe('Dragging a saved tab: where it lands decides its pin', () => {
  test('an unpinned tab dragged above the pinned tabs lands where the preview showed, pinned', async ({
    context,
    extensionId,
  }) => {
    const p = await openSaved(context, extensionId, 'popup', {
      sessions: [savedSession('S1', 'Pins', [pinnedFirstTwo()])],
    });
    await pickUp(p, tabHandle(p, 'w1-t3'));
    const top = await boxOf(tabHandle(p, 'w1-t0'));
    await p.mouse.move(top.x + 60, top.y + 3, { steps: 8 });
    await expect.poll(() => previewIndex(p, 'w1', TAB_ROWS)).toBe(0);
    await p.mouse.up();
    await expect
      .poll(() => w1Tabs(p))
      .toEqual([
        ['w1-t3', true],
        ['w1-t0', true],
        ['w1-t1', true],
        ['w1-t2', false],
      ]);
    await expect(markOn(p, 'Page w1.3')).toBeVisible();
  });

  test('a pinned tab dragged below the unpinned tabs lands where the preview showed, unpinned', async ({
    context,
    extensionId,
  }) => {
    const p = await openSaved(context, extensionId, 'popup', {
      sessions: [savedSession('S1', 'Pins', [pinnedFirstTwo()])],
    });
    await pickUp(p, tabHandle(p, 'w1-t0'));
    const last = await boxOf(tabHandle(p, 'w1-t3'));
    await p.mouse.move(last.x + 60, last.y + last.height - 3, { steps: 8 });
    await expect.poll(() => previewIndex(p, 'w1', TAB_ROWS)).toBe(3);
    await p.mouse.up();
    await expect
      .poll(() => w1Tabs(p))
      .toEqual([
        ['w1-t1', true],
        ['w1-t2', false],
        ['w1-t3', false],
        ['w1-t0', false],
      ]);
    await expect(markOn(p, 'Page w1.0')).toHaveCount(0);
  });
});

grantedTest(
  'a group held above the pinned tabs previews and lands right after them',
  async ({ context, extensionId }) => {
    const loose = savedWindow('w1', '', 2);
    const grouped = groupedWindow('w1', '', [
      { groupId: 'g1', title: 'Group', color: 'blue' },
    ]);
    const w: windowGroupData = {
      ...loose,
      tabs: [pin(loose.tabs[0]), loose.tabs[1], ...grouped.tabs],
      tabCount: 2 + grouped.tabs.length,
      chromeTabGroups: grouped.chromeTabGroups,
    };
    const p = await openSaved(context, extensionId, 'popup', {
      sessions: [savedSession('S1', 'Pins', [w])],
    });
    await pickUp(p, groupHandle(p, 'g1'));
    const top = await boxOf(tabHandle(p, 'w1-t0'));
    await p.mouse.move(top.x + 60, top.y + 3, { steps: 8 });
    // Items: [pinned w1-t0, w1-t1, g1]. The pointer names slot 0; the range puts it at 1.
    await expect.poll(() => previewIndex(p, 'w1', ITEM_ROWS)).toBe(1);
    await p.mouse.up();
    await expect
      .poll(async () => (await w1Tabs(p)).map(([id]) => id))
      .toEqual(['w1-t0', 'g1-t0', 'g1-t1', 'w1-t1']);
  }
);
