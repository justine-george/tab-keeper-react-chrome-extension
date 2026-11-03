import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import { liveItem, savedItem } from '../../redux/carriedItem';
import type { CarriedItem } from '../../redux/carriedItem';
import { copyWindowSpec, openCarriedCopy } from '../../redux/openCopy';
import {
  clearNewWindowFollow,
  pendingNewWindow,
} from '../../redux/newWindowFollow';
import { onTabMovesEnded } from '../../redux/undoHistory';
import {
  restoreContainer,
  toWindowSpec,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setSkipTabsAlreadyOpen } from '../../redux/slices/settingsDataStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import { subscribeArrival } from '../../utils/functions/arrival';
import {
  isOpenIntoWindowRequest,
  OPEN_INTO_WINDOW_MESSAGE,
} from '../../utils/functions/openIntoWindow';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';
import { RESTORE_SESSION_MESSAGE } from '../../utils/functions/windows';
import type { RestoreSessionRequest } from '../../utils/functions/windows';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle } from '../setup/chrome.fake';
import { makeTestStore } from '../setup/makeStore';

// KAN-815. A saved tab, group or window let go over Currently open opens a
// copy in Chrome, in the background. The saved session never changes.

const GO_TO = 'Go to page';

// w1: t1 pinned, t2 (a split pair with t1's neighbour t3), ga + gb in group g1.
const savedWindow = (more: Partial<windowGroupData> = {}): windowGroupData => ({
  windowId: 'w1',
  windowHeight: 700,
  windowWidth: 900,
  windowOffsetTop: 10,
  windowOffsetLeft: 20,
  tabCount: 5,
  title: '',
  tabs: [
    {
      tabId: 't1',
      favicon: '',
      title: 'One',
      url: 'https://one.example/',
      pinned: true,
    },
    {
      tabId: 't2',
      favicon: '',
      title: 'Two',
      url: 'https://two.example/',
      splitId: 'sp',
    },
    {
      tabId: 't3',
      favicon: '',
      title: 'Three',
      url: 'https://three.example/',
      splitId: 'sp',
    },
    {
      tabId: 'ga',
      favicon: '',
      title: 'A',
      url: 'https://a.example/',
      chromeGroupId: 'g1',
      splitId: 'sq',
    },
    {
      tabId: 'gb',
      favicon: '',
      title: 'B',
      url: 'https://b.example/',
      chromeGroupId: 'g1',
      splitId: 'sq',
    },
  ],
  chromeTabGroups: [
    { groupId: 'g1', title: 'Work', color: 'blue', collapsed: true },
  ],
  state: 'maximized',
  ...more,
});

const SESSION = 'S1';
const tabItem = (tabId = 't2', tabGroupId = SESSION): CarriedItem =>
  savedItem({ kind: 'tab', tabGroupId, windowId: 'w1', tabId });
const groupItem: CarriedItem = savedItem({
  kind: 'group',
  tabGroupId: SESSION,
  windowId: 'w1',
  groupId: 'g1',
});
const windowItem: CarriedItem = savedItem({
  kind: 'window',
  tabGroupId: SESSION,
  windowId: 'w1',
});

let handle: ChromeFakeHandle | undefined;

beforeEach(() => {
  localStorage.clear();
  handle = setupChromeFake({
    windows: [{ id: 1, tabs: [{ id: 11, active: true }, { id: 12 }] }],
  });
});
afterEach(() => {
  handle?.restore();
  handle = undefined;
});

const ready = (tabGroupId = SESSION, window = savedWindow()) => {
  const made = makeTestStore();
  made.store.dispatch(
    restoreContainer(
      buildContainer([buildSession({ tabGroupId, windows: [window] })])
    )
  );
  return made;
};

const restores = () =>
  (handle?.sentMessages ?? []).filter(
    (m): m is RestoreSessionRequest =>
      (m as { type?: unknown }).type === RESTORE_SESSION_MESSAGE
  );

