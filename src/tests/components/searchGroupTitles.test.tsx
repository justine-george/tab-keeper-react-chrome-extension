import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import RightPane from '../../components/home/rightpane/RightPane';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { makeTestStore } from '../setup/makeStore';

// KAN-104, at the level the unit tests cannot reach. filterTabGroups can be
// entirely correct while the permission never leaves the store -- four
// components have to read it and hand it over, and a component that forgot
// would show a pure-function suite that is still green.
//
// 'Quarterly' appears in no session title, window title, tab title or URL, so
// every assertion below can only be answered by reading the group's title.
const session = () => ({
  tabGroupId: 'group-1',
  title: 'Alpha',
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
      title: 'Beta window',
      chromeTabGroups: [{ groupId: 'g-1', title: 'Quarterly', color: 'blue' }],
      tabs: [
        {
          tabId: 't1',
          favicon: '',
          title: 'Gamma',
          url: 'https://example.com/gamma',
          chromeGroupId: 'g-1',
        },
        {
          tabId: 't2',
          favicon: '',
          title: 'Delta',
          url: 'https://example.com/delta',
        },
      ],
    },
  ],
});

const searchFor =
  (query: string, hasPermission: boolean) =>
  (store: ReturnType<typeof makeTestStore>['store']) => {
    store.dispatch(setHasTabGroupsPermission(hasPermission));
    store.dispatch(saveToTabContainerInternal(session()));
    store.dispatch(selectTabContainer('group-1'));
    store.dispatch(openSearchPanel());
    store.dispatch(setSearchInputText(query));
  };

describe('searching a Chrome group title, with the permission granted', () => {
  test('the left pane keeps the session in the results', async () => {
    await renderWithProviders(<TabGroupEntryContainer />, {
      seedStore: searchFor('Quarterly', true),
    });

    expect(await screen.findByText('Alpha')).toBeTruthy();
  });

  test('the right pane shows the group members and drops the rest', async () => {
    await renderWithProviders(<RightPane />, {
      seedStore: searchFor('Quarterly', true),
    });

    expect(await screen.findByText('Gamma')).toBeTruthy();
    expect(screen.queryByText('Delta')).toBeNull();
  });

  test('the right pane still draws the band that explains the match', async () => {
    await renderWithProviders(<RightPane />, {
      seedStore: searchFor('Quarterly', true),
    });

    expect(
      await screen.findByRole('group', { name: 'Quarterly' })
    ).toBeTruthy();
  });
});

describe('searching a Chrome group title, without the permission', () => {
  // The band is not drawn without the permission, so the title is invisible
  // everywhere -- and a result narrowed by something the user cannot see is
  // worse than no result.
  test('the left pane drops the session from the results', async () => {
    await renderWithProviders(<TabGroupEntryContainer />, {
      seedStore: searchFor('Quarterly', false),
    });

    expect(screen.queryByText('Alpha')).toBeNull();
  });

  test('the right pane renders nothing at all', async () => {
    const { container } = await renderWithProviders(<RightPane />, {
      seedStore: searchFor('Quarterly', false),
    });

    expect(container.innerHTML).toBe('');
  });
});

describe('the other search levels, with the permission granted', () => {
  // Group matching narrows a window. These pin that it narrows ONLY the window
  // it matched in, and only when the levels above it did not already match.
  test('a session title still admits the whole session', async () => {
    await renderWithProviders(<RightPane />, {
      seedStore: searchFor('Alpha', true),
    });

    expect(await screen.findByText('Gamma')).toBeTruthy();
    expect(screen.getByText('Delta')).toBeTruthy();
  });

  test('a tab title still admits just that tab', async () => {
    await renderWithProviders(<RightPane />, {
      seedStore: searchFor('Delta', true),
    });

    expect(await screen.findByText('Delta')).toBeTruthy();
    expect(screen.queryByText('Gamma')).toBeNull();
  });
});
