// KAN-910 on the real artifact: Settings › Sessions › Skip tabs already open.
// On, saved tabs opened or dropped into a window that is already open leave
// out pages it has; the open copy stays where and as it is. Off, every path
// opens everything, as before. Every check reads Chrome back.

import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

import { expect, grantedTest as test } from './fixtures/grantedExtension';
import {
  CARD,
  seed,
  session,
  sessionRow,
  toasts,
  win,
  tab,
} from './fixtures/betweenSessions';
import {
  carryTo,
  dataUrl,
  liveRow,
  openLiveWindow,
  topOf,
} from './fixtures/liveWindows';
import { ON_TITLE } from './fixtures/savedRow';
import {
  bandHandle,
  openSaved,
  session as savedSession,
} from './fixtures/savedWindows';
import {
  boxOf,
  groupHandle,
  pickUp,
  tabHandle,
  windowHandle,
} from './fixtures/sessionDrag';
import { seedSettings } from './fixtures/seed';
import { standIn } from './fixtures/standInPages';
import { resolveTabUrl } from '../src/utils/functions/local';
import type {
  tabContainerData,
  tabData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';

const ON = { skipTabsAlreadyOpen: true };
const THIS_WINDOW = { openSavedWindowsIn: 'this-window' };
const FULL = { width: 1280, height: 800 };
const SETTLE = { timeout: 15_000 };

interface LiveTab {
  id: number;
  // The page it shows: a placeholder counts as the page it waits for.
  page: string;
  active: boolean;
  group: string | null;
  groupId: number;
}

// A window's tabs in Chrome's order.
async function liveTabs(worker: Worker, windowId: number): Promise<LiveTab[]> {
  const raw = await worker.evaluate(async (id: number) => {
    const tabs = await chrome.tabs.query({ windowId: id });
    const groups = await chrome.tabGroups.query({ windowId: id });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => ({
        id: t.id ?? -1,
        url: t.pendingUrl || t.url || '',
        active: t.active,
        group: groups.find((g) => g.id === t.groupId)?.title ?? null,
        groupId: t.groupId,
      }));
  }, windowId);
  return raw.map(({ url, ...t }) => ({ ...t, page: resolveTabUrl(url) }));
}

const pagesIn = async (worker: Worker, windowId: number) =>
  (await liveTabs(worker, windowId)).map((t) => t.page);

const ownWindow = (page: Page) =>
  page.evaluate(async () => (await chrome.windows.getCurrent()).id ?? -1);

// One loaded stand-in page per name at the end of `windowId`, in the background; their ids.
async function openIn(
  worker: Worker,
  windowId: number,
  names: string[]
): Promise<number[]> {
  const ids = await worker.evaluate(
    async ({ windowId, urls }) => {
      const made: number[] = [];
      for (const url of urls) {
        const t = await chrome.tabs.create({ windowId, url, active: false });
        if (t.id !== undefined) made.push(t.id);
      }
      return made;
    },
    { windowId, urls: names.map(standIn) }
  );
  expect(ids).toHaveLength(names.length);
  await expect
    .poll(() =>
      worker.evaluate(
        async (ids: number[]) =>
          (await Promise.all(ids.map((id) => chrome.tabs.get(id)))).every(
            (t) => t.status === 'complete'
          ),
        ids
      )
    )
    .toBe(true);
  return ids;
}

