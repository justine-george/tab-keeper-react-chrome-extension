import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChromeSeed } from '../setup/chrome.fake';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab as tab } from '../fixtures/chromeTab';
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

// `tab` is `buildChromeTab` (src/tests/fixtures/chromeTab.ts), imported
// under this file's own established short name -- fix round 1 moved the
// builder itself out to a shared fixture (capture.test.ts,
// exportOpenWindows.test.tsx and focusSavesEveryWindow.test.ts each built
// their own copy independently), but every seed below still places its tabs
// in window 1, the builder's own default, so nothing here changed.

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
    // Barrier: waits for the mount-time suggestion, which fix round 1 made
    // 'Docs' rather than 'Tab Keeper' for this seed (its active tab IS a Tab
    // Keeper page -- see the describe below on the name box's own fallback).
    // Unrelated to what this test actually checks (save exclusion).
    await screen.findByDisplayValue('Docs');

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

  // CONTROL. In the popup, with an ORDINARY active tab, the box still
  // suggests that tab's title exactly as it always has -- proves the
  // tab-view branch above, and its extension to a Tab Keeper active tab in
  // the popup (fix round 1, below), are both ADDITIONAL behaviour, not a
  // replacement that also changed the ordinary popup case.
  test('CONTROL: in the popup, an ordinary active tab keeps its own title as the suggestion', async () => {
    await renderWithProviders(<UserInputContainer />, {
      seed: {
        windows: [
          {
            id: 1,
            tabs: [tab({ id: 20, url: DOCS_URL, title: 'Docs', active: true })],
          },
        ],
      },
    });

    expect(await screen.findByDisplayValue('Docs')).toBeTruthy();
  });
});

// KAN-299 fix round 1. The name box's D15 fallback now applies in the popup
// too: Switch can restore a window whose ACTIVE tab is the pinned tab view,
// and the box must not offer "Tab Keeper" as a session name -- the same
// most-recently-used-OTHER-tab rule the tab view already uses.
describe('the popup name box falls back off a Tab Keeper active tab (KAN-299 fix round 1)', () => {
  test('the active tab is the tab view: suggests the most recently used OTHER tab', async () => {
    // controlSeed's active tab (10) is the tab view -- exactly this case.
    await renderWithProviders(<UserInputContainer />, { seed: controlSeed });

    expect(await screen.findByDisplayValue('Docs')).toBeTruthy();
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
    // Flushes the visibility handler's own awaits (the tabs query) so a
    // recompute that WOULD have overwritten the box has had the chance to.
    await act(async () => {});

    expect(screen.getByDisplayValue('My own title')).toBeTruthy();
  });

  // REGRESSION, found in review and reproduced here (fix round 1). Typed
  // text must survive not just ONE declined recompute (the CONTROL above)
  // but a SECOND one straight after -- `lastSuggestionRef` used to move
  // even when the guard declined to touch the box, so it could drift ahead
  // of `boxValueRef` and make a LATER recompute wrongly believe the box was
  // untouched. This sequence is what surfaces that: the user's own text
  // ("Mail") happens to equal the suggestion the FIRST declined recompute
  // computed, which is exactly the coincidence the bug needed.
  test('typed text survives a second recompute straight after one the guard correctly declined', async () => {
    goToTabView();
    const { chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: tabViewSeed }
    );
    const nameBox = await screen.findByDisplayValue('Docs');
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, 'Mail');

    // Mail (12) becomes most recent -- the guard must decline (the box
    // holds "Mail", the user's own text, not the "Docs" suggestion it
    // started from). Bugged code still moved `lastSuggestionRef` to "Mail"
    // here even though it left the box alone.
    chromeHandle.simulateBrowserTabChange(12, { lastAccessed: 999 });
    setVisibility('hidden');
    setVisibility('visible');
    await act(async () => {});

    // Docs (11) becomes most recent again -- a second recompute must ALSO
    // decline, since nothing has touched the box from the user's own
    // perspective since they typed "Mail". Bugged code found
    // `boxValueRef` ("Mail") spuriously equal to the now-drifted
    // `lastSuggestionRef` ("Mail") and overwrote the box with "Docs".
    chromeHandle.simulateBrowserTabChange(11, { lastAccessed: 1999 });
    setVisibility('hidden');
    setVisibility('visible');
    await act(async () => {});

    expect(screen.getByDisplayValue('Mail')).toBeTruthy();
  });

  // CONTROL. Outside the tab view no listener is attached at all -- the same
  // change to the active tab's own title, and the same visibility flip,
  // leave the popup's suggestion alone.
  test('CONTROL: in the popup, a visibility flip changes nothing', async () => {
    const { chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: controlSeed }
    );
    // Barrier: fix round 1 made this 'Docs', not 'Tab Keeper' -- controlSeed's
    // active tab (10) is itself a Tab Keeper page, so the popup's own
    // fallback picks the most recently used OTHER tab even at mount. See the
    // describe on that fallback above; this test is about the LISTENER, not
    // the fallback.
    await screen.findByDisplayValue('Docs');

    // Changes the EXCLUDED tab's title -- it must not matter either way,
    // since tab 10 is never a candidate regardless of what it is called.
    chromeHandle.simulateBrowserTabChange(10, { title: 'Changed' });
    setVisibility('hidden');
    setVisibility('visible');
    await act(async () => {});

    // One text input, one value: proving it IS 'Docs' already proves it is
    // NOT 'Changed' -- a single input cannot hold two values at once, so a
    // separate queryByDisplayValue('Changed') check is redundant with this
    // line and was dropped (same reasoning as the D15 cleaning test above).
    expect(screen.getByDisplayValue('Docs')).toBeTruthy();
  });
});

