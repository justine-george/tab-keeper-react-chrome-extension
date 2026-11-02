import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load. See
// focusSavesEveryWindow.test.ts for the same pattern and why it is needed.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import {
  focusTabContainer,
  openAllTabContainer,
  openTabsInAWindow,
  restoreContainer,
  type TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setOpenSavedWindowsIn,
  setPinTabKeeperInNewWindows,
  type OpenSavedWindowsIn,
} from '../../redux/slices/settingsDataStateSlice';
import {
  RESTORE_SESSION_MESSAGE,
  type RestoreSessionRequest,
} from '../../utils/functions/windows';
import {
  isOpenIntoWindowRequest,
  OPEN_INTO_WINDOW_MESSAGE,
  type OpenIntoWindowRequest,
} from '../../utils/functions/openIntoWindow';
import { setupChromeFake } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

// This is the actual safety net for KAN-11 task 6. Before this refactor, only
// focusTabContainer had any coverage (focusSavesEveryWindow.test.ts) -- a
// green suite proved nothing about "Open in new window" or "Open session",
// the two most-used buttons in the app. Each test here pins the exact
// RestoreSessionRequest a call site hands to chrome.runtime.sendMessage, so a
// future change that alters specs, closeOtherWindows, or drops the message
// entirely turns red here first.

const SESSION: TabMasterContainer = {
  lastModified: 1,
  selectedTabGroupId: null,
  tabGroups: [
    {
      tabGroupId: 'group-1',
      title: 'Two windows',
      createdTime: '2026-09-01 12:00:00',
      windowCount: 2,
      tabCount: 2,
      isAutoSave: false,
      isSelected: false,
      windows: [
        {
          windowId: 'w-a',
          windowHeight: 700,
          windowWidth: 900,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'A',
          tabs: [
            {
              tabId: 't-a',
              favicon: '',
              title: 'A',
              url: 'https://a.example/',
            },
          ],
        },
        {
          windowId: 'w-b',
          windowHeight: 700,
          windowWidth: 900,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 'B',
          tabs: [
            {
              tabId: 't-b',
              favicon: '',
              title: 'B',
              url: 'https://b.example/',
            },
          ],
        },
      ],
    },
  ],
};

const GO_TO_URL_TEXT = 'Go to URL';

function firstSentRequest(
  handle: ReturnType<typeof setupChromeFake>
): RestoreSessionRequest {
  expect(handle.sentMessages).toHaveLength(1);
  return handle.sentMessages[0] as RestoreSessionRequest;
}