describe('copyWindowSpec', () => {
  // KAN-853. Every new window comes to the front.
  it('a tab: just that tab, focused, no bounds, no state, no split', () => {
    expect(
      copyWindowSpec(savedWindow(), {
        kind: 'tab',
        windowId: 'w1',
        tabId: 't2',
      })
    ).toEqual({
      tabs: [
        { tabId: 't2', favicon: '', title: 'Two', url: 'https://two.example/' },
      ],
      focused: true,
      bounds: null,
    });
  });

  it('a tab keeps its saved pin', () => {
    expect(
      copyWindowSpec(savedWindow(), {
        kind: 'tab',
        windowId: 'w1',
        tabId: 't1',
      })?.tabs[0].pinned
    ).toBe(true);
  });

  it('a group: its tabs in order, unpinned, unsplit, and its look without the collapse', () => {
    const window = savedWindow();
    window.tabs[3] = { ...window.tabs[3], pinned: true };
    expect(
      copyWindowSpec(window, { kind: 'group', windowId: 'w1', groupId: 'g1' })
    ).toEqual({
      tabs: [
        {
          tabId: 'ga',
          favicon: '',
          title: 'A',
          url: 'https://a.example/',
          chromeGroupId: 'g1',
        },
        {
          tabId: 'gb',
          favicon: '',
          title: 'B',
          url: 'https://b.example/',
          chromeGroupId: 'g1',
        },
      ],
      groups: [{ groupId: 'g1', title: 'Work', color: 'blue' }],
      focused: true,
      bounds: null,
    });
  });

  // KAN-853. In front, so its saved state comes back too.
  it('a window: as Open makes it, focused, its saved state and splits kept', () => {
    const spec = copyWindowSpec(savedWindow(), {
      kind: 'window',
      windowId: 'w1',
    });
    expect(spec?.focused).toBe(true);
    expect(spec?.state).toBe('maximized');
    expect(spec?.bounds).toEqual({
      height: 700,
      width: 900,
      top: 10,
      left: 20,
    });
    expect(spec?.tabs.map((t) => t.splitId)).toEqual([
      undefined,
      'sp',
      'sp',
      'sq',
      'sq',
    ]);
    expect(spec?.groups).toEqual([
      { groupId: 'g1', title: 'Work', color: 'blue', collapsed: true },
    ]);
  });

  it('every kind keeps the incognito mark', () => {
    const window = savedWindow({ incognito: true });
    expect(
      copyWindowSpec(window, { kind: 'tab', windowId: 'w1', tabId: 't2' })
        ?.incognito
    ).toBe(true);
    expect(
      copyWindowSpec(window, { kind: 'group', windowId: 'w1', groupId: 'g1' })
        ?.incognito
    ).toBe(true);
    expect(
      copyWindowSpec(window, { kind: 'window', windowId: 'w1' })?.incognito
    ).toBe(true);
    expect(
      copyWindowSpec(savedWindow(), {
        kind: 'tab',
        windowId: 'w1',
        tabId: 't2',
      })
    ).not.toHaveProperty('incognito');
  });

  it('null for a tab or group the window no longer holds', () => {
    expect(
      copyWindowSpec(savedWindow(), {
        kind: 'tab',
        windowId: 'w1',
        tabId: 'gone',
      })
    ).toBeNull();
    expect(
      copyWindowSpec(savedWindow(), {
        kind: 'group',
        windowId: 'w1',
        groupId: 'gone',
      })
    ).toBeNull();
  });
});

