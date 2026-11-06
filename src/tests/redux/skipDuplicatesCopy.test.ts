import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// common.ts reads window.screen at module load, and showSession and
// isTabView read window.location.search. In node, window is made globalThis itself.
const location = vi.hoisted(() => ({ search: '' }));
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
    location,
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
}));

import type { TFunction } from 'i18next';

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  type TabMasterContainer,
  type tabData,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';
import { setSkipDuplicateTabs } from '../../redux/slices/settingsDataStateSlice';
import { resetHistory, undo } from '../../redux/slices/undoRedoSlice';
import type { CarriedPick, LiveSnapshot } from '../../redux/carriedItem';
import {
  copyOnSessionRow,
  copyToSpot,
  copyWindowTo,
} from '../../redux/copyToSession';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';
import {
  T0,
  container,
  s3,
  session,
  sessionIn,
  win,
} from '../fixtures/sessionMoveFixture';
import {
  LIVE_GROUP,
  liveTab,
  snapshotWindow,
} from '../fixtures/liveSnapshotFixture';
import { tFor } from '../setup/localeT';

// KAN-906. A copy from Currently open into a saved session leaves out pages the session has while Skip duplicate tabs is on.

type Store = ReturnType<typeof makeTestStore>['store'];

const A = 'https://a.test/';
const B = 'https://b.test/';
const C = 'https://c.test/';

const porto = (...saved: tabData[]) =>
  session('P', 'Porto weekend', T0, [win('pw', saved)]);

// P not selected, so every copy toast carries Show.
const ready = (on: boolean, ...saved: tabData[]): Store => {
  const { store } = makeTestStore();
  store.dispatch(replaceState(container([s3(), porto(...saved)])));
  store.dispatch(
    resetHistory({
      tabContainerDataState: store.getState().tabContainerDataState,
    })
  );
  store.dispatch(setIsNotDirty());
  store.dispatch(setSkipDuplicateTabs(on));
  return store;
};

const data = (store: Store) => store.getState().tabContainerDataState;
const portoIn = (store: Store) => sessionIn(data(store), 'P');
const urls = (w: windowGroupData) => w.tabs.map((t) => t.url);

const toasts = (store: Store) =>
  store.getState().globalState.toasts.map((t) => ({
    text: t.text,
    params: t.params,
    show: t.show,
    leftOut: t.leftOut,
  }));

const liveOf = (pick: CarriedPick, window: windowGroupData): LiveSnapshot => ({
  pick,
  window,
  chromeWindowId: 7,
});

const LIVE_WINDOW: CarriedPick = { kind: 'window', windowId: 'live-w' };
const LIVE_GROUP_PICK: CarriedPick = {
  kind: 'group',
  windowId: 'live-w',
  groupId: 'lg',
};
const tabPick = (tabId: string): CarriedPick => ({
  kind: 'tab',
  windowId: 'live-w',
  tabId,
});

// The live window [a, b, b, c].
const abbc = () =>
  snapshotWindow([
    liveTab('la', A),
    liveTab('lb1', B),
    liveTab('lb2', B),
    liveTab('lc', C),
  ]);

// What the person reads: the toast's text, then its left-out sentence (Toast.tsx).
let t: TFunction;
const reads = (toast: ReturnType<typeof toasts>[number]) =>
  [
    t(toast.text, toast.params ?? {}),
    ...(toast.leftOut > 0
      ? [t('DuplicateTabsLeftOut', { count: toast.leftOut })]
      : []),
  ].join(' ');

function readLocalStorageContainer(): TabMasterContainer {
  const stored = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(stored)) {
    throw new Error('tabContainerData in localStorage is not valid');
  }
  return stored;
}

beforeEach(async () => {
  t = await tFor('en');
  localStorage.clear();
  location.search = '';
});
afterEach(() => localStorage.clear());

