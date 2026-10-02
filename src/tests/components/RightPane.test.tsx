import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import RightPane from '../../components/home/rightpane/RightPane';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

const buildSession = () => ({
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
        },
      ],
    },
  ],
});

// RightPane decides whether its two children mount, and both children then read
// element [0] of a list they derive themselves. These tests pin the agreement
// between that decision and those reads: whenever the pane renders, the children
// must find a session, and whenever it renders nothing, neither child mounted.
describe('RightPane', () => {
  test('renders both children when a session is selected', async () => {
    await renderWithProviders(<RightPane />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('group-1'));
      },
    });

    // the session title comes from HeroContainerRight, the window title from
    // TabGroupDetailsContainer -- one assertion each, so a child that failed to
    // mount cannot hide behind its sibling
    expect(await screen.findByText('Research')).toBeTruthy();
    expect(screen.getByText('Morning reading')).toBeTruthy();
  });

  test('renders nothing when the store is empty', async () => {
    const { container } = await renderWithProviders(<RightPane />);

    expect(container.innerHTML).toBe('');
  });

  // The state the empty store cannot express: sessions exist, but none of them
  // is the selected one. selectTabContainer deselects every other group, so
  // pointing it at an id no session has leaves them all unselected -- which is
  // where the pane lands after the selected session is deleted.
  test('renders nothing when sessions exist but none is selected', async () => {
    const { container } = await renderWithProviders(<RightPane />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('no-such-group'));
      },
    });

    expect(container.innerHTML).toBe('');
  });

  // The pane's guard checks the selected list AFTER the search filter, so a
  // search matching nothing must keep the children unmounted. If the guard ever
  // stopped applying the filter its children would mount against an empty list.
  test('draws the no-match state, not the session, when the search filters it away', async () => {
    const { container } = await renderWithProviders(<RightPane />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('group-1'));
        store.dispatch(setSearchInputText('nothing matches this'));
      },
    });

    expect(
      await screen.findByText('No saved tab matches "nothing matches this"')
    ).toBeTruthy();
    expect(screen.queryByText('Research')).toBeNull();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toHaveAttribute('data-no-match');
  });

  test('renders the session again when the search matches it', async () => {
    await renderWithProviders(<RightPane />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(buildSession()));
        store.dispatch(selectTabContainer('group-1'));
        store.dispatch(setSearchInputText('kagi'));
      },
    });

    expect(await screen.findByText('Research')).toBeTruthy();
  });
});