describe('every restore call site posts one RestoreSessionRequest to the worker', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  beforeEach(() => {
    handle?.restore();
    handle = undefined;
  });

  it('openTabsInAWindow ("Open in new window") sends exactly 1 spec for the requested window, closeOtherWindows false', async () => {
    handle = setupChromeFake();

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(SESSION));
    await store.dispatch(
      openTabsInAWindow({
        tabGroupId: 'group-1',
        windowId: 'w-b',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect(request.closeOtherWindows).toBe(false);
    expect(request.pinTabKeeper).toBe(false);
    expect(request.specs).toHaveLength(1);
    expect(request.specs[0].focused).toBe(true);
    expect(request.specs[0].tabs.map((t) => t.url)).toEqual([
      'https://b.example/',
    ]);
  });

  it('openAllTabContainer ("Open session") sends one spec per window, closeOtherWindows false', async () => {
    handle = setupChromeFake();

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(SESSION));
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect(request.closeOtherWindows).toBe(false);
    expect(request.pinTabKeeper).toBe(false);
    expect(request.specs).toHaveLength(2);
    expect(request.specs[0].focused).toBe(true);
    expect(request.specs[1].focused).toBe(false);
    expect(request.specs.map((s) => s.tabs[0].url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  });

  it('focusTabContainer (focus mode) sends one spec per window, closeOtherWindows true', async () => {
    // A window open before the switch, distinct from SESSION's windows, so
    // captureOpenWindows has something to capture -- mirrors
    // focusSavesEveryWindow.test.ts's fixture.
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://open.example/', title: 'Open' },
          ] as chrome.tabs.Tab[],
        },
      ],
    });

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(SESSION));
    await store.dispatch(
      focusTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
        saveTitle: 'Auto-saved before switching',
      })
    );

    const request = firstSentRequest(handle);
    expect(request.closeOtherWindows).toBe(true);
    expect(request.pinTabKeeper).toBe(false);
    expect(request.specs).toHaveLength(2);
    expect(request.specs[0].focused).toBe(true);
    expect(request.specs[1].focused).toBe(false);
    expect(request.specs.map((s) => s.tabs[0].url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  });

  type Store = ReturnType<typeof makeTestStore>['store'];
  it.each<[string, (store: Store) => Promise<unknown>]>([
    [
      'openTabsInAWindow',
      (store) =>
        store.dispatch(
          openTabsInAWindow({
            tabGroupId: 'group-1',
            windowId: 'w-b',
            goToURLText: GO_TO_URL_TEXT,
          })
        ),
    ],
    [
      'openAllTabContainer',
      (store) =>
        store.dispatch(
          openAllTabContainer({
            tabGroupId: 'group-1',
            goToURLText: GO_TO_URL_TEXT,
          })
        ),
    ],
    [
      'focusTabContainer',
      (store) =>
        store.dispatch(
          focusTabContainer({
            tabGroupId: 'group-1',
            goToURLText: GO_TO_URL_TEXT,
            saveTitle: 'Auto-saved before switching',
          })
        ),
    ],
  ])(
    '%s carries Pin Tab Keeper in new windows as the page has it',
    async (_name, run) => {
      handle = setupChromeFake({
        windows: [{ id: 1, tabs: [{ id: 1, url: 'https://open.example/' }] }],
      });
      const { store } = makeTestStore();
      store.dispatch(restoreContainer(SESSION));
      store.dispatch(setPinTabKeeperInNewWindows(true));
      await run(store);
      expect(firstSentRequest(handle).pinTabKeeper).toBe(true);
    }
  );

  it('a window saved with an active tab sends it in its spec; one without sends none (KAN-458)', async () => {
    handle = setupChromeFake();
    const [first, second] = SESSION.tabGroups[0].windows;
    const withActiveTab: TabMasterContainer = {
      ...SESSION,
      tabGroups: [
        {
          ...SESSION.tabGroups[0],
          windows: [{ ...first, activeTabId: 't-a' }, second],
        },
      ],
    };

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(withActiveTab));
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect(request.specs[0].activeTabId).toBe('t-a');
    expect('activeTabId' in request.specs[1]).toBe(false);
  });

  it('a window an older version left a pin out of place in sends its tabs as Chrome opens them (KAN-473)', async () => {
    handle = setupChromeFake();
    const [first, second] = SESSION.tabGroups[0].windows;
    const tab = (tabId: string, extra: object = {}) => ({
      tabId,
      favicon: '',
      title: tabId,
      url: `https://${tabId}.example/`,
      ...extra,
    });
    const outOfPlace: TabMasterContainer = {
      ...SESSION,
      tabGroups: [
        {
          ...SESSION.tabGroups[0],
          windows: [
            {
              ...first,
              tabCount: 4,
              tabs: [
                tab('u'),
                tab('p', { pinned: true }),
                tab('g', { pinned: true, chromeGroupId: 'grp' }),
                tab('h', { chromeGroupId: 'grp' }),
              ],
              chromeTabGroups: [{ groupId: 'grp', title: '', color: 'blue' }],
            },
            second,
          ],
        },
      ],
    };

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(outOfPlace));
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect(
      request.specs[0].tabs.map((t) => [t.tabId, t.pinned === true])
    ).toEqual([
      ['p', true],
      ['u', false],
      ['g', false],
      ['h', false],
    ]);
  });

  it('a window saved maximized sends its state in its spec; one without sends none (KAN-460)', async () => {
    handle = setupChromeFake();
    const [first, second] = SESSION.tabGroups[0].windows;
    const withState: TabMasterContainer = {
      ...SESSION,
      tabGroups: [
        {
          ...SESSION.tabGroups[0],
          windows: [first, { ...second, state: 'maximized' }],
        },
      ],
    };

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(withState));
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect('state' in request.specs[0]).toBe(false);
    expect(request.specs[1].state).toBe('maximized');
  });

  it('an incognito window sends incognito in its spec; a normal one sends none (KAN-460 Part 3)', async () => {
    handle = setupChromeFake();
    const [first, second] = SESSION.tabGroups[0].windows;
    const withIncognito: TabMasterContainer = {
      ...SESSION,
      tabGroups: [
        {
          ...SESSION.tabGroups[0],
          windows: [first, { ...second, incognito: true }],
        },
      ],
    };

    const { store } = makeTestStore();
    store.dispatch(restoreContainer(withIncognito));
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect('incognito' in request.specs[0]).toBe(false);
    expect(request.specs[1].incognito).toBe(true);
  });
});

