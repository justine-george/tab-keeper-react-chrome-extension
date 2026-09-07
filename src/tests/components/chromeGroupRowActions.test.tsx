import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setHasTabGroupsPermission,
  openSearchPanel,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import type { chromeTabGroupData } from '../../redux/slices/tabContainerDataStateSlice';

// The group row's full action set, wired through the UI rather than asserted
// on the reducers (which chromeGroupActions.test.ts already covers). What is
// under test here is that the row actually hands the right ids to the right
// action -- a correct reducer proves nothing about a miswired call site.

const TABS = [
  { tabId: 'loose', favicon: '', title: 'Loose', url: 'https://a.co' },
  {
    tabId: 'g1',
    favicon: '',
    title: 'One',
    url: 'https://b.co',
    chromeGroupId: 'grp',
  },
  {
    tabId: 'g2',
    favicon: '',
    title: 'Two',
    url: 'https://c.co',
    chromeGroupId: 'grp',
  },
];
const GROUPS: chromeTabGroupData[] = [
  { groupId: 'grp', title: 'Research', color: 'blue' },
];

async function renderRow({ isSearchPanel = false } = {}) {
  return renderWithProviders(
    <WindowEntryContainer
      title="Window 1"
      tabGroupId="tg"
      windowId="w"
      tabs={TABS}
      chromeTabGroups={GROUPS}
      onWindowTitleClick={() => undefined}
      onUpdateWindowGroupTitle={() => undefined}
      onAddCurrTabToWindowClick={() => undefined}
      onDeleteClick={() => undefined}
    />,
    {
      seed: {
        tabs: [
          { id: 1, active: true, url: 'https://added.test', title: 'Added' },
        ],
      },
      seedStore: (store) => {
        store.dispatch(setHasTabGroupsPermission(true));
        if (isSearchPanel) store.dispatch(openSearchPanel());
        store.dispatch(
          saveToTabContainerInternal({
            tabGroupId: 'tg',
            title: 'Session',
            createdTime: '2026-09-06 00:00:00',
            windowCount: 1,
            tabCount: 3,
            isAutoSave: false,
            isSelected: false,
            windows: [
              {
                windowId: 'w',
                windowHeight: 100,
                windowWidth: 100,
                windowOffsetTop: 0,
                windowOffsetLeft: 0,
                tabCount: 3,
                title: 'Window 1',
                tabs: TABS,
                chromeTabGroups: GROUPS,
              },
            ],
          })
        );
      },
    }
  );
}

type S = Awaited<ReturnType<typeof renderRow>>['store'];
const win = (store: S) =>
  store.getState().tabContainerDataState.tabGroups[0].windows[0];

describe('the group row action set', () => {
  test('offers rename, add, and an overflow trigger', async () => {
    await renderRow();

    expect(
      screen.getByRole('button', { name: 'Rename group' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add current tab to group' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions' })
    ).toBeInTheDocument();
  });

  test('the overflow holds ungroup and delete', async () => {
    const user = userEvent.setup();
    await renderRow();

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    expect(
      screen.getByRole('menuitem', { name: 'Ungroup' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Delete group' })
    ).toBeInTheDocument();
  });

  test('ungroup keeps the tabs and drops the grouping', async () => {
    const user = userEvent.setup();
    const { store } = await renderRow();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ungroup' }));

    expect(win(store).tabs).toHaveLength(3);
    expect(win(store).chromeTabGroups).toEqual([]);
  });

  test('delete group removes its tabs', async () => {
    const user = userEvent.setup();
    const { store } = await renderRow();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete group' }));

    expect(win(store).tabs.map((t) => t.tabId)).toEqual(['loose']);
  });

  test('add current tab puts it in the group, beside its members', async () => {
    const user = userEvent.setup();
    const { store } = await renderRow();

    await user.click(
      screen.getByRole('button', { name: 'Add current tab to group' })
    );

    const tabs = win(store).tabs;
    expect(tabs).toHaveLength(4);
    expect(tabs[3].chromeGroupId).toBe('grp');
    expect(tabs.map((t) => t.title)).toEqual(['Loose', 'One', 'Two', 'Added']);
  });

  // A control that cannot act must not be focusable and inert (KAN-62).
  test('the search panel withholds every group action', async () => {
    await renderRow({ isSearchPanel: true });

    expect(
      screen.queryByRole('button', { name: 'Rename group' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add current tab to group' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More actions' })
    ).not.toBeInTheDocument();
  });

  // Pins the stacking-context fix. The action strip is centred with
  // transform: translateY(-50%), which makes it a stacking context and traps
  // the overflow menu's z-index inside it -- the menu painted BEHIND the tab
  // rows below. jsdom computes no paint order, so this cannot assert the
  // visual result; it asserts the property the fix turns on, which is the most
  // a jsdom test can hold. Verified visually in a real browser.
  test('the action strip lifts its own stacking context', async () => {
    await renderRow();

    const strip = document.querySelector('.group-rename-reveal');
    expect(strip).not.toBeNull();
    expect(getComputedStyle(strip as Element).zIndex).not.toBe('auto');
  });
});
