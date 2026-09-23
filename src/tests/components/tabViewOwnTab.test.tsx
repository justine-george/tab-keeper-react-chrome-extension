import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  replaceState,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  SAVE_TAB_CONTAINER_ACTION,
  ADD_CURR_WINDOW_TO_TABGROUP_ACTION,
} from '../../utils/constants/actionTypes';

// KAN-279 D6/D14/D15. In the tab, "the current window" includes Tab Keeper's
// own page, and "the active tab" IS Tab Keeper -- so a save or an "Add
// current window" that used the raw window/active-tab data would store the
// extension's own page as a saved tab, and the name box would suggest "Tab
// Keeper" as a session name. Both saves and "Add current window" leave the
// own tab out BY ID (D6/D14), and the name box falls back to the next most
// recently used tab, cleaned exactly like any other derived title (D15).
//
// The popup is unchanged: outside the tab view, ownTabId() is undefined and
// every path below is a no-op.

const OWN_URL = 'chrome-extension://faketestid/index.html?view=tab';
const DOCS_URL = 'https://docs.test/';
const MAIL_URL = 'https://mail.test/';
const OTHER_URL = 'https://other.test/';

// A small typed builder in place of `as chrome.tabs.Tab[]`: @types/chrome
// marks index/pinned/highlighted/windowId/active/frozen/incognito/selected/
// discarded/autoDiscardable/groupId/lastAccessed as required, so a seed
// literal naming only id/url/title/active/lastAccessed is missing fields a
// cast would have hidden rather than filled. windowId defaults to 1 --
// DEFAULT_WINDOW_ID in chrome.fake.ts -- since every seed below places its
// tabs in window 1.
function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    frozen: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    lastAccessed: 0,
    url: '',
    title: '',
    ...overrides,
  };
}

// Window 1 holds Tab Keeper's own tab (10, most recently used) beside two
// real tabs (11, 12).
const tabViewSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        tab({
          id: 10,
          url: OWN_URL,
          title: 'Tab Keeper',
          active: true,
          lastAccessed: 300,
        }),
        tab({ id: 11, url: DOCS_URL, title: 'Docs', lastAccessed: 200 }),
        tab({ id: 12, url: MAIL_URL, title: 'Mail', lastAccessed: 100 }),
      ],
    },
  ],
  currentTabId: 10,
};

// The worst path: nothing open in this window but Tab Keeper itself.
const onlyOwnTabSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        tab({
          id: 10,
          url: OWN_URL,
          title: 'Tab Keeper',
          active: true,
          lastAccessed: 300,
        }),
      ],
    },
  ],
  currentTabId: 10,
};

// CONTROL: the same three tabs, but no ?view=tab and no currentTabId -- the
// popup, where ownTabId() must stay undefined and every path is a no-op.
const controlSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        tab({ id: 10, url: OWN_URL, title: 'Tab Keeper', active: true }),
        tab({ id: 11, url: DOCS_URL, title: 'Docs' }),
        tab({ id: 12, url: MAIL_URL, title: 'Mail' }),
      ],
    },
  ],
};

// A name hint that needs cleaning: the own tab is most recently used (so it
// must never win regardless), and the next-best OTHER tab carries a
// notification badge that dropNotificationCount must strip.
const cleanedHintSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        tab({
          id: 10,
          url: OWN_URL,
          title: 'Tab Keeper',
          active: true,
          lastAccessed: 500,
        }),
        tab({ id: 11, url: MAIL_URL, title: '(3) Mail', lastAccessed: 400 }),
        tab({ id: 12, url: OTHER_URL, title: 'Other', lastAccessed: 100 }),
      ],
    },
  ],
  currentTabId: 10,
};

const goToTabView = () => history.replaceState(null, '', '?view=tab');

// jsdom's `document.visibilityState` has no setter, so a getter override is
// the only way to move it; `configurable: true` is what lets the next test's
// Reflect.deleteProperty below remove the override rather than stack a
// second one on top.
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  history.replaceState(null, '', '/');
  Reflect.deleteProperty(document, 'visibilityState');
});

const openSaveMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
};

const clickSaveCurrentWindow = async () => {
  const menu = await openSaveMenu();
  await userEvent.click(
    within(menu).getByRole('menuitem', {
      name: 'Save current window as a session',
    })
  );
};

