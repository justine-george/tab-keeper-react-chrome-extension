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

import { makeTestStore } from '../setup/makeStore';
import {
  replaceState,
  type TabMasterContainer,
  type windowGroupData,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  peekSavedSession,
  selectReopenOfferForKey,
  setIsNotDirty,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { setFoldSavedSessionInTabView } from '../../redux/slices/settingsDataStateSlice';
import { resetHistory } from '../../redux/slices/undoRedoSlice';
import type { CarriedPick, LiveSnapshot } from '../../redux/carriedItem';
import {
  copyOnSessionRow,
  copyToNewSession,
  copyToSpot,
  copyWindowTo,
} from '../../redux/copyToSession';
import { isSessionOnScreen } from '../../redux/sessionOnScreen';
import { NEW_FIRST_WINDOW } from '../../components/home/rightpane/newWindowTarget';
import { onRevealSavedWindow } from '../../components/home/rightpane/revealSavedWindow';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import {
  isValidTabMasterContainer,
  loadFromLocalStorage,
} from '../../utils/functions/local';
import {
  T0,
  container,
  sessionIds,
  sessionIn,
  tabIds,
  windowIn,
} from '../fixtures/sessionMoveFixture';
import { live } from '../fixtures/liveSnapshotFixture';

// KAN-280 Part F Task 3. The thunks a live carry's receivers call: through
// dropOnTop like every drop, and the toasts they send (D4 A, D6 A, P10).

type Store = ReturnType<typeof makeTestStore>['store'];

const ready = (c: TabMasterContainer = container()) => {
  const made = makeTestStore();
  made.store.dispatch(replaceState(c));
  made.store.dispatch(
    resetHistory({
      tabContainerDataState: made.store.getState().tabContainerDataState,
    })
  );
  made.store.dispatch(setIsNotDirty());
  return made;
};

const data = (store: Store) => store.getState().tabContainerDataState;

const toasts = (store: Store) =>
  store.getState().globalState.toasts.map((t) => ({
    text: t.text,
    params: t.params,
    show: t.show,
  }));

function readLocalStorageContainer(): TabMasterContainer {
  const stored = loadFromLocalStorage('tabContainerData');
  if (!isValidTabMasterContainer(stored)) {
    throw new Error('tabContainerData in localStorage is not valid');
  }
  return stored;
}

const LIVE = (
  pick: CarriedPick,
  extra: Partial<windowGroupData> = {}
): LiveSnapshot => ({ pick, window: live(extra), chromeWindowId: 7 });
const L1: CarriedPick = { kind: 'tab', windowId: 'live-w', tabId: 'l1' };
const LDUP: CarriedPick = { kind: 'tab', windowId: 'live-w', tabId: 'ldup' };
const LW: CarriedPick = { kind: 'window', windowId: 'live-w' };

beforeEach(() => {
  localStorage.clear();
  location.search = '';
});

afterEach(() => {
  location.search = '';
});

describe('copyOnSessionRow: a row drop is a new first window, and says so (D4 A, D6 A)', () => {
  it('nothing skipped: "Copied to", with Show', () => {
    const { store } = ready(container(undefined, 'S1'));
    expect(store.dispatch(copyOnSessionRow(LIVE(L1), 'S2'))).toBe(true);
    expect(tabIds(sessionIn(data(store), 'S2').windows[0])).toEqual(['l1']);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TO_SESSION,
        params: { title: 'Target' },
        show: { tabGroupId: 'S2' },
      },
    ]);
  });

  // KAN-608: no duplicate check. A window holding tabs the target already has lands whole.
  it('a window lands whole, duplicates included, and says how many tabs it copied', () => {
    const { store } = ready(container(undefined, 'S1'));
    store.dispatch(copyOnSessionRow(LIVE(LW), 'S2'));
    expect(tabIds(sessionIn(data(store), 'S2').windows[0])).toEqual([
      'lp',
      'l1',
      'l1b',
      'lg1',
      'lg2',
      'ldup',
    ]);
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TABS_TO_SESSION,
        params: { title: 'Target', count: 6 },
        show: { tabGroupId: 'S2' },
      },
    ]);
  });

  // Justine, 01:31: a window or group says how many tabs; a single tab keeps "Copied to".
  it('a group says how many tabs it copied', () => {
    const { store } = ready(container(undefined, 'S1'));
    store.dispatch(
      copyOnSessionRow(
        LIVE({ kind: 'group', windowId: 'live-w', groupId: 'lg' }),
        'S2'
      )
    );
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TABS_TO_SESSION,
        params: { title: 'Target', count: 2 },
        show: { tabGroupId: 'S2' },
      },
    ]);
  });

  // Review Focus 1, reversed by KAN-608.
  it('a tab whose address the target holds is copied anyway, and so is the same tab a second time', () => {
    const { store } = ready(container(undefined, 'S1'));
    expect(store.dispatch(copyOnSessionRow(LIVE(LDUP), 'S2'))).toBe(true);
    expect(store.dispatch(copyOnSessionRow(LIVE(L1), 'S2'))).toBe(true);
    expect(store.dispatch(copyOnSessionRow(LIVE(L1), 'S2'))).toBe(true);
    const firsts = sessionIn(data(store), 'S2')
      .windows.slice(0, 3)
      .map((w) => w.tabs.map((t) => t.url));
    expect(firsts).toEqual([
      ['https://l1.test/'],
      ['https://l1.test/'],
      ['https://u1.test/'],
    ]);
    expect(toasts(store).map((t) => t.text)).toEqual([
      TOAST_MESSAGES.COPIED_TO_SESSION,
      TOAST_MESSAGES.COPIED_TO_SESSION,
      TOAST_MESSAGES.COPIED_TO_SESSION,
    ]);
  });

  // KAN-607 (Justine, 01:21): every copy toasts; on screen without Show.
  it('the session on screen, nothing skipped: "Copied to" with no Show, and the landed window is revealed', () => {
    const reveal = vi.fn();
    const off = onRevealSavedWindow(reveal);
    const { store } = ready(container(undefined, 'S2'));
    store.dispatch(copyOnSessionRow(LIVE(L1), 'S2'));
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TO_SESSION,
        params: { title: 'Target' },
        show: null,
      },
    ]);
    expect(reveal).toHaveBeenCalledWith(
      sessionIn(data(store), 'S2').windows[0].windowId
    );
    off();
  });

  it('a window becomes the first window', () => {
    const { store } = ready(container(undefined, 'S1'));
    store.dispatch(copyOnSessionRow(LIVE(LW), 'S2'));
    expect(sessionIn(data(store), 'S2').windows.map((w) => w.windowId)).toEqual(
      ['live-w', 'd1', 'd2']
    );
  });

  it('a target another page removed while carried: nothing saved, no toast', () => {
    const { store } = ready(container(undefined, 'S1'));
    // Another page's write: S2 gone. The drop re-reads storage first (D9).
    const local = readLocalStorageContainer();
    localStorage.setItem(
      'tabContainerData',
      JSON.stringify({
        ...local,
        lastModified: T0 + 60_000,
        tabGroups: local.tabGroups.filter((g) => g.tabGroupId !== 'S2'),
      })
    );
    expect(store.dispatch(copyOnSessionRow(LIVE(L1), 'S2'))).toBe(false);
    expect(sessionIds(data(store))).toEqual(['S3', 'S1']);
    expect(toasts(store)).toEqual([]);
  });
});

