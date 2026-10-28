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
import { onTabMovesEnded } from '../../redux/undoHistory';
import {
  restoreContainer,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
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
  it('a tab: just that tab, unfocused, no bounds, no state, no split', () => {
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
      focused: false,
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
      focused: false,
      bounds: null,
    });
  });

  it('a window: as Open makes it, unfocused and in the normal state, splits kept', () => {
    const spec = copyWindowSpec(savedWindow(), {
      kind: 'window',
      windowId: 'w1',
    });
    expect(spec?.focused).toBe(false);
    expect(spec).not.toHaveProperty('state');
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

  it('a new window: one unfocused restore, nothing closed, the pin setting passed', async () => {
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
    expect(restores()[0].specs[0]).not.toHaveProperty('state');
    expect(restores()[0].specs[0].focused).toBe(false);
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
  });
});