describe('openCarriedCopy', () => {
  const reviewAsks = (actions: { type: string }[]) =>
    actions.filter((a) => a.type.endsWith('setPendingReviewAsk')).length;

  it('a new window: one focused restore, nothing closed, the pin setting passed', async () => {
    const { store } = ready();
    const before = store.getState().tabContainerDataState;

    const asked = store.dispatch(
      openCarriedCopy(tabItem(), { kind: 'newWindow' }, GO_TO)
    );

    // The worker's restore sends no answer: taken as opened.
    await expect(asked).resolves.toBe(true);
    expect(restores()).toEqual([
      {
        type: RESTORE_SESSION_MESSAGE,
        specs: [
          copyWindowSpec(savedWindow(), {
            kind: 'tab',
            windowId: 'w1',
            tabId: 't2',
          }),
        ],
        goToURLText: GO_TO,
        closeOtherWindows: false,
        pinTabKeeper: false,
      },
    ]);
    expect(store.getState().tabContainerDataState).toEqual(before);
  });

  it('a window carry opens a new window too', async () => {
    const { store } = ready();

    await expect(
      store.dispatch(openCarriedCopy(windowItem, { kind: 'newWindow' }, GO_TO))
    ).resolves.toBe(true);
    // KAN-853. In front, its saved state kept.
    expect(restores()[0].specs[0].state).toBe('maximized');
    expect(restores()[0].specs[0].focused).toBe(true);
  });

  it('a tab at a slot opens there, in the background', async () => {
    const { store } = ready();
    const before = store.getState().tabContainerDataState;

    const asked = store.dispatch(
      openCarriedCopy(
        tabItem(),
        { kind: 'tab', slot: { windowId: 1, index: 1, pinned: false } },
        GO_TO
      )
    );

    await expect(asked).resolves.toBe(true);
    expect(handle?.createdTabs).toHaveLength(1);
    expect(handle?.createdTabs[0]).toMatchObject({
      windowId: 1,
      index: 1,
      active: false,
      url: 'https://two.example/',
    });
    expect(restores()).toEqual([]);
    expect(store.getState().tabContainerDataState).toEqual(before);
  });

  it('a group at a slot opens there as a group', async () => {
    const { store } = ready();

    const asked = store.dispatch(
      openCarriedCopy(
        groupItem,
        { kind: 'group', slot: { windowId: 1, index: 1 } },
        GO_TO
      )
    );

    await expect(asked).resolves.toBe(true);
    expect(handle?.createdTabs).toHaveLength(2);
    expect(handle?.createdTabs[0].url).toBe('https://a.example/');
    await vi.waitFor(async () =>
      expect((await chrome.tabGroups.query({})).map((g) => g.title)).toEqual([
        'Work',
      ])
    );
  });

  // KAN-850. Open now reads the copy at once, as it reads its own moves.
  describe("a copy at a slot is Tab Keeper's own move until Chrome answers", () => {
    let ended = 0;
    let stop = () => {};
    beforeEach(() => {
      ended = 0;
      stop = onTabMovesEnded(() => {
        ended += 1;
      });
    });
    afterEach(() => stop());

    it('for a tab', async () => {
      const { store } = ready();
      const asked = store.dispatch(
        openCarriedCopy(
          tabItem(),
          { kind: 'tab', slot: { windowId: 1, index: 1, pinned: false } },
          GO_TO
        )
      );
      expect(ended).toBe(0);

      await asked;

      expect(ended).toBe(1);
    });

    it('for a group', async () => {
      const { store } = ready();

      await store.dispatch(
        openCarriedCopy(
          groupItem,
          { kind: 'group', slot: { windowId: 1, index: 1 } },
          GO_TO
        )
      );

      expect(ended).toBe(1);
    });

    it('not a new window, which the worker opens', async () => {
      const { store } = ready();

      await store.dispatch(
        openCarriedCopy(tabItem(), { kind: 'newWindow' }, GO_TO)
      );

      expect(ended).toBe(0);
    });
  });

  // KAN-852. Open now scrolls to the window once it is listed.
  describe('a new window is followed into view', () => {
    afterEach(() => clearNewWindowFollow());

    it('when one is asked for', () => {
      const { store } = ready();

      void store.dispatch(
        openCarriedCopy(windowItem, { kind: 'newWindow' }, GO_TO)
      );

      expect(pendingNewWindow()).not.toBeNull();
    });

    it('not for a copy at a slot', async () => {
      const { store } = ready();

      await store.dispatch(
        openCarriedCopy(
          tabItem(),
          { kind: 'tab', slot: { windowId: 1, index: 1, pinned: false } },
          GO_TO
        )
      );

      expect(pendingNewWindow()).toBeNull();
    });

    it('not when nothing is asked', () => {
      const { store } = ready();

      store.dispatch(
        openCarriedCopy(tabItem('gone'), { kind: 'newWindow' }, GO_TO)
      );

      expect(pendingNewWindow()).toBeNull();
    });
  });

  it('records the restore moment once per copy', () => {
    const { store, actions } = ready();

    store.dispatch(openCarriedCopy(tabItem(), { kind: 'newWindow' }, GO_TO));

    expect(reviewAsks(actions)).toBe(1);
    expect(
      store.getState().settingsDataState.pendingReviewAsk?.moment.kind
    ).toBe('restored');
  });

  it('a tab at a slot is a restore moment once Chrome opens it', async () => {
    const { store, actions } = ready();

    store.dispatch(
      openCarriedCopy(
        tabItem(),
        { kind: 'tab', slot: { windowId: 1, index: 1, pinned: false } },
        GO_TO
      )
    );

    await vi.waitFor(() => expect(reviewAsks(actions)).toBe(1));
  });

  // Review I2. The window let go over closed mid-carry: Chrome refuses every tab.
  describe('into a window that has since closed, no restore moment', () => {
    it('for a tab', async () => {
      const { store, actions } = ready();

      await expect(
        store.dispatch(
          openCarriedCopy(
            tabItem(),
            { kind: 'tab', slot: { windowId: 99, index: 0, pinned: false } },
            GO_TO
          )
        )
      ).resolves.toBe(false);

      expect(handle?.createdTabs).toHaveLength(1);
      await new Promise((r) => setTimeout(r, 0));
      expect(reviewAsks(actions)).toBe(0);
    });

    it('for a group', async () => {
      const { store, actions } = ready();

      // Asked of Chrome or not, nothing opened.
      await expect(
        store.dispatch(
          openCarriedCopy(
            groupItem,
            { kind: 'group', slot: { windowId: 99, index: 0 } },
            GO_TO
          )
        )
      ).resolves.toBe(false);
      expect(await chrome.tabs.query({})).toHaveLength(2);
      expect(reviewAsks(actions)).toBe(0);
    });
  });

  it("the sample opens, but isn't a restore moment", async () => {
    const sample = `${SAMPLE_ID_PREFIX}tour`;
    const { store, actions } = ready(sample);

    await expect(
      store.dispatch(
        openCarriedCopy(tabItem('t2', sample), { kind: 'newWindow' }, GO_TO)
      )
    ).resolves.toBe(true);
    expect(restores()).toHaveLength(1);
    expect(reviewAsks(actions)).toBe(0);
  });

  describe('asks nothing, and answers null', () => {
    const expectRefused = (
      item: CarriedItem,
      place: Parameters<typeof openCarriedCopy>[1]
    ) => {
      const { store, actions } = ready();
      expect(store.dispatch(openCarriedCopy(item, place, GO_TO))).toBeNull();
      expect(restores()).toEqual([]);
      expect(handle?.createdTabs).toEqual([]);
      expect(reviewAsks(actions)).toBe(0);
    };

    it('for a live item', () =>
      expectRefused(
        liveItem({
          pick: { kind: 'tab', windowId: 'w1', tabId: 't2' },
          window: savedWindow(),
          chromeWindowId: 1,
        }),
        { kind: 'newWindow' }
      ));

    it('for an item no longer stored', () =>
      expectRefused(tabItem('gone'), { kind: 'newWindow' }));

    it('for a session no longer stored', () =>
      expectRefused(tabItem('t2', 'other'), { kind: 'newWindow' }));

    it('for a window at a slot', () =>
      expectRefused(windowItem, {
        kind: 'tab',
        slot: { windowId: 1, index: 0, pinned: false },
      }));

    it('for a tab at a group slot', () =>
      expectRefused(tabItem(), {
        kind: 'group',
        slot: { windowId: 1, index: 0 },
      }));

    it('for a tab into a window', () =>
      expectRefused(tabItem(), { kind: 'intoWindow', windowId: 1 }));

    it('for a group into a window', () =>
      expectRefused(groupItem, { kind: 'intoWindow', windowId: 1 }));
  });

  // KAN-892 D. A saved window let go on an open window: the worker adds its
  // tabs there, nothing taking focus, and answers with their ids.
  describe('a window into an open window', () => {
    const intoWindows = () =>
      (handle?.sentMessages ?? []).filter(isOpenIntoWindowRequest);
    // The worker's answer, as background.ts sends it.
    const answerWith = (answer: unknown) =>
      chrome.runtime.onMessage.addListener((message, _sender, respond) => {
        if (!isOpenIntoWindowRequest(message)) return false;
        respond(answer);
        return true;
      });
    const found = (ids: number[]) => ({ ids, leftOut: 0, alreadyOpen: [] });
    let heard: { windowId: number; tabIds: number[] }[] = [];
    let stopHearing = () => {};
    let ended = 0;
    let stopEnded = () => {};
    beforeEach(() => {
      heard = [];
      stopHearing = subscribeArrival((a) => heard.push(a));
      ended = 0;
      stopEnded = onTabMovesEnded(() => {
        ended += 1;
      });
    });
    afterEach(() => {
      stopHearing();
      stopEnded();
    });

    it('asks the worker once: that window, the saved window unfocused, nothing activated, the pin setting', async () => {
      answerWith(found([31, 32, 33, 34, 35]));
      const { store } = ready();
      const before = store.getState().tabContainerDataState;

      await store.dispatch(
        openCarriedCopy(windowItem, { kind: 'intoWindow', windowId: 1 }, GO_TO)
      );

      expect(intoWindows()).toEqual([
        {
          type: OPEN_INTO_WINDOW_MESSAGE,
          windowId: 1,
          specs: [toWindowSpec(savedWindow(), false)],
          goToURLText: GO_TO,
          activate: false,
          pinTabKeeper: false,
          skipTabsAlreadyOpen: false,
        },
      ]);
      expect(intoWindows()[0].specs[0].focused).toBe(false);
      expect(restores()).toEqual([]);
      expect(store.getState().tabContainerDataState).toEqual(before);
    });

    it("the worker's ids: opened, a restore moment, and the arrival told", async () => {
      answerWith(found([31, 32]));
      const { store, actions } = ready();

      await expect(
        store.dispatch(
          openCarriedCopy(
            windowItem,
            { kind: 'intoWindow', windowId: 1 },
            GO_TO
          )
        )
      ).resolves.toBe(true);

      expect(heard).toEqual([{ windowId: 1, tabIds: [31, 32] }]);
      expect(reviewAsks(actions)).toBe(1);
    });

    it("is Tab Keeper's own move until the worker answers", async () => {
      answerWith(found([31]));
      const { store } = ready();

      const asked = store.dispatch(
        openCarriedCopy(windowItem, { kind: 'intoWindow', windowId: 1 }, GO_TO)
      );
      expect(ended).toBe(0);
      await asked;

      expect(ended).toBe(1);
    });

    for (const [what, answer] of [
      ['no tab ids', found([])],
      ['the old bare list of ids', [31, 32]],
      ['no answer', undefined],
      ['an answer that is not tab ids', { ...found([]), ids: ['31'] }],
    ] as const) {
      it(`${what}: not opened here, nothing told, no restore moment`, async () => {
        answerWith(answer);
        const { store, actions } = ready();

        await expect(
          store.dispatch(
            openCarriedCopy(
              windowItem,
              { kind: 'intoWindow', windowId: 1 },
              GO_TO
            )
          )
        ).resolves.toBe(false);

        expect(heard).toEqual([]);
        expect(reviewAsks(actions)).toBe(0);
        expect(ended).toBe(1);
      });
    }

    it('the worker unreachable: not opened, and the move still ends', async () => {
      const { store } = ready();
      const send = vi
        .spyOn(chrome.runtime, 'sendMessage')
        .mockImplementation(() => Promise.reject(new Error('no worker')));

      await expect(
        store.dispatch(
          openCarriedCopy(
            windowItem,
            { kind: 'intoWindow', windowId: 1 },
            GO_TO
          )
        )
      ).resolves.toBe(false);

      expect(heard).toEqual([]);
      expect(ended).toBe(1);
      send.mockRestore();
    });
  });
});