// Groups `tabIds` in their own window as a live Chrome group titled `title`; its id.
const groupLive = (
  worker: Worker,
  windowId: number,
  tabIds: number[],
  title: string
) =>
  worker.evaluate(
    async ({ windowId, tabIds, title }) => {
      const [first, ...rest] = tabIds;
      if (first === undefined) throw new Error('nothing to group');
      const id = await chrome.tabs.group({
        tabIds: [first, ...rest],
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(id, { title, color: 'red' });
      return id;
    },
    { windowId, tabIds, title }
  );

const savedTab = (title: string, url: string, more: Partial<tabData> = {}) => ({
  tabId: title,
  favicon: '',
  title,
  url,
  ...more,
});

const savedWindowOf = (
  windowId: string,
  title: string,
  tabs: tabData[],
  more: Partial<windowGroupData> = {}
): windowGroupData => ({
  windowId,
  windowHeight: 600,
  windowWidth: 800,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title,
  tabs,
  ...more,
});

const noLeftOutToast = async (page: Page) =>
  expect(await toasts(page)).not.toContainEqual(
    expect.objectContaining({ text: expect.stringContaining('left out') })
  );

test.describe('the setting', () => {
  test('Settings shows Skip tabs already open, Off, right under Open saved windows, and keeps On', async ({
    context,
    extensionId,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [
        savedSession('S1', 'Trip', [
          savedWindowOf('w1', 'Reading', [savedTab('A', standIn('A'))]),
        ]),
      ],
    });
    const open = async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      return page.getByRole('group', { name: 'Skip tabs already open' });
    };

    let pair = await open();
    const order = await page
      .getByRole('group')
      .evaluateAll((pairs) => pairs.map((p) => p.getAttribute('aria-label')));
    expect(order.indexOf('Skip tabs already open')).toBe(
      order.indexOf('Open saved windows') + 1
    );
    expect(order.indexOf('Open saved windows')).toBeGreaterThanOrEqual(0);
    await expect(pair).toHaveAccessibleDescription(
      'Opening or dropping saved tabs into a window that’s already open leaves out pages it already has.'
    );
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

test.describe('Open in this window, On', () => {
  test('Open in this window opens only pages the window lacks', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [
        savedSession('S1', 'Trip', [
          savedWindowOf(
            'w1',
            'Reading',
            ['A', 'B', 'C', 'D'].map((t) => savedTab(t, standIn(t))),
            { activeTabId: 'C' }
          ),
        ]),
      ],
      settings: { ...THIS_WINDOW, ...ON },
    });
    const here = await ownWindow(page);
    await openIn(worker, here, ['A', 'B']);
    const before = await pagesIn(worker, here);

    await page
      .getByRole('button', {
        name: 'Open in this window: Reading',
        exact: true,
      })
      .click();

    await expect
      .poll(() => pagesIn(worker, here), SETTLE)
      .toEqual([...before, standIn('C'), standIn('D')]);
    await expect
      .poll(
        async () =>
          (await liveTabs(worker, here))
            .filter((t) => t.active)
            .map((t) => t.page),
        SETTLE
      )
      .toEqual([standIn('C')]);
    // Kept: nothing more comes later.
    await page.waitForTimeout(500);
    expect(await pagesIn(worker, here)).toEqual([
      ...before,
      standIn('C'),
      standIn('D'),
    ]);
    await noLeftOutToast(page);
  });

  test('all open: nothing opens, the open copy is current', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [
        savedSession('S1', 'Trip', [
          savedWindowOf(
            'w1',
            'Reading',
            ['A', 'B'].map((t) => savedTab(t, standIn(t))),
            { activeTabId: 'B' }
          ),
        ]),
      ],
      settings: { ...THIS_WINDOW, ...ON },
    });
    const here = await ownWindow(page);
    const [, b] = await openIn(worker, here, ['A', 'B']);
    const before = await liveTabs(worker, here);
    // PREMISE: B is open here and not current.
    expect(before.find((t) => t.id === b)?.active).toBe(false);

    await page
      .getByRole('button', {
        name: 'Open in this window: Reading',
        exact: true,
      })
      .click();

    await expect
      .poll(
        async () =>
          (await liveTabs(worker, here))
            .filter((t) => t.active)
            .map((t) => t.id),
        SETTLE
      )
      .toEqual([b]);
    await page.waitForTimeout(500);
    expect((await liveTabs(worker, here)).map((t) => t.id)).toEqual(
      before.map((t) => t.id)
    );
    await noLeftOutToast(page);
  });
});

// ---- drops into Currently open (the tab view, side by side) ----