const clickSaveAllWindows = () =>
  userEvent.click(screen.getByLabelText('Save all open windows as a session'));

const renderHeroWithSelectedSession = (chromeSeed: ChromeSeed) =>
  renderWithProviders(<HeroContainerRight />, {
    seed: chromeSeed,
    seedStore: (store) => {
      store.dispatch(
        replaceState(
          buildContainer([buildSession({ tabGroupId: 'session-1' })])
        )
      );
      store.dispatch(selectTabContainer('session-1'));
    },
  });

const clickAddCurrentWindow = () =>
  userEvent.click(screen.getByRole('button', { name: 'Add current window' }));

describe('saving in the tab view leaves out Tab Keeper itself (D6)', () => {
  test('Save current window stores a session with tabs 11 and 12 only', async () => {
    goToTabView();
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: tabViewSeed,
    });
    await screen.findByDisplayValue('Docs');

    await clickSaveCurrentWindow();

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups).toHaveLength(1);
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([
      DOCS_URL,
      MAIL_URL,
    ]);
  });

  test('Save all open windows gives the same', async () => {
    goToTabView();
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: tabViewSeed,
    });
    await screen.findByDisplayValue('Docs');

    await clickSaveAllWindows();

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups).toHaveLength(1);
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([
      DOCS_URL,
      MAIL_URL,
    ]);
  });

  // The worst path: nothing left to save once Tab Keeper's own tab is out.
  test('with only Tab Keeper open, Save current window creates no session', async () => {
    goToTabView();
    const { store, seen } = await renderWithProviders(<UserInputContainer />, {
      seed: onlyOwnTabSeed,
    });
    await screen.findByDisplayValue('New Tab Group');

    await clickSaveCurrentWindow();

    // `seen` first. saveToTabContainerInternal always unshifts its payload
    // into tabGroups, so any mutation that lets the dispatch through also
    // empties this into a failure on the toEqual([]) below -- ordered the
    // other way, that line always throws first and this one never gets the
    // chance to fail on its own.
    expect(seen).not.toContain(SAVE_TAB_CONTAINER_ACTION);
    // Kept, not redundant with the line above: `seen` only checks for ONE
    // action type, so a regression that added a session through a DIFFERENT
    // action (replaceState, a sync merge, ...) would pass that check and be
    // caught only here.
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });

  // CHANGED for KAN-300 (was "CONTROL: in the popup, Save current window
  // keeps every tab", proving the D6 exclusion -- then id-based, via
  // captureOpenWindows's now-removed excludeTabId -- was conditioned on the
  // tab view). KAN-300 replaced that with an address-based rule
  // (isTabKeeperPage) that runs for every caller, popup included: a Tab
  // Keeper page open ELSEWHERE in the window (here, tab 10, alongside the
  // popup itself) is excluded from the popup's own save too.
  test('a Tab Keeper page open elsewhere in the window is excluded even from the popup', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: controlSeed,
    });
    await screen.findByDisplayValue('Tab Keeper');

    await clickSaveCurrentWindow();

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([
      DOCS_URL,
      MAIL_URL,
    ]);
  });
});

describe('the name box in the tab view (D15)', () => {
  test('suggests the most recently used OTHER tab', async () => {
    goToTabView();
    await renderWithProviders(<UserInputContainer />, { seed: tabViewSeed });

    expect(await screen.findByDisplayValue('Docs')).toBeTruthy();
  });

  // A hint cleaned by dropNotificationCount: the own tab is most recently
  // used and must never win, and the next-best OTHER tab carries a badge
  // that has to be stripped, exactly as it is for the popup's active tab.
  test('is cleaned by dropNotificationCount', async () => {
    goToTabView();
    await renderWithProviders(<UserInputContainer />, {
      seed: cleanedHintSeed,
    });

    // One text input, one value: proving it IS 'Mail' already proves it is
    // NOT '(3) Mail' and NOT 'Tab Keeper' -- a single input cannot hold two
    // values at once, so separate queryByDisplayValue checks for those two
    // strings are redundant with this line and were dropped.
    // Whatever would make either of those checks fail -- skipped cleaning,
    // or picking the own tab -- makes this line fail first instead.
    expect(await screen.findByDisplayValue('Mail')).toBeTruthy();
  });

  // CONTROL. In the popup the box still suggests the active tab's title, as
  // it always has -- proves the tab-view branch above is additional
  // behaviour, not a replacement that also changed the popup's suggestion.
  test('CONTROL: in the popup, the name box suggests the active tab', async () => {
    await renderWithProviders(<UserInputContainer />, { seed: controlSeed });

    expect(await screen.findByDisplayValue('Tab Keeper')).toBeTruthy();
  });
});