// KAN-349 Q1 C′. A copy is a saved change, so its toast takes ⌘Z from a Reopen offer.
describe('the copy toast and a Reopen offer (C′)', () => {
  const withOffer = async (c: TabMasterContainer) => {
    const made = ready(c);
    await made.store.dispatch(
      showToast({ toastText: TOAST_MESSAGES.TAB_CLOSED, reopenOfferId: 7 })
    );
    expect(selectReopenOfferForKey(made.store.getState())).toBe(7);
    return made.store;
  };

  it('"Copied to" takes the key', async () => {
    const store = await withOffer(container(undefined, 'S1'));
    store.dispatch(copyOnSessionRow(LIVE(L1), 'S2'));
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });
});

describe('copyToSpot and copyWindowTo: drops in the session on screen say "Copied to", with no Show (KAN-607)', () => {
  it('a tab at an exact spot, a band joined', () => {
    const { store } = ready(container(undefined, 'S2'));
    expect(
      store.dispatch(
        copyToSpot(LIVE(L1), {
          tabGroupId: 'S2',
          toWindowId: 'd1',
          toIndex: 2,
          toChromeGroupId: 'h1',
        })
      )
    ).toBe(true);
    expect(windowIn(data(store), 'S2', 'd1').tabs[2]).toMatchObject({
      tabId: 'l1',
      chromeGroupId: 'h1',
    });
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TO_SESSION,
        params: { title: 'Target' },
        show: null,
      },
    ]);
  });

  it('a tab on a New window target is a new window there', () => {
    const { store } = ready(container(undefined, 'S2'));
    store.dispatch(
      copyToSpot(LIVE(L1), {
        tabGroupId: 'S2',
        toWindowId: NEW_FIRST_WINDOW,
        toIndex: 0,
      })
    );
    expect(tabIds(sessionIn(data(store), 'S2').windows[0])).toEqual(['l1']);
  });

  it('a window never lands at a spot, and a tab never lands between windows', () => {
    const { store } = ready(container(undefined, 'S2'));
    expect(
      store.dispatch(
        copyToSpot(LIVE(LW), { tabGroupId: 'S2', toWindowId: 'd1', toIndex: 0 })
      )
    ).toBe(false);
    expect(
      store.dispatch(copyWindowTo(LIVE(L1), { tabGroupId: 'S2', toIndex: 0 }))
    ).toBe(false);
    expect(
      store.dispatch(copyWindowTo(LIVE(LW), { tabGroupId: 'S2', toIndex: 2 }))
    ).toBe(true);
    expect(sessionIn(data(store), 'S2').windows.map((w) => w.windowId)).toEqual(
      ['d1', 'd2', 'live-w']
    );
    // Between windows of the session on screen: the count, no Show.
    expect(toasts(store)).toEqual([
      {
        text: TOAST_MESSAGES.COPIED_TABS_TO_SESSION,
        params: { title: 'Target', count: 6 },
        show: null,
      },
    ]);
  });
});