describe('On: a copy leaves out what the session has (KAN-906)', () => {
  it('a live tab the session has: nothing changes, false, "already has this tab"', () => {
    const store = ready(true, liveTab('pa', A));
    const before = data(store);
    const stored = localStorage.getItem('tabContainerData');
    const past = store.getState().undoRedo.past.length;
    const live = liveOf(tabPick('la'), abbc());

    expect(store.dispatch(copyOnSessionRow(live, 'P'))).toBe(false);

    expect(data(store)).toBe(before);
    expect(localStorage.getItem('tabContainerData')).toBe(stored);
    expect(store.getState().undoRedo.past).toHaveLength(past);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.SESSION_ALREADY_HAS_THIS_TAB,
        params: { title: 'Porto weekend' },
        show: { tabGroupId: 'P' },
        leftOut: 0,
      },
    ]);
    expect(reads(toasts(store)[0])).toBe(
      '“Porto weekend” already has this tab.'
    );
  });

  it('a live window [a, b, b, c] onto a session with a: a new window [b, c], 2 left out', () => {
    const store = ready(true, liveTab('pa', A));
    expect(
      store.dispatch(copyOnSessionRow(liveOf(LIVE_WINDOW, abbc()), 'P'))
    ).toBe(true);

    const [landed, saved] = portoIn(store).windows;
    expect(urls(landed)).toEqual([B, C]);
    expect(urls(saved)).toEqual([A]);
    expect(landed.tabCount).toBe(2);
    expect(portoIn(store).tabCount).toBe(3);
    expect(portoIn(store).windowCount).toBe(2);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TABS_TO_SESSION,
        params: { title: 'Porto weekend', count: 2 },
        show: { tabGroupId: 'P' },
        leftOut: 2,
      },
    ]);
    expect(reads(toasts(store)[0])).toBe(
      'Copied 2 tabs to “Porto weekend”. 2 duplicate tabs left out.'
    );
  });

  it('a live group of [a] into a session with a: nothing changes, "already has these tabs"', () => {
    const store = ready(true, liveTab('pa', A));
    const before = data(store);
    const live = liveOf(
      LIVE_GROUP_PICK,
      snapshotWindow(
        [liveTab('lg1', A, { chromeGroupId: 'lg' }), liveTab('lx', B)],
        [LIVE_GROUP]
      )
    );

    expect(
      store.dispatch(
        copyToSpot(live, { tabGroupId: 'P', toWindowId: 'pw', toIndex: 1 })
      )
    ).toBe(false);

    expect(data(store)).toBe(before);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.SESSION_ALREADY_HAS_THESE_TABS,
        params: { title: 'Porto weekend' },
        show: { tabGroupId: 'P' },
        leftOut: 0,
      },
    ]);
    expect(reads(toasts(store)[0])).toBe(
      '“Porto weekend” already has these tabs.'
    );
  });

  it('a live window whose every tab the session has: nothing changes, "already has these tabs"', () => {
    const store = ready(true, liveTab('pa', A), liveTab('pb', B));
    const before = data(store);
    const live = liveOf(
      LIVE_WINDOW,
      snapshotWindow([liveTab('la', A), liveTab('lb', B), liveTab('la2', A)])
    );

    expect(
      store.dispatch(copyWindowTo(live, { tabGroupId: 'P', toIndex: 1 }))
    ).toBe(false);

    expect(data(store)).toBe(before);
    expect(toasts(store).map((x) => x.text)).toEqual([
      TOAST_MESSAGES.SESSION_ALREADY_HAS_THESE_TABS,
    ]);
  });

  it('the setting turned on after pick-up is honoured at the drop', () => {
    const store = ready(false, liveTab('pa', A));
    // Picked up while Off.
    const live = liveOf(tabPick('la'), abbc());
    store.dispatch(setSkipDuplicateTabs(true));
    const before = data(store);

    expect(store.dispatch(copyOnSessionRow(live, 'P'))).toBe(false);
    expect(data(store)).toBe(before);
    expect(toasts(store).map((x) => x.text)).toEqual([
      TOAST_MESSAGES.SESSION_ALREADY_HAS_THIS_TAB,
    ]);
  });

  it('the session as it is at the drop: a page another page added while carried is left out', () => {
    const store = ready(true, liveTab('pa', A));
    const live = liveOf(LIVE_WINDOW, abbc());
    // Another page's write while carried: P gains c. The drop re-reads storage first (D9).
    const local = readLocalStorageContainer();
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify({
        ...local,
        lastModified: T0 + 60_000,
        tabGroups: local.tabGroups.map((g) =>
          g.tabGroupId === 'P' ? porto(liveTab('pa', A), liveTab('pc', C)) : g
        ),
      })
    );

    expect(store.dispatch(copyOnSessionRow(live, 'P'))).toBe(true);
    expect(urls(portoIn(store).windows[0])).toEqual([B]);
    expect(toasts(store)[0]).toMatchObject({
      params: { title: 'Porto weekend', count: 1 },
      leftOut: 3,
    });
  });

  it('a group copies only its own repeats: an unpicked tab with the same page does not knock it out', () => {
    const store = ready(true, liveTab('pa', A));
    const live = liveOf(
      LIVE_GROUP_PICK,
      snapshotWindow(
        [
          liveTab('lx', B),
          liveTab('lg1', B, { chromeGroupId: 'lg' }),
          liveTab('lg2', A, { chromeGroupId: 'lg' }),
        ],
        [LIVE_GROUP]
      )
    );

    expect(store.dispatch(copyOnSessionRow(live, 'P'))).toBe(true);
    const [landed] = portoIn(store).windows;
    expect(landed.tabs.map((x) => x.tabId)).toEqual(['lg1']);
    expect(landed.chromeTabGroups?.map((g) => g.groupId)).toEqual(['lg']);
    expect(toasts(store)[0]).toMatchObject({
      params: { count: 1 },
      leftOut: 1,
    });
  });

  it('a lone tab of a split pair is compared on its own: its twin does not come with it', () => {
    const store = ready(true, liveTab('pa', A));
    const live = liveOf(
      tabPick('la'),
      snapshotWindow([
        liveTab('la', A, { splitId: 'sp' }),
        liveTab('lb', B, { splitId: 'sp' }),
      ])
    );
    expect(store.dispatch(copyOnSessionRow(live, 'P'))).toBe(false);
    expect(toasts(store).map((x) => x.text)).toEqual([
      TOAST_MESSAGES.SESSION_ALREADY_HAS_THIS_TAB,
    ]);
  });

  it('a tab the session lacks: today\'s "Copied to" toast, unchanged', () => {
    const store = ready(true, liveTab('pa', A));
    expect(
      store.dispatch(copyOnSessionRow(liveOf(tabPick('lc'), abbc()), 'P'))
    ).toBe(true);
    expect(urls(portoIn(store).windows[0])).toEqual([C]);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TO_SESSION,
        params: { title: 'Porto weekend' },
        show: { tabGroupId: 'P' },
        leftOut: 0,
      },
    ]);
  });

  it('undo after a copy that left tabs out restores the session', () => {
    const store = ready(true, liveTab('pa', A));
    const before = portoIn(store);
    store.dispatch(copyOnSessionRow(liveOf(LIVE_WINDOW, abbc()), 'P'));
    store.dispatch(undo());
    // Undo re-stamps lastModified; the content is what counts.
    expect(portoIn(store).windows).toEqual(before.windows);
    expect(portoIn(store).tabCount).toBe(before.tabCount);
  });
});

