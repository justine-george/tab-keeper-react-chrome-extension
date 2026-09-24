import { afterEach, describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupEntry from '../../components/home/leftpane/TabGroupEntry';
import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  chromeTabGroupData,
  tabData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-279 D7/D13. In the tab, Switch would close the windows hosting Tab
// Keeper itself, and "Add current tab" could only ever add Tab Keeper's own
// page -- both are meaningless there, so they hide behind isTabView() while
// staying exactly as they are in the popup. Every case below renders the
// SAME session/window/group data twice, once as the popup and once with
// `?view=tab` in the URL, so a query that never finds the control at all --
// not just one dropped by the tab-view case -- cannot pass either half.

const noop = () => undefined;

// A factory, not a shared constant: saveToTabContainerInternal's reducer
// mutates what it is handed and Immer freezes the result, so a session reused
// across two dispatches (popup render, then tab-view render) throws on the
// second one.
const buildSession = (): tabContainerData => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-08-31 09:00:00',
  createdAt: Date.UTC(2026, 7, 31, 9, 0, 0),
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

const renderHeroSelected = () =>
  renderWithProviders(<HeroContainerRight />, {
    seedStore: (store) => {
      store.dispatch(saveToTabContainerInternal(buildSession()));
      store.dispatch(selectTabContainer('group-1'));
    },
  });

const renderTabGroupEntryRow = () =>
  renderWithProviders(
    <TabGroupEntry
      tabGroupData={buildSession()}
      onTabGroupClick={noop}
      onOpenAllClick={noop}
      onFocusClick={noop}
      onDeleteClick={noop}
    />
  );

async function renderWindow(props: {
  tabs: tabData[];
  chromeTabGroups?: chromeTabGroupData[];
}) {
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg1"
      windowId="w1"
      onWindowTitleClick={noop}
      onUpdateWindowGroupTitle={noop}
      onAddCurrTabToWindowClick={noop}
      onDeleteClick={noop}
      {...props}
    />,
    {
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
      },
    }
  );
}

const goToTabView = () => history.replaceState(null, '', '?view=tab');

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('the right-pane session toolbar (D7)', () => {
  // CONTROL. Proves the query used below actually finds the control when it
  // is genuinely present -- without this, "absent in the tab" could pass
  // because the name never renders at all, e.g. a typo in the i18n key.
  test('CONTROL: Switch to session is in the popup', async () => {
    await renderHeroSelected();

    expect(
      await screen.findByRole('button', {
        name: 'Close current windows and open this session',
      })
    ).toBeInTheDocument();
  });

  test('Switch to session is absent in the tab view', async () => {
    goToTabView();
    await renderHeroSelected();

    // findByText below waits for the session to actually mount before the
    // negative query is trusted.
    expect(await screen.findByText('Research')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Close current windows and open this session',
      })
    ).not.toBeInTheDocument();
  });

  // The other half of D7: Open session has no reason to hide -- it keeps the
  // current windows rather than closing the one hosting this page -- and must
  // still be there once the toolbar starts hiding a neighbour.
  test('Open session stays in the tab view', async () => {
    goToTabView();
    await renderHeroSelected();

    expect(
      await screen.findByRole('button', {
        name: 'Open session, keeping current windows',
      })
    ).toBeInTheDocument();
  });
});

describe('the session row (D7)', () => {
  test('CONTROL: Switch is in the popup row', async () => {
    await renderTabGroupEntryRow();

    expect(
      await screen.findByRole('button', { name: 'Switch' })
    ).toBeInTheDocument();
  });

  test('Switch is absent from the row in the tab view', async () => {
    goToTabView();
    await renderTabGroupEntryRow();

    expect(await screen.findByText('Research')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Switch' })
    ).not.toBeInTheDocument();
  });

  // The row's Open survives the same way the toolbar's does.
  test('Open stays on the row in the tab view', async () => {
    goToTabView();
    await renderTabGroupEntryRow();

    expect(
      await screen.findByRole('button', { name: 'Open' })
    ).toBeInTheDocument();
  });
});

describe('the window row (D13)', () => {
  const tabs: tabData[] = [
    { tabId: 't1', favicon: '', title: 'Inbox', url: 'https://a.test' },
  ];

  test('CONTROL: Add current tab is on the popup window row', async () => {
    await renderWindow({ tabs });

    expect(
      await screen.findByRole('button', { name: 'Add current tab' })
    ).toBeInTheDocument();
  });

  test('Add current tab is absent from the window row in the tab view', async () => {
    goToTabView();
    await renderWindow({ tabs });

    expect(await screen.findByText('Inbox')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add current tab' })
    ).not.toBeInTheDocument();
  });
});

describe('the Chrome group row (D13)', () => {
  const groupedTabs: tabData[] = [
    {
      tabId: 't1',
      favicon: '',
      title: 'Inbox',
      url: 'https://a.test',
      chromeGroupId: 'g1',
    },
  ];
  const chromeTabGroups: chromeTabGroupData[] = [
    { groupId: 'g1', title: 'Work', color: 'blue' },
  ];

  test('CONTROL: Add current tab to group is on the popup group row', async () => {
    await renderWindow({ tabs: groupedTabs, chromeTabGroups });

    expect(
      await screen.findByRole('button', { name: 'Add current tab to group' })
    ).toBeInTheDocument();
  });

  test('Add current tab to group is absent from the group row in the tab view', async () => {
    goToTabView();
    await renderWindow({ tabs: groupedTabs, chromeTabGroups });

    expect(
      await screen.findByRole('group', { name: 'Work' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add current tab to group' })
    ).not.toBeInTheDocument();
  });
});
