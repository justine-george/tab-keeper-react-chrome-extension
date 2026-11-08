import { afterEach, describe, expect, test, vi } from 'vitest';

import type { tabData } from '../../../redux/slices/tabContainerDataStateSlice';
import {
  decodeDataUrl,
  isLazyPlaceholder,
} from '../../../utils/functions/local';
import {
  effectiveIncognito,
  isOpenIntoWindowAnswer,
  isOpenIntoWindowRequest,
  mergeForWindow,
  OPEN_INTO_WINDOW_MESSAGE,
  openIntoWindow,
  splitByKind,
  type OpenIntoWindowRequest,
} from '../../../utils/functions/openIntoWindow';
import { createSplitApi } from '../../../utils/functions/splitView';
import type { WindowSpec } from '../../../utils/functions/windows';
import { setupChromeFake } from '../../setup/chrome.fake';
import type { ChromeFakeHandle, ChromeSeed } from '../../setup/chrome.fake';

// KAN-892. Open, with This window chosen, and a saved window dropped on an open one.
const web = (name: string) => `https://${name}.test/`;
const OTHER_EXTENSION = 'chrome-extension://otherextension/page.html';

let handle: ChromeFakeHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  vi.restoreAllMocks();
});

const tab = (name: string, extra: Partial<tabData> = {}): tabData => ({
  tabId: name,
  favicon: '',
  title: name,
  url: web(name),
  ...extra,
});

const spec = (
  tabs: tabData[],
  extra: Partial<WindowSpec> = {}
): WindowSpec => ({
  tabs,
  focused: true,
  bounds: null,
  ...extra,
});

const req = (
  specs: WindowSpec[],
  extra: Partial<OpenIntoWindowRequest> = {}
): OpenIntoWindowRequest => ({
  type: OPEN_INTO_WINDOW_MESSAGE,
  windowId: 1,
  specs,
  goToURLText: 'Visit Site',
  activate: true,
  pinTabKeeper: false,
  skipTabsAlreadyOpen: false,
  ...extra,
});

// Window 1 holds [p0 pinned, a active, b]; window 2 has focus.
const seed = (extra: ChromeSeed = {}): ChromeSeed => ({
  windows: [
    {
      id: 1,
      tabs: [
        { id: 10, url: web('p0'), pinned: true },
        { id: 11, url: web('a'), active: true },
        { id: 12, url: web('b') },
      ],
    },
    {
      id: 2,
      focused: true,
      tabs: [{ id: 20, url: web('other'), active: true }],
    },
  ],
  ...extra,
});

const tabsOf = async (windowId: number) =>
  (await chrome.tabs.query({ windowId })).sort((x, y) => x.index - y.index);

// A tab's page name, ~ while still a lazy placeholder.
const nameOf = (t: chrome.tabs.Tab) => {
  const url = t.url ?? '';
  const name = new URL(decodeDataUrl(url)).hostname.split('.')[0];
  return `${isLazyPlaceholder(url) ? '~' : ''}${name}`;
};

// Window's tabs in order by page name, placeholders unmarked.
const strip = async (windowId: number) =>
  (await tabsOf(windowId)).map((t) => nameOf(t).replace('~', ''));

const none = {
  ids: [],
  savedTabIds: [],
  leftOut: 0,
  alreadyOpen: [],
  madeWindows: [],
};

const windowIds = async () =>
  (await chrome.windows.getAll({ windowTypes: ['normal', 'popup'] })).map(
    (w) => w.id
  );