describe('copyToNewSession (N1 A): no toast, shown', () => {
  it('makes the session and shows it', () => {
    const { store } = ready(container(undefined, 'S1'));
    expect(
      store.dispatch(copyToNewSession(LIVE(L1), 'New Tab Group', 'Typed'))
    ).toBe(true);
    const made = data(store).tabGroups[0];
    expect(made.title).toBe('Typed');
    expect(data(store).selectedTabGroupId).toBe(made.tabGroupId);
    expect(toasts(store)).toEqual([]);
  });
});

describe('isSessionOnScreen (P5)', () => {
  it('is the selected session, unless the tab view has it folded away', () => {
    const { store } = ready(container(undefined, 'S2'));
    expect(isSessionOnScreen(store.getState(), 'S2')).toBe(true);
    expect(isSessionOnScreen(store.getState(), 'S1')).toBe(false);
    store.dispatch(setFoldSavedSessionInTabView(true));
    // The popup has no fold.
    expect(isSessionOnScreen(store.getState(), 'S2')).toBe(true);
    location.search = '?view=tab';
    expect(isSessionOnScreen(store.getState(), 'S2')).toBe(false);
    store.dispatch(peekSavedSession());
    expect(isSessionOnScreen(store.getState(), 'S2')).toBe(true);
  });

  it('folded in the tab view, a row drop on the selected session announces it, with Show', () => {
    location.search = '?view=tab';
    const { store } = ready(container(undefined, 'S2'));
    store.dispatch(setFoldSavedSessionInTabView(true));
    store.dispatch(copyOnSessionRow(LIVE(L1), 'S2'));
    expect(toasts(store).map((t) => t.show)).toEqual([{ tabGroupId: 'S2' }]);
  });
});
