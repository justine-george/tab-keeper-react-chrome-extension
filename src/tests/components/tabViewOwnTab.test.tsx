import { afterEach, describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import UserInputContainer from '../../components/home/leftpane/UserInputContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
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

// Window 1 holds Tab Keeper's own tab (10, most recently used) beside two
// real tabs (11, 12), exactly as the brief specifies.
const tabViewSeed = {
  windows: [
    {
      id: 1,
      tabs: [
        {
          id: 10,
          url: OWN_URL,
          title: 'Tab Keeper',
          active: true,
          lastAccessed: 300,
        },
        { id: 11, url: DOCS_URL, title: 'Docs', lastAccessed: 200 },
        { id: 12, url: MAIL_URL, title: 'Mail', lastAccessed: 100 },
      ] as chrome.tabs.Tab[],
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
        {
          id: 10,
          url: OWN_URL,
          title: 'Tab Keeper',
          active: true,
          lastAccessed: 300,
        },
      ] as chrome.tabs.Tab[],
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
        { id: 10, url: OWN_URL, title: 'Tab Keeper', active: true },
        { id: 11, url: DOCS_URL, title: 'Docs' },
        { id: 12, url: MAIL_URL, title: 'Mail' },
      ] as chrome.tabs.Tab[],
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
        {
          id: 10,
          url: OWN_URL,
          title: 'Tab Keeper',
          active: true,
          lastAccessed: 500,
        },
        { id: 11, url: MAIL_URL, title: '(3) Mail', lastAccessed: 400 },
        { id: 12, url: OTHER_URL, title: 'Other', lastAccessed: 100 },
      ] as chrome.tabs.Tab[],
    },
  ],
  currentTabId: 10,
};

const goToTabView = () => history.replaceState(null, '', '?view=tab');

afterEach(() => {
  history.replaceState(null, '', '/');
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

const renderHeroWithSelectedSession = (
  chromeSeed: typeof tabViewSeed | typeof onlyOwnTabSeed | typeof controlSeed
) =>
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
    // chance to fail on its own (see the fix-round-1 report).
    expect(seen).not.toContain(SAVE_TAB_CONTAINER_ACTION);
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });

  // CONTROL. Outside the tab view, ownTabId() is undefined and nothing is
  // excluded -- proves the exclusion above is conditioned on the tab view,
  // not an unconditional filter that would also strike the popup.
  test('CONTROL: in the popup, Save current window keeps every tab', async () => {
    const { store } = await renderWithProviders(<UserInputContainer />, {
      seed: controlSeed,
    });
    await screen.findByDisplayValue('Tab Keeper');

    await clickSaveCurrentWindow();

    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([
      OWN_URL,
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
    // strings are redundant with this line and were dropped (fix round 1).
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
    expect(
      store.getState().tabContainerDataState.tabGroups[0].windows
    ).toHaveLength(before);
  });

  // CONTROL. Outside the tab view, ownTabId() is undefined and nothing is
  // excluded.
  test('CONTROL: in the popup, Add current window keeps every tab', async () => {
    const { store } = await renderHeroWithSelectedSession(controlSeed);

    await clickAddCurrentWindow();

    await waitFor(() =>
      expect(
        store.getState().tabContainerDataState.tabGroups[0].windows
      ).toHaveLength(2)
    );
    const { tabGroups } = store.getState().tabContainerDataState;
    expect(tabGroups[0].windows[0].tabs.map((t) => t.url)).toEqual([
      OWN_URL,
      DOCS_URL,
      MAIL_URL,
    ]);
  });
});