// KAN-910. With Skip tabs already open on, a saved drop into an open window
// leaves out pages the window has, says so, and lights the rows.
describe('openCarriedCopy with Skip tabs already open', () => {
  const A = 'https://a.example/';
  const B = 'https://b.example/';
  const TWO = 'https://two.example/';
  const reviewAsks = (actions: { type: string }[]) =>
    actions.filter((a) => a.type.endsWith('setPendingReviewAsk')).length;
  const intoWindows = () =>
    (handle?.sentMessages ?? []).filter(isOpenIntoWindowRequest);
  const answerWith = (answer: unknown) =>
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (!isOpenIntoWindowRequest(message)) return false;
      respond(answer);
      return true;
    });
  // Window 1 holds a tab per address, ids 11, 12, ...
  const liveWith = (...urls: string[]) => {
    handle?.restore();
    handle = setupChromeFake({
      windows: [
        {
          id: 1,
          tabs: urls.map((url, i) => ({ id: 11 + i, url, active: i === 0 })),
        },
      ],
    });
  };
  // The group's two tabs unsplit: a split pair is left out only when both halves are open.
  const unsplitGroup = () => {
    const w = savedWindow();
    w.tabs = w.tabs.map((tab) => {
      const plain = { ...tab };
      delete plain.splitId;
      return plain;
    });
    return w;
  };
  const readyOn = (on: boolean) => {
    const made = ready(SESSION, unsplitGroup());
    made.store.dispatch(setSkipTabsAlreadyOpen(on));
    return made;
  };
  // A saved window whose only tab is the group's first (A, in g1).
  const readyOneTabOn = () => {
    const w = unsplitGroup();
    w.tabs = w.tabs.filter((tab) => tab.tabId === 'ga');
    const made = ready(SESSION, w);
    made.store.dispatch(setSkipTabsAlreadyOpen(true));
    return made;
  };
  const toasts = (store: ReturnType<typeof ready>['store']) =>
    store.getState().globalState.toasts.map((t) => ({
      text: t.text,
      params: t.params,
      leftOut: t.leftOut,
    }));
  const slot = { windowId: 1, index: 1, pinned: false };
  const groupSlot = { windowId: 1, index: 1 };
  let heard: { windowId: number; tabIds: number[] }[] = [];
  let stopHearing = () => {};
  beforeEach(() => {
    heard = [];
    stopHearing = subscribeArrival((a) => heard.push(a));
  });
  afterEach(() => stopHearing());

  describe('a window into an open window', () => {
    const drop = { kind: 'intoWindow', windowId: 1 } as const;

    it('window drop off: today', async () => {
      // Off, the worker leaves nothing out.
      answerWith({ ids: [31], leftOut: 0, alreadyOpen: [] });
      const { store } = readyOn(false);

      await expect(
        store.dispatch(openCarriedCopy(windowItem, drop, GO_TO))
      ).resolves.toBe(true);

      expect(intoWindows()[0].skipTabsAlreadyOpen).toBe(false);
      expect(heard).toEqual([{ windowId: 1, tabIds: [31] }]);
      expect(toasts(store)).toEqual([]);
    });

    it('window drop leaves some out: arrival on new ids + left-out toast', async () => {
      answerWith({ ids: [31, 32], leftOut: 2, alreadyOpen: [11] });
      const { store, actions } = readyOn(true);

      await expect(
        store.dispatch(openCarriedCopy(windowItem, drop, GO_TO))
      ).resolves.toBe(true);

      expect(intoWindows()[0].skipTabsAlreadyOpen).toBe(true);
      expect(heard).toEqual([{ windowId: 1, tabIds: [31, 32] }]);
      expect(toasts(store)).toMatchObject([
        { text: TOAST_MESSAGES.DUPLICATE_TABS_LEFT_OUT, params: { count: 2 } },
      ]);
      expect(reviewAsks(actions)).toBe(1);
    });

    it('two window drops that leave some out: two left-out toasts, stacked', async () => {
      answerWith({ ids: [31, 32], leftOut: 2, alreadyOpen: [11] });
      const { store } = readyOn(true);

      await store.dispatch(openCarriedCopy(windowItem, drop, GO_TO));
      await store.dispatch(openCarriedCopy(windowItem, drop, GO_TO));

      expect(toasts(store)).toMatchObject([
        { text: TOAST_MESSAGES.DUPLICATE_TABS_LEFT_OUT, params: { count: 2 } },
        { text: TOAST_MESSAGES.DUPLICATE_TABS_LEFT_OUT, params: { count: 2 } },
      ]);
    });

    it('window drop all open: arrival on open copies + "these tabs" toast, resolves true, no review moment', async () => {
      answerWith({ ids: [], leftOut: 5, alreadyOpen: [11, 12] });
      const { store, actions } = readyOn(true);

      await expect(
        store.dispatch(openCarriedCopy(windowItem, drop, GO_TO))
      ).resolves.toBe(true);

      expect(heard).toEqual([{ windowId: 1, tabIds: [11, 12] }]);
      expect(toasts(store)).toMatchObject([
        { text: 'This window already has these tabs.' },
      ]);
      expect(reviewAsks(actions)).toBe(0);
    });

    it('a one-tab window drop all open: "this tab" toast', async () => {
      answerWith({ ids: [], leftOut: 1, alreadyOpen: [11] });
      const { store } = readyOneTabOn();

      await expect(
        store.dispatch(openCarriedCopy(windowItem, drop, GO_TO))
      ).resolves.toBe(true);

      expect(heard).toEqual([{ windowId: 1, tabIds: [11] }]);
      expect(toasts(store)).toMatchObject([
        { text: 'This window already has this tab.' },
      ]);
    });
  });

  describe('a window drop with some tabs refused', () => {
    it('is a refusal, not "already there": no toast, no arrival, resolves false', async () => {
      // Two of the five were left out; the rest were refused.
      answerWith({ ids: [], leftOut: 2, alreadyOpen: [11] });
      const { store } = readyOn(true);

      await expect(
        store.dispatch(
          openCarriedCopy(
            windowItem,
            { kind: 'intoWindow', windowId: 1 },
            GO_TO
          )
        )
      ).resolves.toBe(false);

      expect(heard).toEqual([]);
      expect(toasts(store)).toEqual([]);
    });
  });

  describe('a tab at a slot', () => {
    it('tab drop onto a window that has it: no create, arrival on the copy, "this tab" toast', async () => {
      liveWith(A, TWO);
      const { store, actions } = readyOn(true);

      await expect(
        store.dispatch(openCarriedCopy(tabItem(), { kind: 'tab', slot }, GO_TO))
      ).resolves.toBe(true);

      expect(handle?.createdTabs).toEqual([]);
      expect(heard).toEqual([{ windowId: 1, tabIds: [12] }]);
      expect(toasts(store)).toMatchObject([
        { text: 'This window already has this tab.' },
      ]);
      expect(reviewAsks(actions)).toBe(0);
    });

    it('two drops of a tab the window has: two toasts, stacked', async () => {
      liveWith(A, TWO);
      const { store } = readyOn(true);

      await store.dispatch(
        openCarriedCopy(tabItem(), { kind: 'tab', slot }, GO_TO)
      );
      await store.dispatch(
        openCarriedCopy(tabItem(), { kind: 'tab', slot }, GO_TO)
      );

      expect(toasts(store)).toMatchObject([
        { text: 'This window already has this tab.' },
        { text: 'This window already has this tab.' },
      ]);
    });

    it('tab drop onto a window without it opens as today, no toast', async () => {
      liveWith(A, B);
      const { store } = readyOn(true);

      await expect(
        store.dispatch(openCarriedCopy(tabItem(), { kind: 'tab', slot }, GO_TO))
      ).resolves.toBe(true);

      expect(handle?.createdTabs).toHaveLength(1);
      expect(toasts(store)).toEqual([]);
    });

    it('tab drop off: opens a second copy and asks Chrome for no tab list', async () => {
      liveWith(A, TWO);
      const { store } = readyOn(false);

      await store.dispatch(
        openCarriedCopy(tabItem(), { kind: 'tab', slot }, GO_TO)
      );

      expect(handle?.createdTabs).toHaveLength(1);
      expect(handle?.tabsQueryCalls).toEqual([]);
      expect(toasts(store)).toEqual([]);
    });

    it('a split half dropped alone is judged on its page', async () => {
      liveWith(A, TWO);
      const { store } = readyOn(true);

      // t2 is half of the pair "sp": alone it opens plain, so its page counts.
      await store.dispatch(
        openCarriedCopy(tabItem('t2'), { kind: 'tab', slot }, GO_TO)
      );

      expect(handle?.createdTabs).toEqual([]);
    });

    it('a window closed mid-carry still refuses: false, no toast', async () => {
      const { store } = readyOn(true);

      await expect(
        store.dispatch(
          openCarriedCopy(
            tabItem(),
            { kind: 'tab', slot: { ...slot, windowId: 99 } },
            GO_TO
          )
        )
      ).resolves.toBe(false);

      expect(toasts(store)).toEqual([]);
    });
  });

  describe('a group at a slot', () => {
    it('group drop partial: group of the rest + left-out toast', async () => {
      liveWith(A, 'https://x.example/');
      const { store, actions } = readyOn(true);

      await expect(
        store.dispatch(
          openCarriedCopy(groupItem, { kind: 'group', slot: groupSlot }, GO_TO)
        )
      ).resolves.toBe(true);

      expect(handle?.createdTabs.map((c) => c.url)).toEqual([B]);
      await vi.waitFor(async () =>
        expect((await chrome.tabGroups.query({})).map((g) => g.title)).toEqual([
          'Work',
        ])
      );
      expect(handle?.groupedTabs).toHaveLength(1);
      expect(handle?.groupedTabs[0].tabIds).toHaveLength(1);
      expect(toasts(store)).toMatchObject([
        { text: TOAST_MESSAGES.DUPLICATE_TABS_LEFT_OUT, params: { count: 1 } },
      ]);
      expect(reviewAsks(actions)).toBe(1);
    });

    it('group drop leaves open copies in their own group', async () => {
      liveWith(A, 'https://x.example/');
      const moved: number[][] = [];
      const note = (ids: number | number[]) => moved.push([ids].flat());
      const group = vi.spyOn(chrome.tabs, 'group');
      const ungroup = vi.spyOn(chrome.tabs, 'ungroup');
      const move = vi.spyOn(chrome.tabs, 'move');
      const { store } = readyOn(true);

      await store.dispatch(
        openCarriedCopy(groupItem, { kind: 'group', slot: groupSlot }, GO_TO)
      );

      for (const spy of [group, ungroup, move]) {
        for (const call of spy.mock.calls) {
          const first: unknown = call[0];
          if (typeof first === 'number' || Array.isArray(first)) note(first);
          else if (typeof first === 'object' && first !== null)
            note((first as { tabIds?: number | number[] }).tabIds ?? []);
        }
      }
      expect(handle?.createdTabs).toHaveLength(1);
      expect(group).toHaveBeenCalled();
      expect(moved.flat()).not.toContain(11);
    });

    it('group drop all open', async () => {
      liveWith(A, B);
      const { store, actions } = readyOn(true);

      await expect(
        store.dispatch(
          openCarriedCopy(groupItem, { kind: 'group', slot: groupSlot }, GO_TO)
        )
      ).resolves.toBe(true);

      expect(handle?.createdTabs).toEqual([]);
      expect(handle?.groupedTabs).toEqual([]);
      expect(heard).toEqual([{ windowId: 1, tabIds: [11, 12] }]);
      expect(toasts(store)).toMatchObject([
        { text: 'This window already has these tabs.' },
      ]);
      expect(reviewAsks(actions)).toBe(0);
    });

    it('a one-tab group drop all open: "this tab" toast', async () => {
      liveWith(A);
      const { store } = readyOneTabOn();

      await expect(
        store.dispatch(
          openCarriedCopy(groupItem, { kind: 'group', slot: groupSlot }, GO_TO)
        )
      ).resolves.toBe(true);

      expect(handle?.createdTabs).toEqual([]);
      expect(heard).toEqual([{ windowId: 1, tabIds: [11] }]);
      expect(toasts(store)).toMatchObject([
        { text: 'This window already has this tab.' },
      ]);
    });

    it('group drop off: every tab opens', async () => {
      liveWith(A, B);
      const { store } = readyOn(false);

      await store.dispatch(
        openCarriedCopy(groupItem, { kind: 'group', slot: groupSlot }, GO_TO)
      );

      expect(handle?.createdTabs).toHaveLength(2);
      expect(toasts(store)).toEqual([]);
    });

    it('group drop off adds no tab list read', async () => {
      const reads = async (on: boolean) => {
        liveWith('https://x.example/');
        const { store } = readyOn(on);
        await store.dispatch(
          openCarriedCopy(groupItem, { kind: 'group', slot: groupSlot }, GO_TO)
        );
        return handle?.tabsQueryCalls.length ?? 0;
      };

      const off = await reads(false);
      const on = await reads(true);

      expect(on - off).toBe(1);
    });

    it('a split pair is left out only when both halves are open', async () => {
      liveWith(A);
      const made = ready();
      made.store.dispatch(setSkipTabsAlreadyOpen(true));

      await made.store.dispatch(
        openCarriedCopy(groupItem, { kind: 'group', slot: groupSlot }, GO_TO)
      );

      expect(handle?.createdTabs).toHaveLength(2);
      expect(toasts(made.store)).toEqual([]);
    });
  });
});