// The tab view on S1, after the live windows, so Currently open lists them.
async function openTabView(
  context: BrowserContext,
  extensionId: string,
  saved: tabContainerData,
  settings: Record<string, unknown>
): Promise<Page> {
  await seed(context, [saved], 'S1');
  await seedSettings(context, {
    foldSavedSessionInTabView: false,
    ...settings,
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

const block = (page: Page, windowId: number) =>
  page.locator(`[data-pane="open-now"] [data-open-window-id="${windowId}"]`);

async function middleOf(el: Locator) {
  const b = await boxOf(el);
  return { x: b.x + Math.min(80, b.width / 2), y: b.y + b.height / 2 };
}

// From now on, for each arrival fill drawn: the live tab ids of the rows it covers.
async function watchFills(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fills: string[][] = [];
    document.body.dataset.fills = '[]';
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.matches('[data-arrival]'))
            continue;
          const f = node.getBoundingClientRect();
          const rows = [
            ...(node.parentElement?.querySelectorAll<HTMLElement>(
              '[data-open-tab-id]'
            ) ?? []),
          ];
          fills.push(
            rows
              .filter((row) => {
                const b = row.getBoundingClientRect();
                const mid = b.top + b.height / 2;
                return mid > f.top && mid < f.bottom;
              })
              .map((row) => row.dataset.openTabId ?? '')
          );
          document.body.dataset.fills = JSON.stringify(fills);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

// Every fill drawn since watchFills, as numbers, each sorted.
const fillsSeen = async (page: Page): Promise<number[][]> => {
  const raw = await page.evaluate(() => document.body.dataset.fills ?? '[]');
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (f): f is string[] =>
        Array.isArray(f) && f.every((id) => typeof id === 'string')
    )
  )
    throw new Error(`not a fill log: ${raw}`);
  return parsed.map((f) => f.map(Number).sort((a, b) => a - b));
};

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);

// S1 w1: A and B (pages the live window has), then s1 and s2 (pages it lacks).
const MIXED = () =>
  session('S1', 'Trip', [
    win('w1', [
      { ...tab('A'), url: dataUrl('A') },
      { ...tab('B'), url: dataUrl('B') },
      tab('s1'),
      tab('s2'),
    ]),
  ]);
// S1 w1: just A and B.
const ALL_OPEN = () =>
  session('S1', 'Trip', [
    win('w1', [
      { ...tab('A'), url: dataUrl('A') },
      { ...tab('B'), url: dataUrl('B') },
    ]),
  ]);

// A live window A, B, X, with B in a live Chrome group "Live".
async function liveTarget(worker: Worker) {
  const live = await openLiveWindow(worker, ['A', 'B', 'X']);
  await groupLive(worker, live.windowId, [live.idOf('B')], 'Live');
  return live;
}

async function dropWindowOn(page: Page, windowId: number, rowTabId: number) {
  await expect(liveRow(page, rowTabId)).toBeVisible();
  await pickUp(page, windowHandle(page, 'w1'));
  await carryTo(page, await middleOf(liveRow(page, rowTabId)));
  await expect(block(page, windowId)).toHaveAttribute('data-landing', '');
  await page.mouse.up();
}

test.describe('drops into an open window, On', () => {
  test('a saved window dropped on an open window: toast "2 duplicate tabs left out." and only new rows', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await liveTarget(worker);
    const page = await openTabView(context, extensionId, MIXED(), ON);
    await watchFills(page);

    await dropWindowOn(page, live.windowId, live.idOf('X'));

    await expect
      .poll(() => pagesIn(worker, live.windowId), SETTLE)
      .toEqual([
        dataUrl('A'),
        dataUrl('B'),
        dataUrl('X'),
        'https://s1.test/',
        'https://s2.test/',
      ]);
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: '2 duplicate tabs left out.', show: false }]);
    const tabs = await liveTabs(worker, live.windowId);
    // The open copy stays in its own live group.
    expect(tabs.find((t) => t.id === live.idOf('B'))?.group).toBe('Live');
    const added = tabs.slice(3).map((t) => t.id);
    await expect.poll(() => fillsSeen(page)).toEqual([sorted(added)]);
    await expect(page.locator(CARD)).toHaveCount(0);
  });

  test('all open drop: "This window already has these tabs." and the tab count unchanged', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await liveTarget(worker);
    const page = await openTabView(context, extensionId, ALL_OPEN(), ON);
    const before = await liveTabs(worker, live.windowId);
    await watchFills(page);

    await dropWindowOn(page, live.windowId, live.idOf('X'));

    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'This window already has these tabs.', show: false }]);
    // The open copies light up instead.
    await expect
      .poll(() => fillsSeen(page))
      .toEqual([sorted([live.idOf('A'), live.idOf('B')])]);
    await expect(page.locator(CARD)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await liveTabs(worker, live.windowId)).toEqual(before);
  });

  test('a saved tab dropped on a window that has it: "This window already has this tab."', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await liveTarget(worker);
    const page = await openTabView(context, extensionId, MIXED(), ON);
    const before = await liveTabs(worker, live.windowId);
    await watchFills(page);

    await pickUp(page, tabHandle(page, 'A'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('X'))));
    await page.mouse.up();

    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: 'This window already has this tab.', show: false }]);
    await expect.poll(() => fillsSeen(page)).toEqual([[live.idOf('A')]]);
    await expect(page.locator(CARD)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await liveTabs(worker, live.windowId)).toEqual(before);
  });

  test('a saved group dropped partly open: only the new page opens, grouped; the open copy keeps its live group', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    // The open copy of g0's page sits inside a live group of its own.
    const live = await openLiveWindow(worker, ['A', 'G0', 'B']);
    await groupLive(worker, live.windowId, [live.idOf('G0')], 'Live');
    const saved = session('S1', 'Trip', [
      win(
        'w1',
        [
          tab('s1'),
          { ...tab('g0', 'day'), url: dataUrl('G0') },
          tab('g1', 'day'),
        ],
        [{ groupId: 'day', title: 'Day trips', color: 'green' }]
      ),
    ]);
    const page = await openTabView(context, extensionId, saved, ON);
    await expect(liveRow(page, live.idOf('B'))).toBeVisible();

    await pickUp(page, groupHandle(page, 'day'));
    await carryTo(page, await topOf(liveRow(page, live.idOf('B'))));
    await page.mouse.up();

    await expect
      .poll(async () =>
        (await liveTabs(worker, live.windowId)).map((t) => [t.page, t.group])
      )
      .toEqual([
        [dataUrl('A'), null],
        [dataUrl('G0'), 'Live'],
        ['https://g1.test/', 'Day trips'],
        [dataUrl('B'), null],
      ]);
    await expect
      .poll(() => toasts(page))
      .toEqual([{ text: '1 duplicate tab left out.', show: false }]);
    const tabs = await liveTabs(worker, live.windowId);
    // Untouched: the same tab, in the same live group.
    expect(tabs[1]?.id).toBe(live.idOf('G0'));
    expect(tabs[2]?.groupId).not.toBe(tabs[1]?.groupId);
  });
});