describe('Off: a copy lands as today, duplicates included (KAN-608)', () => {
  it('a live tab the session has is copied, "Copied to"', () => {
    const store = ready(false, liveTab('pa', A));
    expect(
      store.dispatch(copyOnSessionRow(liveOf(tabPick('la'), abbc()), 'P'))
    ).toBe(true);
    expect(portoIn(store).windows.map(urls)).toEqual([[A], [A]]);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TO_SESSION,
        params: { title: 'Porto weekend' },
        show: { tabGroupId: 'P' },
        leftOut: 0,
      },
    ]);
  });

  it('a live window [a, b, b, c] lands whole, "Copied 4 tabs"', () => {
    const store = ready(false, liveTab('pa', A));
    expect(
      store.dispatch(copyOnSessionRow(liveOf(LIVE_WINDOW, abbc()), 'P'))
    ).toBe(true);
    expect(urls(portoIn(store).windows[0])).toEqual([A, B, B, C]);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TABS_TO_SESSION,
        params: { title: 'Porto weekend', count: 4 },
        show: { tabGroupId: 'P' },
        leftOut: 0,
      },
    ]);
  });

  it('a live group of [a] lands in a session with a', () => {
    const store = ready(false, liveTab('pa', A));
    const live = liveOf(
      LIVE_GROUP_PICK,
      snapshotWindow([liveTab('lg1', A, { chromeGroupId: 'lg' })], [LIVE_GROUP])
    );
    expect(
      store.dispatch(
        copyToSpot(live, { tabGroupId: 'P', toWindowId: 'pw', toIndex: 1 })
      )
    ).toBe(true);
    expect(urls(portoIn(store).windows[0])).toEqual([A, A]);
  });
});

describe('a split pair copied with Skip duplicate tabs on (KAN-486)', () => {
  const PAIR: CarriedPick = {
    kind: 'pair',
    windowId: 'live-w',
    tabId: 'la',
    partnerTabId: 'lb',
  };
  const pairWindow = () =>
    snapshotWindow([
      liveTab('la', A, { splitId: 'sp' }),
      liveTab('lb', B, { splitId: 'sp' }),
      liveTab('lc', C),
    ]);
  const spot = { tabGroupId: 'P', toWindowId: 'pw', toIndex: 0 };

  it('with one repeat, the pair lands whole', () => {
    const store = ready(true, { tabId: 'x', favicon: '', title: 'A', url: A });
    store.dispatch(copyToSpot(liveOf(PAIR, pairWindow()), spot));
    expect(urls(portoIn(store).windows[0])).toEqual([A, B, A]);
  });

  it('with both halves repeated, nothing lands and the toast says so', () => {
    const store = ready(
      true,
      { tabId: 'x', favicon: '', title: 'A', url: A },
      { tabId: 'y', favicon: '', title: 'B', url: B }
    );
    expect(store.dispatch(copyToSpot(liveOf(PAIR, pairWindow()), spot))).toBe(
      false
    );
    expect(urls(portoIn(store).windows[0])).toEqual([A, B]);
    expect(toasts(store).map((toast) => toast.text)).toEqual([
      TOAST_MESSAGES.SESSION_ALREADY_HAS_THESE_TABS,
    ]);
  });

  it('a copy says how many tabs it landed', () => {
    const store = ready(false, { tabId: 'x', favicon: '', title: 'C', url: C });
    store.dispatch(copyToSpot(liveOf(PAIR, pairWindow()), spot));
    expect(toasts(store)[0]).toMatchObject({
      text: TOAST_MESSAGES.COPIED_TABS_TO_SESSION,
      params: { count: 2 },
    });
  });

  it('undo removes both', () => {
    const store = ready(false, { tabId: 'x', favicon: '', title: 'C', url: C });
    store.dispatch(copyToSpot(liveOf(PAIR, pairWindow()), spot));
    expect(urls(portoIn(store).windows[0])).toEqual([A, B, C]);
    store.dispatch(undo());
    expect(urls(portoIn(store).windows[0])).toEqual([C]);
  });
});