// KAN-892. With This window chosen, Open adds to the window the page is in; the menus' other way overrides the setting.
describe('Open saved windows: This window', () => {
  let handle: ReturnType<typeof setupChromeFake> | undefined;

  beforeEach(() => {
    handle?.restore();
    handle = undefined;
  });

  // windows.getCurrent answers the first seeded window: the one the page is in.
  const inWindow7 = () =>
    setupChromeFake({
      windows: [{ id: 7, tabs: [{ id: 70, url: 'https://here.example/' }] }],
    });
  const storeWith = (where: OpenSavedWindowsIn) => {
    const { store } = makeTestStore();
    store.dispatch(restoreContainer(SESSION));
    store.dispatch(setOpenSavedWindowsIn(where));
    return store;
  };
  const onlyRequest = (h: ReturnType<typeof setupChromeFake>) => {
    expect(h.sentMessages).toHaveLength(1);
    return h.sentMessages[0];
  };

  it('Open session sends one open-into-window message for the current window, with every window, pinTabKeeper as set', async () => {
    handle = inWindow7();
    const store = storeWith('this-window');
    store.dispatch(setPinTabKeeperInNewWindows(true));
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = onlyRequest(handle);
    expect(isOpenIntoWindowRequest(request)).toBe(true);
    expect(request).toEqual({
      type: OPEN_INTO_WINDOW_MESSAGE,
      windowId: 7,
      activate: true,
      goToURLText: GO_TO_URL_TEXT,
      pinTabKeeper: true,
      specs: [
        expect.objectContaining({ focused: true }),
        expect.objectContaining({ focused: false }),
      ],
    });
    expect(
      (request as OpenIntoWindowRequest).specs.map((s) => s.tabs[0].url)
    ).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('Open on a saved window sends that window only, into the current window', async () => {
    handle = inWindow7();
    const store = storeWith('this-window');
    await store.dispatch(
      openTabsInAWindow({
        tabGroupId: 'group-1',
        windowId: 'w-b',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = onlyRequest(handle) as OpenIntoWindowRequest;
    expect(request.type).toBe(OPEN_INTO_WINDOW_MESSAGE);
    expect(request.windowId).toBe(7);
    expect(request.activate).toBe(true);
    expect(request.pinTabKeeper).toBe(false);
    expect(request.specs.map((s) => s.tabs.map((t) => t.url))).toEqual([
      ['https://b.example/'],
    ]);
  });

  it.each(['openTabsInAWindow', 'openAllTabContainer'])(
    "%s with where: 'new-window' overrides This window (the menu's other way)",
    async (name) => {
      handle = inWindow7();
      const store = storeWith('this-window');
      const params = {
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
        where: 'new-window' as const,
      };
      await store.dispatch(
        name === 'openTabsInAWindow'
          ? openTabsInAWindow({ ...params, windowId: 'w-b' })
          : openAllTabContainer(params)
      );

      expect(firstSentRequest(handle).type).toBe(RESTORE_SESSION_MESSAGE);
    }
  );

  it.each([
    ['openTabsInAWindow', 1],
    ['openAllTabContainer', 2],
  ])(
    "%s with where: 'this-window' overrides New window",
    async (name, specCount) => {
      handle = inWindow7();
      const store = storeWith('new-window');
      const params = {
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
        where: 'this-window' as const,
      };
      await store.dispatch(
        name === 'openTabsInAWindow'
          ? openTabsInAWindow({ ...params, windowId: 'w-b' })
          : openAllTabContainer(params)
      );

      const request = onlyRequest(handle) as OpenIntoWindowRequest;
      expect(request.type).toBe(OPEN_INTO_WINDOW_MESSAGE);
      expect(request.windowId).toBe(7);
      expect(request.specs).toHaveLength(specCount);
    }
  );

  it("New window chosen and no where: today's restore, and the current window is never asked", async () => {
    handle = inWindow7();
    const asked = vi.spyOn(chrome.windows, 'getCurrent');
    const store = storeWith('new-window');
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    expect(firstSentRequest(handle).type).toBe(RESTORE_SESSION_MESSAGE);
    expect(asked).not.toHaveBeenCalled();
  });

  it('falls back to restore-session when getCurrent answers nothing', async () => {
    // No window seeded: getCurrent answers undefined.
    handle = setupChromeFake();
    const store = storeWith('this-window');
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    const request = firstSentRequest(handle);
    expect(request.type).toBe(RESTORE_SESSION_MESSAGE);
    expect(request.closeOtherWindows).toBe(false);
    expect(request.specs).toHaveLength(2);
  });

  it('falls back to restore-session when getCurrent throws', async () => {
    handle = inWindow7();
    vi.spyOn(chrome.windows, 'getCurrent').mockRejectedValue(
      new Error('No current window')
    );
    const store = storeWith('this-window');
    await store.dispatch(
      openTabsInAWindow({
        tabGroupId: 'group-1',
        windowId: 'w-a',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    expect(firstSentRequest(handle).type).toBe(RESTORE_SESSION_MESSAGE);
  });

  it('a session that is not there sends nothing and asks nothing', async () => {
    handle = inWindow7();
    const asked = vi.spyOn(chrome.windows, 'getCurrent');
    const store = storeWith('this-window');
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'missing',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    expect(handle.sentMessages).toEqual([]);
    expect(asked).not.toHaveBeenCalled();
  });

  it('notes the review moment as Open into a new window does', async () => {
    handle = inWindow7();
    const store = storeWith('this-window');
    await store.dispatch(
      openAllTabContainer({
        tabGroupId: 'group-1',
        goToURLText: GO_TO_URL_TEXT,
      })
    );

    expect(
      store.getState().settingsDataState.pendingReviewAsk?.moment.kind
    ).toBe('restored');
  });
});