test.describe("a saved group's Open, On", () => {
  test("a saved group's Open partly open: only the new pages open, grouped beside, the last one current", async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const research = savedWindowOf(
      'w1',
      '',
      ['Alpha', 'Beta', 'Gamma'].map((t) =>
        savedTab(t, standIn(t), { chromeGroupId: 'gr' })
      ),
      { chromeTabGroups: [{ groupId: 'gr', title: 'Research', color: 'blue' }] }
    );
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [savedSession('S1', 'Source', [research])],
      settings: ON,
    });
    const here = await ownWindow(page);
    // Alpha is open here, in a live group of another name, so Go to group finds no match.
    const [alpha] = await openIn(worker, here, ['Alpha']);
    await worker.evaluate(
      (id: number) => chrome.tabs.move(id, { index: 0 }),
      alpha
    );
    await groupLive(worker, here, [alpha], 'Mine');
    const before = await liveTabs(worker, here);

    await bandHandle(page, 'gr').hover();
    await bandHandle(page, 'gr')
      .locator('[data-row-actions]')
      .getByRole('button', { name: 'Open group: Research', exact: true })
      .click();

    await expect
      .poll(async () => (await liveTabs(worker, here)).length, SETTLE)
      .toBe(before.length + 2);
    const after = await liveTabs(worker, here);
    const of = (name: string) =>
      after.filter((t) => t.page === standIn(name)).map((t) => t.group);
    expect([of('Alpha'), of('Beta'), of('Gamma')]).toEqual([
      ['Mine'],
      ['Research'],
      ['Research'],
    ]);
    expect(after.find((t) => t.page === standIn('Alpha'))?.id).toBe(alpha);
    await expect
      .poll(
        async () =>
          (await liveTabs(worker, here))
            .filter((t) => t.active)
            .map((t) => t.page),
        SETTLE
      )
      .toEqual([standIn('Gamma')]);
  });
});

test.describe('Off', () => {
  test('the same window drop opens every tab', async ({
    context,
    extensionId,
    serviceWorker: worker,
  }) => {
    const live = await liveTarget(worker);
    const page = await openTabView(context, extensionId, MIXED(), {});

    await dropWindowOn(page, live.windowId, live.idOf('X'));

    await expect
      .poll(() => pagesIn(worker, live.windowId), SETTLE)
      .toEqual([
        dataUrl('A'),
        dataUrl('B'),
        dataUrl('X'),
        dataUrl('A'),
        dataUrl('B'),
        'https://s1.test/',
        'https://s2.test/',
      ]);
    await page.waitForTimeout(500);
    await noLeftOutToast(page);
  });
});