describe('the tab-view visibility listener is removed on unmount (KAN-299)', () => {
  test('unmount removes the listener: a later visibility flip makes no chrome query', async () => {
    goToTabView();
    const { unmount, chrome: chromeHandle } = await renderWithProviders(
      <UserInputContainer />,
      { seed: tabViewSeed }
    );
    await screen.findByDisplayValue('Docs');

    unmount();
    const queriesBeforeFlip = chromeHandle.tabsQueryCalls.length;

    setVisibility('visible');
    // Flushes anything a (correctly absent) listener might have queued.
    await act(async () => {});

    // The listener is gone, not merely inert: NO chrome call is made at all.
    expect(chromeHandle.tabsQueryCalls.length).toBe(queriesBeforeFlip);
  });

  // Fix round 1: the `cancelled` guard this listener used to check on top of
  // removeEventListener was deleted from the production code. It read as
  // defence against the popup's JS context being torn down mid-await, but
  // this listener only ever runs in the tab view -- a context that is not
  // torn down the way the popup's is -- and no test in this stack could
  // fail it either way (a probe unmounting mid-query showed nothing
  // regardless: React 18 silently no-ops a state update on an unmounted
  // root). removeEventListener, proven above, is what actually stops it.
});

describe('the name-box fallback tracks the current tab even once the box is cleared (KAN-299)', () => {
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
    // PREMISE: the box is still exactly empty -- the guard did its job;
    // this is not a test of the guard, which the CONTROL below and
    // KAN-299's suite already cover. Asserted as the box's actual value,
    // not `queryByDisplayValue('Docs')).toBeNull()`: that line is true of
    // ANY value other than 'Docs' -- including whatever the box would hold
    // if the guard were removed and it got overwritten with a suggestion --
    // so it cannot fail if the guard breaks. `toHaveValue('')` can.
    expect(nameBox).toHaveValue('');

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

// No test today asserted where the popup's "Add current window" title comes
// from. Each of these is mutation-proven: mutating `result[0]?.title`,
// dropping `|| 'New Tab'`, or forcing the tab-view branch all left the suite
// green before this.
describe('the popup "Add current window" name path', () => {
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

// KAN-299 fix round 1. Extended past the tab view: Switch can restore a
// window whose ACTIVE tab is the pinned tab view, and "Add current window"
// (from the popup) must not name the new window "Tab Keeper" -- the same
// most-recently-used-OTHER-tab fallback the tab view already applies.
describe('the popup "Add current window" title falls back off a Tab Keeper active tab', () => {
  test('the active tab is a Tab Keeper page: named from the most recently used OTHER tab', async () => {
    const { store } = await renderHeroWithSelectedSession({
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
    });

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows[0].title
    ).toBe('Docs');
  });
});
