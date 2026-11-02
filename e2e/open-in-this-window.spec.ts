// KAN-892 on the real artifact: with Open saved windows set to This window,
// Open adds a saved window or a whole session to the end of the window Tab
// Keeper is in (pinned tabs to its pinned run, groups and splits as Open makes
// them, the saved active tab current), and the menus' other way still opens a
// new window. Every check reads Chrome back.

import type { Page, Worker } from '@playwright/test';

import { grantedTest as test } from './fixtures/grantedExtension';
import { expect } from './fixtures/extension';
import { standIn } from './fixtures/standInPages';
import { openLiveWindow, strip } from './fixtures/liveWindows';
import { header, openSaved, session } from './fixtures/savedWindows';
import { allowInIncognito } from './fixtures/incognito';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import { FULL, FULL_VIEW_PATH, openPage } from './fixtures/onboarding';
import type {
  chromeTabGroupData,
  tabData,
  windowGroupData,
} from '../src/redux/slices/tabContainerDataStateSlice';

const THIS_WINDOW = { openSavedWindowsIn: 'this-window' };

const tab = (title: string, extra: Partial<tabData> = {}): tabData => ({
  tabId: title,
  favicon: '',
  title,
  url: standIn(title),
  ...extra,
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

const FOLDED: chromeTabGroupData = {
  groupId: 'gF',
  title: 'Folded',
  color: 'blue',
  collapsed: true,
};
const OPEN_GROUP: chromeTabGroupData = {
  groupId: 'gO',
  title: 'Open',
  color: 'red',
};
// A pinned tab, a collapsed group, the saved active tab, a split pair, an open group.
const MIXED = savedWindowOf(
  'w1',
  'Reading',
  [
    tab('Pin', { pinned: true }),
    tab('F1', { chromeGroupId: 'gF' }),
    tab('F2', { chromeGroupId: 'gF' }),
    tab('Act'),
    tab('SpL', { splitId: 'sp' }),
    tab('SpR', { splitId: 'sp' }),
    tab('O1', { chromeGroupId: 'gO' }),
  ],
  { chromeTabGroups: [FOLDED, OPEN_GROUP], activeTabId: 'Act' }
);

interface TabFact {
  id: number;
  title: string;
  pinned: boolean;
  active: boolean;
  // A KAN-250 placeholder, not the page itself.
  lazy: boolean;
  group: string | null;
  collapsed: boolean | null;
  split: number;
  status: string;
}

// A window's tabs in Chrome's order.
const facts = (worker: Worker, windowId: number): Promise<TabFact[]> =>
  worker.evaluate(async (id: number) => {
    const tabs = await chrome.tabs.query({ windowId: id });
    const groups = await chrome.tabGroups.query({ windowId: id });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map((t) => {
        const g = groups.find((x) => x.id === t.groupId);
        const url = t.pendingUrl || t.url || '';
        return {
          id: t.id ?? -1,
          title: t.title ?? '',
          pinned: t.pinned,
          active: t.active,
          lazy: url.startsWith('data:text/html;base64,'),
          group: g ? (g.title ?? '') : null,
          collapsed: g ? g.collapsed : null,
          split: Reflect.get(t, 'splitViewId') ?? -1,
          status: t.status ?? '',
        };
      });
  }, windowId);

const titles = async (worker: Worker, windowId: number) =>
  (await facts(worker, windowId)).map((t) => t.title);

const normalWindowIds = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.windows.getAll({ windowTypes: ['normal'] }))
      .flatMap((w) => (w.id === undefined ? [] : [w.id]))
      .sort((a, b) => a - b)
  );

const ownWindow = (page: Page) =>
  page.evaluate(async () => (await chrome.windows.getCurrent()).id ?? -1);

const SETTLE = { timeout: 15_000 };