describe('placement', () => {
  test('puts pinned tabs at the end of the pinned run and the rest at the end', async () => {
    handle = setupChromeFake(seed());
    await openIntoWindow(
      req([
        spec([
          tab('s0', { pinned: true }),
          tab('t0', { pinned: true }),
          tab('s1'),
          tab('s2'),
        ]),
      ])
    );
    expect(await strip(1)).toEqual(['p0', 's0', 't0', 'a', 'b', 's1', 's2']);
    expect((await tabsOf(1)).map((t) => t.pinned)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(await windowIds()).toEqual([1, 2]);
  });

  test("a session: every window's pinned tabs first, then each window in saved order", async () => {
    handle = setupChromeFake(seed());
    await openIntoWindow(
      req([
        spec([tab('a0', { pinned: true }), tab('a1')]),
        spec([tab('b0', { pinned: true }), tab('b1')], { focused: false }),
      ])
    );
    expect(await strip(1)).toEqual(['p0', 'a0', 'b0', 'a', 'b', 'a1', 'b1']);
  });

  test('answers the created ids in merged order', async () => {
    handle = setupChromeFake(seed());
    const { ids } = await openIntoWindow(
      req([spec([tab('s0', { pinned: true }), tab('s1')])])
    );
    const byId = new Map((await tabsOf(1)).map((t) => [t.id, nameOf(t)]));
    expect(ids.map((id) => byId.get(id)?.replace('~', ''))).toEqual([
      's0',
      's1',
    ]);
  });

  test('a tab Chrome refuses is skipped and left out of the answer; the rest still open', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [OTHER_EXTENSION] }));
    const { ids } = await openIntoWindow(
      req([spec([tab('s0'), tab('x', { url: OTHER_EXTENSION }), tab('s2')])])
    );
    expect(await strip(1)).toEqual(['p0', 'a', 'b', 's0', 's2']);
    expect(ids).toHaveLength(2);
  });

  // KAN-893. A drop's redo opens again exactly the saved tabs it opened.
  test('names the saved tab behind each id, refused and left-out ones left out', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [OTHER_EXTENSION] }));
    const answer = await openIntoWindow(
      req(
        [
          spec([
            tab('s0'),
            tab('x', { url: OTHER_EXTENSION }),
            tab('a'),
            tab('p1', { pinned: true }),
          ]),
        ],
        { skipTabsAlreadyOpen: true }
      )
    );
    expect(answer.savedTabIds).toEqual(['p1', 's0']);
    expect(answer.ids).toHaveLength(2);
  });

  // Chrome (and the fake) clamp a pinned slot past the run, so the slot asked for is the rule.
  test('a refused pinned tab takes no slot: each pinned one after asks for the slot after the last made', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [OTHER_EXTENSION] }));
    const create = vi.spyOn(chrome.tabs, 'create');
    await openIntoWindow(
      req([
        spec([
          tab('s0', { pinned: true }),
          tab('x', { url: OTHER_EXTENSION, pinned: true }),
          tab('t0', { pinned: true }),
          tab('u0', { pinned: true }),
          tab('s1'),
        ]),
      ])
    );
    expect(create.mock.calls.map(([props]) => props.index)).toEqual([
      1,
      2,
      2,
      3,
      undefined,
    ]);
    expect(await strip(1)).toEqual(['p0', 's0', 't0', 'u0', 'a', 'b', 's1']);
  });
});

describe('groups', () => {
  // activate: false, so the fake's activation (which expands a collapsed group) cannot stand in for the rule.
  test("re-forms groups with the saved look and Open's collapse rule", async () => {
    handle = setupChromeFake(seed());
    await openIntoWindow(
      req(
        [
          spec(
            [
              tab('g1', { chromeGroupId: 'G' }),
              tab('g2', { chromeGroupId: 'G' }),
              tab('loose'),
              tab('h1', { chromeGroupId: 'H' }),
            ],
            {
              activeTabId: 'g2',
              groups: [
                { groupId: 'G', title: 'Work', color: 'blue', collapsed: true },
                { groupId: 'H', title: 'Later', color: 'red', collapsed: true },
              ],
            }
          ),
        ],
        { activate: false }
      )
    );
    const strip1 = await tabsOf(1);
    const groupOf = (name: string) =>
      strip1.find((t) => nameOf(t).replace('~', '') === name)?.groupId ?? -1;
    expect(groupOf('g1')).not.toBe(-1);
    expect(groupOf('g2')).toBe(groupOf('g1'));
    expect(groupOf('loose')).toBe(-1);
    expect(groupOf('h1')).not.toBe(-1);
    expect(groupOf('a')).toBe(-1);
    const work = await chrome.tabGroups.get(groupOf('g1'));
    const later = await chrome.tabGroups.get(groupOf('h1'));
    expect(work).toMatchObject({
      title: 'Work',
      color: 'blue',
      collapsed: false,
    });
    expect(later).toMatchObject({
      title: 'Later',
      color: 'red',
      collapsed: true,
    });
  });
});