describe('the name box recomputes on visibility, but only in the tab view (KAN-299)', () => {
  test('a tab that becomes more recently used while hidden shows up once the tab is visible again', async () => {
    goToTabView();
    const { chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: tabViewSeed }
    );
    await screen.findByDisplayValue('Docs');

    // The window changes while this page is in the background: Mail (12)
    // overtakes Docs (11) as the most recently used OTHER tab.
    chromeHandle.simulateBrowserTabChange(12, { lastAccessed: 999 });
    setVisibility('hidden');
    setVisibility('visible');

    expect(await screen.findByDisplayValue('Mail')).toBeTruthy();
  });

  // CONTROL: proves the recompute above never clobbers what the user typed.
  // Typed text is never a cached suggestion to evict, whatever the window
  // does behind the tab's back.
  test('CONTROL: text the user already typed survives the same recompute', async () => {
    goToTabView();
    const { chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: tabViewSeed }
    );
    const nameBox = await screen.findByDisplayValue('Docs');
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, 'My own title');

    chromeHandle.simulateBrowserTabChange(12, { lastAccessed: 999 });
    setVisibility('hidden');
    setVisibility('visible');
    // Flushes the visibility handler's own awaits (ownTabId, the tabs
    // query) so a recompute that WOULD have overwritten the box has had the
    // chance to.
    await act(async () => {});

    expect(screen.getByDisplayValue('My own title')).toBeTruthy();
  });

  // CONTROL. Outside the tab view no listener is attached at all -- the same
  // change to the active tab's own title, and the same visibility flip,
  // leave the popup's suggestion alone.
  test('CONTROL: in the popup, a visibility flip changes nothing', async () => {
    const { chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: controlSeed }
    );
    await screen.findByDisplayValue('Tab Keeper');

    chromeHandle.simulateBrowserTabChange(10, { title: 'Changed' });
    setVisibility('hidden');
    setVisibility('visible');
    await act(async () => {});

    // One text input, one value: proving it IS 'Tab Keeper' already proves
    // it is NOT 'Changed' -- a single input cannot hold two values at once,
    // so a separate queryByDisplayValue('Changed') check is redundant with
    // this line and was dropped (same reasoning as the D15 cleaning test
    // above).
    expect(screen.getByDisplayValue('Tab Keeper')).toBeTruthy();
  });
});

describe('the tab-view visibility listener is cleaned up on unmount (KAN-300 Part B a)', () => {
  test('unmount removes the listener: a later visibility flip makes no chrome query and does not throw', async () => {
    goToTabView();
    const { unmount, chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: tabViewSeed }
    );
    await screen.findByDisplayValue('Docs');

    unmount();
    const queriesBeforeFlip = chromeHandle.tabsQueryCalls.length;

    expect(() => setVisibility('visible')).not.toThrow();
    // Flushes anything a (correctly absent) listener might have queued.
    await act(async () => {});

    // The listener is gone, not merely inert: NO chrome call is made at all.
    expect(chromeHandle.tabsQueryCalls.length).toBe(queriesBeforeFlip);
  });

  // NOT IMPLEMENTED, deliberately: a second test for the OTHER race -- the
  // listener fires WHILE STILL MOUNTED, its query is still in flight, and
  // only THEN does the component unmount, so `cancelled` (not
  // removeEventListener, which has nothing left to remove from by then) is
  // what has to stop the resulting setState from reaching a dead component.
  //
  // MEASURED, not assumed, before deciding this: React 18's
  // `createRoot().unmount()` (what RTL's `unmount` calls) makes a late
  // setState on the disposed root a silent no-op -- NOT the "Can't perform a
  // React state update on an unmounted component" warning older React
  // versions raised, and not an `onRecoverableError` either. Checked four
  // ways against a throwaway probe component: console.error spied through an
  // act()-wrapped flush, through a raw (non-act) flush, after a
  // reconciliation-driven unmount (`rerender(<div/>)` instead of
  // `unmount()`), and via `createRoot`'s own `onRecoverableError` callback --
  // all four came back with zero calls. CONTROL: the same probe, left
  // MOUNTED, for the same out-of-act setState, DID produce the "not wrapped
  // in act(...)" warning -- proof the absence above is the unmount, not a
  // harness that cannot detect this class of warning at all (same
  // "negative-probe-needs-a-control" discipline as the listener-removal
  // finding elsewhere in this codebase).
  //
  // A `cancelled` drop here also never throws (nothing downstream of the
  // guard can), so no black-box assertion available in this stack --
  // console output, a thrown error, or a further chrome call -- moves when
  // this specific guard is removed. Writing an assertion anyway (e.g. "does
  // not throw") would be vacuous: confirmed by actually deleting the guard
  // and rerunning the suite, which stayed fully green. `cancelled` is kept
  // as defence in depth, matching `loadSuggestion`'s identical guard a few
  // lines up (also untestable at this boundary for the same reason) and the
  // real production race it is written for -- the popup's JS context can be
  // torn down mid-await, not merely React-unmounted, which jsdom has no way
  // to model.
});

