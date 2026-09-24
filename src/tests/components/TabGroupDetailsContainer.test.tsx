import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  setSearchInputText,
  setHasTabGroupsPermission,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import { ADD_CURR_TAB_TO_WINDOW_ACTION } from '../../utils/constants/actionTypes';

type TestStore = RenderWithProvidersResult['store'];

// A factory, not a shared constant: saveToTabContainerInternal's reducer
// mutates and Immer freezes whatever object it is given, so a session reused
// across the two tests below would arrive at the second dispatch already
// frozen from the first and throw on the reducer's own `touch()` call.
const buildSession = () => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-08-31 09:00:00',
  windowCount: 1,
  tabCount: 2,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 2,
      title: 'Morning reading',
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Kagi Search',
          url: 'https://kagi.com/',
        },
        {
          tabId: 't2',
          favicon: '',
          title: 'Hacker News',
          url: 'https://news.ycombinator.com/',
        },
      ],
    },
  ],
});

describe('TabGroupDetailsContainer', () => {
  test('renders the window and its tabs from store state', async () => {
    await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    expect(await screen.findByText('Morning reading')).toBeTruthy();
    expect(screen.getByText('Kagi Search')).toBeTruthy();
    expect(screen.getByText('Hacker News')).toBeTruthy();
  });

  test('clicking a tab opens it via the chrome fake', async () => {
    const { chrome } = await renderWithProviders(<TabGroupDetailsContainer />, {
      seed: { tabs: [{ id: 1, index: 0, active: true }] },
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    await userEvent.click(await screen.findByText('Kagi Search'));

    expect(chrome.createdTabs.map((tab) => tab.url)).toContain(
      'https://kagi.com/'
    );
  });

  // KAN-39, the sibling of KAN-16 in the component rendered beside it. Not
  // reachable through the app: RightPane will not mount this component with
  // nothing selected. Rendering it in isolation is what proves it is safe on
  // its own terms.
  test('renders nothing when no session is selected', async () => {
    const { container } = await renderWithProviders(
      <TabGroupDetailsContainer />
    );

    expect(container.innerHTML).toBe('');
  });

  // The other way the list empties: a session is selected but the search
  // filters it away.
  test('renders nothing when the search filters the selected session away', async () => {
    const { container } = await renderWithProviders(
      <TabGroupDetailsContainer />,
      {
        seedStore: (store) => {
          store.dispatch(saveToTabContainerInternal(buildSession()));
          store.dispatch(selectTabContainer('group-1'));
          store.dispatch(openSearchPanel());
          store.dispatch(setSearchInputText('nothing matches this'));
        },
      }
    );

    expect(container.innerHTML).toBe('');
  });

  // Placing it in a group it was never a member of would be inventing data:
  // the tab comes from a different window, whose groups have nothing to do
  // with the saved window it is being added to. No production change makes
  // this pass -- the test exists so a later "helpfully" inherited group id
  // fails here.
  test('a tab added from another window is stored ungrouped', async () => {
    const session = buildSession();
    const { store } = await renderWithProviders(<TabGroupDetailsContainer />, {
      seed: {
        grantedPermissions: ['tabGroups'],
        windows: [{ id: 1, type: 'normal' }],
        tabGroups: [{ id: 5, windowId: 1, title: 'Work', color: 'blue' }],
        tabs: [
          {
            id: 11,
            windowId: 1,
            active: true,
            url: 'https://added.test',
            title: 'Added',
            groupId: 5,
          },
        ],
      },
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(session));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    await userEvent.click(screen.getByLabelText('Add current tab'));

    const tabs =
      store.getState().tabContainerDataState.tabGroups[0].windows[0].tabs;
    const added = tabs.find((tab) => tab.title === 'Added');
    expect(added).toBeDefined();
    expect(added!.chromeGroupId).toBeUndefined();
  });

  // KAN-211. Adding one tab goes through toStoredTab, the same normalising a
  // whole-window capture uses, so the two ways to save a tab cannot disagree
  // about what a tab is. Before that, this path stored the title verbatim
  // while a capture of the same tab would have cleaned it.
  test('a tab added one at a time is stored without its unread badge', async () => {
    const session = buildSession();
    const { store } = await renderWithProviders(<TabGroupDetailsContainer />, {
      seed: {
        windows: [{ id: 1, type: 'normal' }],
        tabs: [
          {
            id: 11,
            windowId: 1,
            active: true,
            url: 'https://added.test',
            title: '(7) Added',
          },
        ],
      },
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(session));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    await userEvent.click(screen.getByLabelText('Add current tab'));

    const tabs =
      store.getState().tabContainerDataState.tabGroups[0].windows[0].tabs;
    expect(tabs.some((tab) => tab.title === 'Added')).toBe(true);
    expect(tabs.some((tab) => tab.title.includes('(7)'))).toBe(false);
  });
});

// KAN-299. The Tab Keeper page rule reaches the active-tab paths too: "Add
// current tab" must add nothing when the active tab IS one -- the same
// silent no-op as an empty window.
describe('Add current tab skips a Tab Keeper page', () => {
  test('the active tab is the tab view: nothing is added', async () => {
    const session = buildSession();
    const { store, seen } = await renderWithProviders(
      <TabGroupDetailsContainer />,
      {
        seed: {
          windows: [{ id: 1, type: 'normal' }],
          tabs: [
            {
              id: 11,
              windowId: 1,
              active: true,
              url: 'chrome-extension://faketestid/index.html?view=tab',
              title: 'Tab Keeper',
            },
          ],
        },
        seedStore: (store) => {
          store.dispatch(saveToTabContainerInternal(session));
          store.dispatch(selectTabContainer('group-1'));
        },
      }
    );

    await userEvent.click(await screen.findByLabelText('Add current tab'));
    // Flushes the click handler's own await (chrome.tabs.query) so a
    // dispatch that WOULD have happened has had the chance to.
    await act(async () => {});

    // `seen` first: addCurrTabToWindowInternal always unshifts, so a
    // mutation that lets the dispatch through also changes the length check
    // below -- ordered the other way, that line always throws first.
    expect(seen).not.toContain(ADD_CURR_TAB_TO_WINDOW_ACTION);
    const tabs =
      store.getState().tabContainerDataState.tabGroups[0].windows[0].tabs;
    expect(tabs).toHaveLength(2);
  });

  // CONTROL: an ordinary active tab is still added, exactly as today --
  // proves the guard above is additional behaviour, not a refusal to add
  // anything at all.
  test('CONTROL: an ordinary active tab is still added', async () => {
    const session = buildSession();
    const { store } = await renderWithProviders(<TabGroupDetailsContainer />, {
      seed: {
        windows: [{ id: 1, type: 'normal' }],
        tabs: [
          {
            id: 11,
            windowId: 1,
            active: true,
            url: 'https://added.test',
            title: 'Added',
          },
        ],
      },
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(session));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    await userEvent.click(await screen.findByLabelText('Add current tab'));

    const tabs =
      store.getState().tabContainerDataState.tabGroups[0].windows[0].tabs;
    expect(tabs.some((tab) => tab.title === 'Added')).toBe(true);
  });
});

// WindowEntryContainer dispatches the rename but never reads the result back
// -- it takes chromeTabGroups as a prop. The round trip is THIS component's
// contract: it selects the session from the store and passes the groups down,
// so a rename must reach the screen without anything else re-rendering it.
describe('renaming a Chrome tab group round-trips to the screen', () => {
  // Built whole rather than by mutating buildSession()'s result: its tabs are
  // inferred without chromeGroupId, so assigning one afterwards is a type the
  // literal does not have. A factory for the same reason as buildSession --
  // Immer freezes whatever the reducer is handed.
  const buildSessionWithGroup = (groupTitle: string): tabContainerData => ({
    tabGroupId: 'group-1',
    title: 'Research',
    createdTime: '2026-08-31 09:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: true,
    windows: [
      {
        windowId: 'win-1',
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 'Morning reading',
        tabs: [
          {
            tabId: 't1',
            favicon: '',
            title: 'Kagi Search',
            url: 'https://kagi.com/',
            chromeGroupId: 'cg-1',
          },
        ],
        chromeTabGroups: [
          { groupId: 'cg-1', title: groupTitle, color: 'blue' },
        ],
      },
    ],
  });

  const seedWith = (groupTitle: string) => (store: TestStore) => {
    store.dispatch(setHasTabGroupsPermission(true));
    store.dispatch(
      saveToTabContainerInternal(buildSessionWithGroup(groupTitle))
    );
    store.dispatch(selectTabContainer('group-1'));
  };

  test('a new name replaces the placeholder on screen', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: seedWith(''),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Rename group' })
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Rename group: Unnamed group' }),
      'Research{Enter}'
    );

    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.queryByText('Unnamed group')).not.toBeInTheDocument();
  });

  test('clearing a name brings the placeholder back on screen', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: seedWith('Research'),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Rename group' })
    );
    const input = screen.getByRole('textbox', {
      name: 'Rename group: Research',
    });
    await user.clear(input);
    await user.type(input, '{Enter}');

    expect(screen.getByText('Unnamed group')).toBeInTheDocument();
  });
});