describe('loading', () => {
  // Split views exist from Chrome 155; the fake's createSplit records each call.
  const splitCalls = () => {
    const calls: number[][] = [];
    const real = createSplitApi();
    Reflect.set(chrome.tabs, 'createSplit', (ids: number[]) => {
      calls.push(ids);
      return real ? real(ids) : Promise.reject(new Error('no createSplit'));
    });
    return calls;
  };

  test('loads only the target real, the rest as placeholders, split partners real', async () => {
    handle = setupChromeFake(seed({ splitView: true }));
    const calls = splitCalls();
    await openIntoWindow(
      req([
        spec(
          [
            tab('s0'),
            tab('t'),
            tab('l', { splitId: 'S' }),
            tab('r', { splitId: 'S' }),
            tab('s4'),
          ],
          { activeTabId: 't' }
        ),
        spec([tab('w0'), tab('w1', { url: OTHER_EXTENSION })], {
          focused: false,
          activeTabId: 'w0',
        }),
      ])
    );
    const added = (await tabsOf(1)).slice(3);
    expect(added.map(nameOf)).toEqual([
      '~s0',
      't',
      'l',
      'r',
      '~s4',
      '~w0',
      'otherextension',
    ]);
    expect(calls).toHaveLength(1);
    expect(added[2].splitViewId).not.toBe(-1);
    expect(added[3].splitViewId).toBe(added[2].splitViewId);
  });

  test('a split pair whose split call fails stays as two plain tabs', async () => {
    handle = setupChromeFake(seed({ splitView: true }));
    Reflect.set(chrome.tabs, 'createSplit', () =>
      Promise.reject(new Error('refused'))
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await openIntoWindow(
      req([
        spec([
          tab('s0'),
          tab('l', { splitId: 'S' }),
          tab('r', { splitId: 'S' }),
        ]),
      ])
    );
    const added = (await tabsOf(1)).slice(3);
    expect(added.map(nameOf)).toEqual(['s0', 'l', 'r']);
    expect(added.map((t) => t.splitViewId)).toEqual([-1, -1, -1]);
    expect(warn).toHaveBeenCalledWith(
      'Could not restore a split view:',
      expect.any(Error)
    );
  });
});

describe('focus', () => {
  test('activate: true makes the saved active tab current and focuses this window', async () => {
    handle = setupChromeFake(seed());
    await openIntoWindow(
      req([spec([tab('s0'), tab('s1'), tab('s2')], { activeTabId: 's1' })])
    );
    const active = (await tabsOf(1)).find((t) => t.active);
    expect(active && nameOf(active)).toBe('s1');
    expect((await chrome.windows.get(1)).focused).toBe(true);
    expect((await chrome.windows.get(2)).focused).toBe(false);
  });

  test('activate: true with the saved active tab refused: the tab Open falls back to is current', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [OTHER_EXTENSION] }));
    await openIntoWindow(
      req([
        spec(
          [
            tab('s0', { pinned: true }),
            tab('s1'),
            tab('x', { url: OTHER_EXTENSION }),
          ],
          {
            activeTabId: 'x',
          }
        ),
      ])
    );
    const active = (await tabsOf(1)).find((t) => t.active);
    expect(active && nameOf(active).replace('~', '')).toBe('s1');
  });

  test('activate: false changes nothing: every tab opens inactive, no focus moves', async () => {
    handle = setupChromeFake(seed());
    const focus = vi.spyOn(chrome.windows, 'update');
    await openIntoWindow(
      req(
        [
          spec([tab('s0', { pinned: true }), tab('s1'), tab('s2')], {
            activeTabId: 's1',
          }),
        ],
        {
          activate: false,
        }
      )
    );
    const active = (await tabsOf(1)).find((t) => t.active);
    expect(active && nameOf(active)).toBe('a');
    expect(handle.createdTabs.map((p) => p.active)).toEqual([
      false,
      false,
      false,
    ]);
    expect(focus).not.toHaveBeenCalled();
    expect((await chrome.windows.get(2)).focused).toBe(true);
  });
});