// KAN-300 (Part B item b). Clearing the box is respected -- the guard above
// correctly leaves it empty rather than re-seeding it. But createTabGroup's
// fallback for an empty box is `currentTabName`, and that state used to be
// written ONLY by the mount-time suggestion and by a visibility recompute
// that overwrote the box -- so clearing the box froze it at whatever the
// mount-time tab was, forever. `currentTabName` now refreshes on every
// becoming-visible regardless of the box's own guard.
describe('the name-box fallback tracks the current tab even once the box is cleared (KAN-300)', () => {
  test('clear the box, flip visibility after the tabs change, then save: named after the CURRENT most recent other tab', async () => {
    goToTabView();
    const { store, chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: tabViewSeed }
    );
    const nameBox = await screen.findByDisplayValue('Docs');

    await userEvent.clear(nameBox);
    // Mail (12) overtakes Docs (11) as the most recently used OTHER tab,
    // while the box sits empty.
    chromeHandle.simulateBrowserTabChange(12, { lastAccessed: 999 });
    setVisibility('hidden');
    setVisibility('visible');
    // Flushes the visibility handler's own awaits so its refresh of
    // currentTabName has had the chance to land before Save is clicked.
    await act(async () => {});
    // PREMISE: the box is still empty -- the guard did its job; this is not
    // a test of the guard, which the CONTROL below and KAN-299's suite
    // already cover.
    expect(screen.queryByDisplayValue('Docs')).toBeNull();

    await clickSaveCurrentWindow();

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].title).toBe('Mail');
  });

  // CONTROL: the same visibility flip, but the box holds text the user
  // typed -- createTabGroup never reaches the currentTabName fallback at
  // all, so the refresh above must not change what gets saved.
  test('CONTROL: with text typed in the box, the same recompute changes nothing about what is saved', async () => {
    goToTabView();
    const { store, chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: tabViewSeed }
    );
    const nameBox = await screen.findByDisplayValue('Docs');
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, 'My own title');

    chromeHandle.simulateBrowserTabChange(12, { lastAccessed: 999 });
    setVisibility('hidden');
    setVisibility('visible');
    await act(async () => {});

    await clickSaveCurrentWindow();

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].title).toBe('My own title');
  });
});