test.describe('Open saved windows: This window (KAN-892)', () => {
  // Justine 11-02: Tab Keeper's tab, first of its run, stays first: new pinned
  // tabs go to the pinned run's end, the rest to the window's end.
  for (const pinned of [true, false]) {
    test(`Tab Keeper's own tab, first of the ${pinned ? 'pinned' : 'unpinned'} tabs, stays first of them`, async ({
      context,
      extensionId,
      serviceWorker,
    }) => {
      const page = await openSaved(context, extensionId, 'tab view', {
        sessions: [session('S1', 'Trip', [MIXED])],
        settings: THIS_WINDOW,
      });
      const here = await ownWindow(page);
      const own = await page.evaluate(
        async () => (await chrome.tabs.getCurrent())?.id ?? -1
      );
      // An old pinned tab and an old loose one; Tab Keeper first of its run.
      await serviceWorker.evaluate(
        async ({ windowId, own, pinned, urls }) => {
          const oldPin = await chrome.tabs.create({
            windowId,
            url: urls[0],
            active: false,
          });
          await chrome.tabs.create({ windowId, url: urls[1], active: false });
          if (oldPin.id !== undefined)
            await chrome.tabs.update(oldPin.id, { pinned: true });
          if (pinned) {
            await chrome.tabs.update(own, { pinned: true });
            await chrome.tabs.move(own, { index: 0 });
          } else {
            const run = (await chrome.tabs.query({ windowId, pinned: true }))
              .length;
            await chrome.tabs.move(own, { index: run });
          }
        },
        {
          windowId: here,
          own,
          pinned,
          urls: [standIn('Old pin'), standIn('Old')],
        }
      );
      const at = async () => {
        const all = await facts(serviceWorker, here);
        const run = all.filter((t) => t.pinned).length;
        return {
          index: all.findIndex((t) => t.id === own),
          first: pinned ? 0 : run,
          pins: all.filter((t) => t.pinned && t.id !== own).map((t) => t.title),
          count: all.length,
        };
      };
      const before = await at();
      // PREMISE: Tab Keeper is first of its run, and the run has an old tab beside it.
      expect(before.index).toBe(before.first);
      expect(before.pins).toEqual(['Old pin']);

      await page
        .getByRole('button', {
          name: 'Open in this window: Reading',
          exact: true,
        })
        .click();

      await expect
        .poll(async () => (await at()).count, SETTLE)
        .toBe(before.count + MIXED.tabs.length);
      const after = await at();
      expect(after.index).toBe(after.first);
      // The saved pin went after the old one, at the run's end.
      expect(after.pins).toEqual(['Old pin', 'Pin']);
    });
  }

  test('Open adds the saved window at the end of the window you are in, pinned to the pinned run, groups and split as Open makes them, its saved active tab current', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [session('S1', 'Trip', [MIXED])],
      settings: THIS_WINDOW,
    });
    const here = await ownWindow(page);
    const elsewhere = await openLiveWindow(serviceWorker, ['Elsewhere']);
    const before = await titles(serviceWorker, here);
    const windowsBefore = await normalWindowIds(serviceWorker);
    // PREMISE: nothing here is pinned, so the saved pin leads the window.
    expect((await facts(serviceWorker, here)).some((t) => t.pinned)).toBe(
      false
    );

    await page
      .getByRole('button', {
        name: 'Open in this window: Reading',
        exact: true,
      })
      .click();

    const expected = ['Pin', ...before, 'F1', 'F2', 'Act', 'SpL', 'SpR', 'O1'];
    await expect
      .poll(() => titles(serviceWorker, here), SETTLE)
      .toEqual(expected);
    const after = await facts(serviceWorker, here);
    const by = (title: string) => after.find((t) => t.title === title);

    expect(after.filter((t) => t.pinned).map((t) => t.title)).toEqual(['Pin']);
    expect(after.map((t) => t.group)).toEqual([
      null,
      ...before.map(() => null),
      'Folded',
      'Folded',
      null,
      null,
      null,
      'Open',
    ]);
    // Act is outside the collapsed group, so it stays collapsed (Open's 'saved' rule).
    expect([by('F1')?.collapsed, by('O1')?.collapsed]).toEqual([true, false]);
    expect(by('SpL')?.split).not.toBe(-1);
    expect(by('SpR')?.split).toBe(by('SpL')?.split);
    expect(after.filter((t) => t.active).map((t) => t.title)).toEqual(['Act']);
    // The target and the split pair load; the rest wait as placeholders.
    expect(
      ['Pin', 'F1', 'F2', 'Act', 'SpL', 'SpR', 'O1'].map((t) => [
        t,
        by(t)?.lazy,
      ])
    ).toEqual([
      ['Pin', true],
      ['F1', true],
      ['F2', true],
      ['Act', false],
      ['SpL', false],
      ['SpR', false],
      ['O1', true],
    ]);
    // Nothing went to a new window or to the other one.
    expect(await normalWindowIds(serviceWorker)).toEqual(windowsBefore);
    expect(await titles(serviceWorker, elsewhere.windowId)).toEqual([
      'Elsewhere',
    ]);

    // Task 2 review: an appended placeholder loads its page when shown.
    const o1 = by('O1');
    if (!o1) throw new Error('no O1');
    await expect
      .poll(
        async () =>
          (await facts(serviceWorker, here)).find((t) => t.id === o1.id)?.status
      )
      .toBe('complete');
    await serviceWorker.evaluate(
      (id: number) => chrome.tabs.update(id, { active: true }),
      o1.id
    );
    await expect
      .poll(
        async () =>
          (await strip(serviceWorker, here)).find((t) => t.id === o1.id)?.url,
        SETTLE
      )
      .toBe(standIn('O1'));
  });

  test('a session with two windows lands in this one window: every pinned tab first, then each window in saved order', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [
        session('S1', 'Trip', [
          savedWindowOf('w1', 'One', [tab('P1', { pinned: true }), tab('X1')], {
            activeTabId: 'X1',
          }),
          savedWindowOf('w2', 'Two', [tab('P2', { pinned: true }), tab('Y1')]),
        ]),
      ],
      settings: THIS_WINDOW,
    });
    const here = await ownWindow(page);
    const before = await titles(serviceWorker, here);
    const windowsBefore = await normalWindowIds(serviceWorker);

    await page
      .getByRole('button', { name: 'Open session in this window', exact: true })
      .click();

    await expect
      .poll(() => titles(serviceWorker, here), SETTLE)
      .toEqual(['P1', 'P2', ...before, 'X1', 'Y1']);
    const after = await facts(serviceWorker, here);
    expect(after.filter((t) => t.pinned).map((t) => t.title)).toEqual([
      'P1',
      'P2',
    ]);
    expect(after.filter((t) => t.active).map((t) => t.title)).toEqual(['X1']);
    expect(await normalWindowIds(serviceWorker)).toEqual(windowsBefore);
  });

  test("the right-click's other way opens a new window while This window is chosen", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [
        session('S1', 'Trip', [
          savedWindowOf('w1', 'Reading', [tab('N1'), tab('N2')]),
        ]),
      ],
      settings: THIS_WINDOW,
    });
    const here = await ownWindow(page);
    const before = await titles(serviceWorker, here);
    const windowsBefore = await normalWindowIds(serviceWorker);

    await header(page, 'w1').click({ button: 'right' });
    await page
      .locator('[data-row-menu]')
      .getByRole('menuitem', { name: 'Open in new window', exact: true })
      .click();

    await expect
      .poll(async () => (await normalWindowIds(serviceWorker)).length, SETTLE)
      .toBe(windowsBefore.length + 1);
    const made = (await normalWindowIds(serviceWorker)).find(
      (id) => !windowsBefore.includes(id)
    );
    if (made === undefined) throw new Error('no new window');
    await expect
      .poll(() => titles(serviceWorker, made), SETTLE)
      .toEqual(['N1', 'N2']);
    expect(await titles(serviceWorker, here)).toEqual(before);
  });

  // Task 2 review: Chrome must not pull tabs added after a grouped last tab into its group.
  test("when this window's last tab is in a group, the saved tabs land after it, outside the group", async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [
        session('S1', 'Trip', [
          savedWindowOf('w1', 'Reading', [tab('L1'), tab('L2')]),
        ]),
      ],
      settings: THIS_WINDOW,
    });
    const here = await ownWindow(page);
    await serviceWorker.evaluate(
      async ({ windowId, url }) => {
        const made = await chrome.tabs.create({ windowId, url, active: false });
        if (made.id === undefined) throw new Error('no tab id');
        const group = await chrome.tabs.group({
          tabIds: [made.id],
          createProperties: { windowId },
        });
        await chrome.tabGroups.update(group, { title: 'Live' });
      },
      { windowId: here, url: standIn('LiveLast') }
    );
    // PREMISE: the window ends in a group.
    await expect
      .poll(async () => (await facts(serviceWorker, here)).slice(-1)[0])
      .toEqual(expect.objectContaining({ title: 'LiveLast', group: 'Live' }));
    const before = await titles(serviceWorker, here);

    await page
      .getByRole('button', {
        name: 'Open in this window: Reading',
        exact: true,
      })
      .click();

    await expect
      .poll(() => titles(serviceWorker, here), SETTLE)
      .toEqual([...before, 'L1', 'L2']);
    const after = await facts(serviceWorker, here);
    expect(after.slice(-3).map((t) => [t.title, t.group])).toEqual([
      ['LiveLast', 'Live'],
      ['L1', null],
      ['L2', null],
    ]);
  });

  // Review Focus 1. The real toolbar popup, opened over window A, driven from a Tab Keeper page in another window.
  test('from the popup, the tabs land in the window it opened over', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await seedSettings(context, THIS_WINDOW);
    await seedSessions(
      context,
      buildContainer([
        buildSession({
          tabGroupId: 'S1',
          title: 'Trip',
          windowCount: 1,
          tabCount: 2,
          windows: [savedWindowOf('w1', 'Reading', [tab('X1'), tab('Y1')])],
        }),
      ])
    );
    // Writes the seeds to the extension's storage, which the popup reads; no init script reaches the popup.
    const helper = await openPage(context, extensionId, FULL_VIEW_PATH, FULL);
    const helperWindow = await ownWindow(helper);
    const a = await openLiveWindow(serviceWorker, ['A']);
    const helperBefore = await titles(serviceWorker, helperWindow);
    const windowsBefore = await normalWindowIds(serviceWorker);

    // Chrome shows a popup only over a focused window.
    await serviceWorker.evaluate(async (windowId: number) => {
      await chrome.windows.update(windowId, { focused: true });
      await chrome.action.openPopup({ windowId });
    }, a.windowId);
    const OPEN = '[aria-label="Open in this window: Reading"]';
    const popupHas = (selector: string) =>
      helper.evaluate(
        (s) =>
          chrome.extension
            .getViews({ type: 'popup' })[0]
            ?.document.querySelector(s) != null,
        selector
      );
    await expect.poll(() => popupHas(OPEN), SETTLE).toBe(true);
    // PREMISE: the popup's current window is A, not the helper's.
    expect(
      await helper.evaluate(async () => {
        const popup = chrome.extension.getViews({ type: 'popup' })[0];
        const api: unknown = popup ? Reflect.get(popup, 'chrome') : undefined;
        const windows: unknown =
          typeof api === 'object' && api !== null
            ? Reflect.get(api, 'windows')
            : undefined;
        const getCurrent: unknown =
          typeof windows === 'object' && windows !== null
            ? Reflect.get(windows, 'getCurrent')
            : undefined;
        if (typeof getCurrent !== 'function') return null;
        const current: unknown = await Reflect.apply(getCurrent, windows, []);
        return typeof current === 'object' && current !== null
          ? Reflect.get(current, 'id')
          : null;
      })
    ).toBe(a.windowId);

    await helper.evaluate((s) => {
      chrome.extension
        .getViews({ type: 'popup' })[0]
        ?.document.querySelector<HTMLElement>(s)
        ?.click();
    }, OPEN);

    await expect
      .poll(() => titles(serviceWorker, a.windowId), SETTLE)
      .toEqual(['A', 'X1', 'Y1']);
    expect(await titles(serviceWorker, helperWindow)).toEqual(helperBefore);
    expect(await normalWindowIds(serviceWorker)).toEqual(windowsBefore);
  });

  // Spec 7. Allowed in incognito, a window saved incognito opens in its own
  // new window from this normal one: Open says so, and no other way is offered.
  test('an incognito saved window from a normal window: Open says new window, the right-click offers no other way, and Open makes a new window', async ({
    context,
    extensionId,
  }) => {
    const worker = await allowInIncognito(context, extensionId);
    const page = await openSaved(context, extensionId, 'tab view', {
      sessions: [
        session('S1', 'Trip', [
          savedWindowOf('w1', 'Reading', [tab('I1'), tab('I2')], {
            incognito: true,
          }),
        ]),
      ],
      settings: THIS_WINDOW,
    });
    const here = await ownWindow(page);
    const before = await titles(worker, here);
    const windowsBefore = await normalWindowIds(worker);

    const open = page.getByRole('button', {
      name: 'Open in new window: Reading',
      exact: true,
    });
    await expect(open).toHaveAttribute('data-tooltip', 'Open in new window');
    await header(page, 'w1').click({ button: 'right' });
    const menu = page.locator('[data-row-menu]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-menu-item="openOtherWay"]')).toHaveCount(
      0
    );
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await open.click();
    await expect
      .poll(async () => (await normalWindowIds(worker)).length, SETTLE)
      .toBe(windowsBefore.length + 1);
    const made = (await normalWindowIds(worker)).find(
      (id) => !windowsBefore.includes(id)
    );
    if (made === undefined) throw new Error('no new window');
    expect(
      await worker.evaluate(
        async (id: number) => (await chrome.windows.get(id)).incognito,
        made
      )
    ).toBe(true);
    await expect.poll(() => titles(worker, made), SETTLE).toEqual(['I1', 'I2']);
    expect(await titles(worker, here)).toEqual(before);
  });
});