describe('incognito', () => {
  const inc = spec([tab('i0')], { incognito: true });
  const normal = spec([tab('n0')], { focused: false });

  test('effectiveIncognito: incognito only when saved so and allowed', () => {
    expect(effectiveIncognito(true, true)).toBe(true);
    expect(effectiveIncognito(true, false)).toBe(false);
    expect(effectiveIncognito(undefined, true)).toBe(false);
    expect(effectiveIncognito(undefined, false)).toBe(false);
  });

  test('an incognito saved window opens apart when the target is normal and incognito is allowed', () => {
    expect(splitByKind([inc, normal], false, true)).toEqual({
      into: [normal],
      apart: [inc],
    });
    expect(splitByKind([inc, normal], false, false)).toEqual({
      into: [inc, normal],
      apart: [],
    });
    expect(splitByKind([inc, normal], true, true)).toEqual({
      into: [inc],
      apart: [normal],
    });
  });

  test('allowed, target normal: the incognito window opens first in its own window, the rest here', async () => {
    handle = setupChromeFake(seed({ incognitoAllowed: true }));
    const order: string[] = [];
    chrome.windows.onCreated.addListener(() => order.push('window'));
    chrome.tabs.onCreated.addListener((t) => {
      if (t.windowId === 1) order.push('tab here');
    });

    await openIntoWindow(req([inc, normal]));

    expect(await strip(1)).toEqual(['p0', 'a', 'b', 'n0']);
    const made = (await chrome.windows.getAll({ populate: true })).find(
      (w) => w.id !== 1 && w.id !== 2
    );
    expect(made?.incognito).toBe(true);
    expect(made?.tabs?.map((t) => t.url)).toEqual([web('i0')]);
    expect(order).toEqual(['window', 'tab here']);
  });

  test('every saved window of the other kind: nothing lands here and the answer names only the window opened apart', async () => {
    handle = setupChromeFake(seed({ incognitoAllowed: true }));
    const answer = await openIntoWindow(req([inc]));
    expect({ ...answer, madeWindows: [] }).toEqual(none);
    expect(answer.madeWindows).toHaveLength(1);
    expect(await strip(1)).toEqual(['p0', 'a', 'b']);
    expect(await windowIds()).toHaveLength(3);
  });
});

describe('falls back to new windows', () => {
  const saved = [spec([tab('s0'), tab('s1')])];
  const newWindowTabs = async () =>
    (await chrome.windows.getAll({ populate: true }))
      .filter((w) => w.id !== 1 && w.id !== 2)
      .map((w) => (w.tabs ?? []).map((t) => nameOf(t).replace('~', '')));

  test('when this window is gone', async () => {
    handle = setupChromeFake(seed());
    const { ids } = await openIntoWindow(req(saved, { windowId: 999 }));
    expect(ids).toEqual([]);
    expect(await newWindowTabs()).toEqual([['s0', 's1']]);
  });

  // KAN-893. Its undo closes that window, so the answer names it.
  test('answers the window it made instead, with its tabs', async () => {
    handle = setupChromeFake(seed());
    const answer = await openIntoWindow(
      req(saved, { windowId: 999, pinTabKeeper: true })
    );
    expect(answer.ids).toEqual([]);
    expect(answer.madeWindows).toHaveLength(1);
    const [made] = answer.madeWindows;
    const tabs = await tabsOf(made.windowId);
    expect(made.stubTabId).toBe(tabs[0].id);
    expect(made.tabIds).toEqual(tabs.slice(1).map((t) => t.id));
    expect(isOpenIntoWindowAnswer(answer)).toBe(true);
  });

  test('when the first tab is refused with the window gone: the made window is answered too', async () => {
    handle = setupChromeFake(seed());
    const fake = handle;
    vi.spyOn(
      chrome.extension,
      'isAllowedIncognitoAccess'
    ).mockImplementationOnce(() => {
      fake.browser.closeWindow(1);
      return Promise.resolve(false);
    });
    const answer = await openIntoWindow(req(saved));
    expect(answer.madeWindows).toHaveLength(1);
    expect(answer.madeWindows[0].tabIds).toHaveLength(2);
  });

  test('when this window cannot hold tabs (a popup or app window)', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, type: 'popup', tabs: [{ id: 10, url: web('app') }] },
        { id: 2, focused: true, tabs: [{ id: 20, url: web('other') }] },
      ],
    });
    const { ids } = await openIntoWindow(req(saved));
    expect(ids).toEqual([]);
    expect(await strip(1)).toEqual(['app']);
    expect(await newWindowTabs()).toEqual([['s0', 's1']]);
  });

  test('when this window refuses the first tab (it closed meanwhile)', async () => {
    handle = setupChromeFake(seed());
    const fake = handle;
    // After this window is read, before its first tab is made.
    vi.spyOn(
      chrome.extension,
      'isAllowedIncognitoAccess'
    ).mockImplementationOnce(() => {
      fake.browser.closeWindow(1);
      return Promise.resolve(false);
    });
    const { ids } = await openIntoWindow(req(saved));
    expect(ids).toEqual([]);
    expect(await newWindowTabs()).toEqual([['s0', 's1']]);
  });

  test('not when only the first tab is refused: it is skipped, the rest land here, the target falls back', async () => {
    handle = setupChromeFake(seed({ refusedUrls: [web('s0')] }));
    const { ids } = await openIntoWindow(
      req([
        spec([tab('s0', { pinned: true }), tab('s1'), tab('s2')], {
          activeTabId: 's0',
        }),
      ])
    );
    expect(await strip(1)).toEqual(['p0', 'a', 'b', 's1', 's2']);
    expect(await newWindowTabs()).toEqual([]);
    expect(ids).toHaveLength(2);
    const active = (await tabsOf(1)).find((t) => t.active);
    expect(active && nameOf(active).replace('~', '')).toBe('s1');
  });

  test('an empty request opens nothing', async () => {
    handle = setupChromeFake(seed());
    expect(await openIntoWindow(req([]))).toEqual(none);
    expect(await openIntoWindow(req([spec([])]))).toEqual(none);
    expect(await strip(1)).toEqual(['p0', 'a', 'b']);
    expect(await windowIds()).toEqual([1, 2]);
  });
});