describe('"Add current window" in the tab view leaves out Tab Keeper itself (D14)', () => {
  test('adds a window with tabs 11 and 12 only', async () => {
    goToTabView();
    const { store } = await renderHeroWithSelectedSession(tabViewSeed);

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([
      DOCS_URL,
      MAIL_URL,
    ]);
    // The added window is named from the most recently used OTHER tab too --
    // the same D15 rule the name box uses, not the active tab (Tab Keeper).
    expect(tabGroups[0].windows[0].title).toBe('Docs');
  });

  // KAN-299. The name is resolved at CLICK time, not cached from mount: the
  // window changes after this component mounts, so the click must find the
  // CURRENT most recently used OTHER tab rather than replay whatever it read
  // when it first rendered.
  test('after the window changes since mount, the added window is named from the CURRENT most recent other tab', async () => {
    goToTabView();
    const { store, chrome: chromeHandle } =
      await renderHeroWithSelectedSession(tabViewSeed);
    // Barrier: flushes whatever this component reads on mount, so the
    // update below lands strictly AFTER mount rather than racing it --
    // without this, the update could beat the mount-time query and the test
    // would pass even against code that never re-reads after mount.
    await act(async () => {});

    chromeHandle.simulateBrowserTabChange(12, { lastAccessed: 999 });

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows[0].title
    ).toBe('Mail');
  });

  // The worst path: no tab left once Tab Keeper's own is out, so nothing is
  // dispatched at all -- not even a window with no tabs.
  test('with only Tab Keeper open, dispatches nothing', async () => {
    goToTabView();
    const { store, seen } = await renderHeroWithSelectedSession(onlyOwnTabSeed);
    const before =
      store.getState().tabContainerDataState.tabGroups[0].windows.length;

    await clickAddCurrentWindow();
    // Flushes the click handler's own awaits (ownTabId, windows.getCurrent)
    // so a dispatch that WOULD have happened has had the chance to.
    await act(async () => {});

    // `seen` first, for the same reason as the save-path worst case above:
    // addCurrWindowToTabGroupInternal always unshifts a window, so a
    // mutation that lets the dispatch through also changes the length below
    // -- ordered the other way, THAT line always throws first.
    expect(seen).not.toContain(ADD_CURR_WINDOW_TO_TABGROUP_ACTION);
    // Kept, not redundant with the line above: `seen` only checks for ONE
    // action type, so a regression that added a window through a DIFFERENT
    // action (replaceState, a sync merge, ...) would pass that check and be
    // caught only here.
    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows
    ).toHaveLength(before);
  });

  // CHANGED for KAN-300 (was "CONTROL: in the popup, Add current window
  // keeps every tab", proving the D14 exclusion -- then ownId-based -- was
  // conditioned on the tab view). HeroContainerRight now applies the SAME
  // address-based rule captureOpenWindows does (isTabKeeperPage), so a Tab
  // Keeper page open elsewhere in the window is excluded from the popup's
  // Add current window too.
  test('a Tab Keeper page open elsewhere in the window is excluded from the popup Add current window too', async () => {
    const { store } = await renderHeroWithSelectedSession(controlSeed);

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([
      DOCS_URL,
      MAIL_URL,
    ]);
  });
});

// KAN-300 (Part B item c). No test today asserted where the popup's "Add
// current window" title comes from. Each of these is mutation-proven:
// mutating `result[0]?.title`, dropping `|| 'New Tab'`, or forcing the
// tab-view branch all left the suite green before this.
describe('the popup "Add current window" name path (KAN-300 Part B c)', () => {
  test("the added window is titled with the active tab's raw title", async () => {
    const { store } = await renderHeroWithSelectedSession({
      windows: [
        {
          id: 1,
          tabs: [
            tab({
              id: 20,
              url: 'https://active.test/',
              title: 'Alpha',
              active: true,
            }),
          ],
        },
      ],
    });

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows[0].title
    ).toBe('Alpha');
  });

  test("with no title it's 'New Tab'", async () => {
    const { store } = await renderHeroWithSelectedSession({
      windows: [
        {
          id: 1,
          tabs: [
            tab({
              id: 20,
              url: 'https://active.test/',
              title: undefined,
              active: true,
            }),
          ],
        },
      ],
    });

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows[0].title
    ).toBe('New Tab');
  });

  // The tab-view branch (pickNameSourceTab over the MOST RECENTLY USED other
  // tab) is never taken in the popup: a more-recently-used, non-active tab
  // must NOT win over the active tab's own title.
  test('in the popup the tab-view branch is not taken', async () => {
    const { store } = await renderHeroWithSelectedSession({
      windows: [
        {
          id: 1,
          tabs: [
            tab({
              id: 20,
              url: 'https://active.test/',
              title: 'Popup Active',
              active: true,
              lastAccessed: 100,
            }),
            tab({
              id: 21,
              url: 'https://other.test/',
              title: 'Should Not Win',
              lastAccessed: 900,
            }),
          ],
        },
      ],
    });

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows[0].title
    ).toBe('Popup Active');
  });
});