describe('mergeForWindow', () => {
  test('pinned of every window, then each window; the target mapped into that order', () => {
    const merged = mergeForWindow([
      spec([tab('a0', { pinned: true }), tab('a1'), tab('a2')], {
        activeTabId: 'a2',
        groups: [{ groupId: 'G', title: 'g', color: 'blue' }],
      }),
      spec([tab('b0', { pinned: true }), tab('b1')], {
        groups: [{ groupId: 'H', title: 'h', color: 'red' }],
      }),
    ]);
    expect(merged.tabs.map((t) => t.tabId)).toEqual([
      'a0',
      'b0',
      'a1',
      'a2',
      'b1',
    ]);
    expect(merged.targetIndex).toBe(3);
    expect(merged.groups.map((g) => g.groupId)).toEqual(['G', 'H']);
  });

  test('with no saved active tab, the target is the first window’s first unpinned tab', () => {
    const merged = mergeForWindow([
      spec([tab('a0', { pinned: true }), tab('a1')]),
      spec([tab('b0', { pinned: true })]),
    ]);
    expect(merged.tabs[merged.targetIndex].tabId).toBe('a1');
  });

  test('a split id shared by two saved windows stays two pairs', () => {
    const merged = mergeForWindow([
      spec([tab('a0', { splitId: 'S' }), tab('a1', { splitId: 'S' })]),
      spec([tab('b0', { splitId: 'S' }), tab('b1', { splitId: 'S' })]),
    ]);
    const ids = merged.tabs.map((t) => t.splitId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });
});

describe('the message', () => {
  test('isOpenIntoWindowRequest accepts only a whole request', () => {
    const ok = req([spec([tab('s0')])]);
    expect(isOpenIntoWindowRequest(ok)).toBe(true);
    expect(isOpenIntoWindowRequest(null)).toBe(false);
    expect(isOpenIntoWindowRequest({ ...ok, type: 'restore-session' })).toBe(
      false
    );
    expect(isOpenIntoWindowRequest({ ...ok, windowId: '1' })).toBe(false);
    expect(isOpenIntoWindowRequest({ ...ok, specs: undefined })).toBe(false);
    expect(isOpenIntoWindowRequest({ ...ok, goToURLText: 1 })).toBe(false);
    expect(isOpenIntoWindowRequest({ ...ok, activate: 'yes' })).toBe(false);
    expect(isOpenIntoWindowRequest({ ...ok, pinTabKeeper: undefined })).toBe(
      false
    );
    expect(
      isOpenIntoWindowRequest({ ...ok, skipTabsAlreadyOpen: undefined })
    ).toBe(false);
  });

  test('isOpenIntoWindowAnswer accepts only ids, a count, ids and made windows', () => {
    const ok = {
      ids: [1],
      savedTabIds: ['s1'],
      leftOut: 0,
      alreadyOpen: [2],
      madeWindows: [{ windowId: 3, tabIds: [4], stubTabId: null }],
    };
    expect(isOpenIntoWindowAnswer(ok)).toBe(true);
    expect(isOpenIntoWindowAnswer([1, 2])).toBe(false);
    expect(isOpenIntoWindowAnswer(null)).toBe(false);
    expect(isOpenIntoWindowAnswer({ ...ok, ids: ['1'] })).toBe(false);
    expect(isOpenIntoWindowAnswer({ ...ok, leftOut: '0' })).toBe(false);
    expect(isOpenIntoWindowAnswer({ ...ok, alreadyOpen: undefined })).toBe(
      false
    );
    expect(isOpenIntoWindowAnswer({ ...ok, madeWindows: undefined })).toBe(
      false
    );
    expect(isOpenIntoWindowAnswer({ ...ok, savedTabIds: [1] })).toBe(false);
    expect(
      isOpenIntoWindowAnswer({
        ...ok,
        madeWindows: [{ windowId: 3, tabIds: ['4'], stubTabId: null }],
      })
    ).toBe(false);
  });

  test('the worker answers with the created ids', async () => {
    handle = setupChromeFake(seed({ action: {} }));
    vi.resetModules();
    await import('../../../background');
    const answer: unknown = await chrome.runtime.sendMessage(
      req([spec([tab('s0'), tab('s1')])], { activate: false })
    );
    const added = (await tabsOf(1)).slice(3);
    expect(answer).toEqual({
      ids: added.map((t) => t.id),
      savedTabIds: ['s0', 's1'],
      leftOut: 0,
      alreadyOpen: [],
      madeWindows: [],
    });
    expect(added.map(nameOf)).toEqual(['s0', '~s1']);
  });
});

describe('skip tabs already open', () => {
  const skip = { skipTabsAlreadyOpen: true };
  const newWindowCount = async () => (await windowIds()).length;

  test('flag off creates every tab (today)', async () => {
    handle = setupChromeFake(seed());
    const answer = await openIntoWindow(
      req([spec([tab('a'), tab('s1')])], { skipTabsAlreadyOpen: false })
    );
    expect(await strip(1)).toEqual(['p0', 'a', 'b', 'a', 's1']);
    expect(answer.ids).toHaveLength(2);
    expect(answer.leftOut).toBe(0);
    expect(answer.alreadyOpen).toEqual([]);
  });

  test('leaves out pages the window has and answers leftOut + alreadyOpen', async () => {
    handle = setupChromeFake(seed());
    const answer = await openIntoWindow(
      req([spec([tab('a'), tab('s1'), tab('b')])], skip)
    );
    expect(await strip(1)).toEqual(['p0', 'a', 'b', 's1']);
    expect(answer.ids).toHaveLength(1);
    expect(answer.leftOut).toBe(2);
    expect(answer.alreadyOpen).toEqual([11, 12]);
  });

  test('all open: creates nothing; with activate, the open copy of the target tab becomes current and the window focuses', async () => {
    handle = setupChromeFake(seed());
    const create = vi.spyOn(chrome.tabs, 'create');
    const answer = await openIntoWindow(
      req([spec([tab('b'), tab('p0')], { activeTabId: 'b' })], {
        ...skip,
        windowId: 1,
      })
    );
    expect(create).not.toHaveBeenCalled();
    expect(answer).toEqual({
      ids: [],
      savedTabIds: [],
      leftOut: 2,
      alreadyOpen: [12, 10],
      madeWindows: [],
    });
    const active = (await tabsOf(1)).find((t) => t.active);
    expect(active?.id).toBe(12);
    expect((await chrome.windows.get(1)).focused).toBe(true);
  });

  test('all open, no activate: nothing is activated or focused', async () => {
    handle = setupChromeFake(seed());
    const create = vi.spyOn(chrome.tabs, 'create');
    const focus = vi.spyOn(chrome.windows, 'update');
    const answer = await openIntoWindow(
      req([spec([tab('b')], { activeTabId: 'b' })], {
        ...skip,
        activate: false,
      })
    );
    expect(create).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(answer.leftOut).toBe(1);
    expect((await tabsOf(1)).find((t) => t.active)?.id).toBe(11);
  });

  test('activates the open copy when the saved active tab was left out', async () => {
    handle = setupChromeFake(seed());
    const answer = await openIntoWindow(
      req([spec([tab('s0'), tab('b'), tab('s2')], { activeTabId: 'b' })], skip)
    );
    expect(await strip(1)).toEqual(['p0', 'a', 'b', 's0', 's2']);
    expect(answer.ids).toHaveLength(2);
    expect((await tabsOf(1)).find((t) => t.active)?.id).toBe(12);
    expect((await chrome.windows.get(1)).focused).toBe(true);
    // No made tab is the target, so none loads its page.
    expect((await tabsOf(1)).slice(3).map(nameOf)).toEqual(['~s0', '~s2']);
  });

  test('activates the kept copy when the saved active tab repeats an earlier one', async () => {
    handle = setupChromeFake(seed());
    await openIntoWindow(
      req(
        [
          spec([tab('s1'), tab('s0'), tab('s0', { tabId: 's0again' })], {
            activeTabId: 's0again',
          }),
        ],
        skip
      )
    );
    const active = (await tabsOf(1)).find((t) => t.active);
    expect(active && nameOf(active).replace('~', '')).toBe('s0');
  });

  test('the saved active tab kept stays the one made current, at its index among those kept', async () => {
    handle = setupChromeFake(seed());
    await openIntoWindow(
      req([spec([tab('b'), tab('s1'), tab('s2')], { activeTabId: 's2' })], skip)
    );
    const active = (await tabsOf(1)).find((t) => t.active);
    expect(active && nameOf(active).replace('~', '')).toBe('s2');
  });

  test('a pinned tab left out takes no pinned slot', async () => {
    handle = setupChromeFake(seed());
    const create = vi.spyOn(chrome.tabs, 'create');
    await openIntoWindow(
      req(
        [spec([tab('p0', { pinned: true }), tab('s0', { pinned: true })])],
        skip
      )
    );
    expect(create.mock.calls.map(([props]) => props.index)).toEqual([1]);
    expect(await strip(1)).toEqual(['p0', 's0', 'a', 'b']);
  });

  test('a page in two saved windows opens once', async () => {
    handle = setupChromeFake(seed());
    const answer = await openIntoWindow(
      req([spec([tab('s0')]), spec([tab('s0', { tabId: 'again' })])], skip)
    );
    expect(await strip(1)).toEqual(['p0', 'a', 'b', 's0']);
    expect(answer.leftOut).toBe(1);
  });

  test("reads the window's tabs once", async () => {
    handle = setupChromeFake(seed());
    const query = vi.spyOn(chrome.tabs, 'query');
    await openIntoWindow(req([spec([tab('a'), tab('s1')])], skip));
    expect(query.mock.calls.filter(([q]) => q.windowId === 1)).toHaveLength(1);
  });

  test('specs opened apart (other kind) are not compared', async () => {
    handle = setupChromeFake(seed({ incognitoAllowed: true }));
    const answer = await openIntoWindow(
      req([spec([tab('a')], { incognito: true }), spec([tab('b')])], skip)
    );
    expect(answer.leftOut).toBe(1);
    expect(answer.alreadyOpen).toEqual([12]);
    expect(await newWindowCount()).toBe(3);
  });

  test('window gone → new windows, nothing compared', async () => {
    handle = setupChromeFake(seed());
    const answer = await openIntoWindow(
      req([spec([tab('a'), tab('s1')])], { ...skip, windowId: 999 })
    );
    expect({ ...answer, madeWindows: [] }).toEqual(none);
    expect(answer.madeWindows[0]?.tabIds).toHaveLength(2);
    const all = await chrome.windows.getAll({ populate: true });
    const fresh = all.filter((w) => w.id !== 1 && w.id !== 2);
    expect(fresh.map((w) => (w.tabs ?? []).length)).toEqual([2]);
  });
});
