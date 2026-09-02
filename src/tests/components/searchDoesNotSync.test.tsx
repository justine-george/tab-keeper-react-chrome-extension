import { describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  openSearchPanel,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { IS_DIRTY_ACTION } from '../../utils/constants/actionTypes';

// KAN-35, the search half. Typing never marks the store dirty by itself --
// `setSearchInputText` is not a capturable action. It reached the network
// indirectly: TabGroupEntryContainer selects the first filtered result on every
// keystroke (the effect keyed on [searchInputText]), and selection used to mark
// the store dirty.
//
// This is the user-visible statement of the ticket, and it is deliberately an
// integration test rather than a store-level one: the store-level test in
// src/tests/redux/selectionDoesNotSync.test.ts can only prove that a *direct*
// selectTabContainer is clean, not that search still routes through it.
//
// The mutation test for this file: restore the unconditional
// `store.dispatch(setIsDirty())` in customMiddleware's data-change branch.
// Both tests below must go red.

const buildGroup = (n: number, title: string) => ({
  tabGroupId: `group-${n}`,
  title,
  createdTime: `2026-09-01 09:0${n}:00`,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `win-${n}`,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: `Window ${n}`,
      tabs: [
        {
          tabId: `w${n}-t0`,
          favicon: '',
          title: `Page ${n}`,
          url: `https://example.com/${n}`,
        },
      ],
    },
  ],
});

// saveToTabContainerInternal unshifts and selects what it just saved, so
// "Bravo" is selected on entry. Searching for "Alpha" therefore moves the
// selection, which is what makes the assertion meaningful -- a search that
// re-selected the already-selected group would leave the old code clean too.
const renderSeeded = () =>
  renderWithProviders(<TabGroupEntryContainer />, {
    seedStore: (s) => {
      s.dispatch(saveToTabContainerInternal(buildGroup(1, 'Alpha')));
      s.dispatch(saveToTabContainerInternal(buildGroup(2, 'Bravo')));
      s.dispatch(openSearchPanel());
    },
  });

describe('searching does not schedule a Firestore sync (KAN-35)', () => {
  test('typing in the search box does not mark the store dirty', async () => {
    const { store, seen } = await renderSeeded();
    seen.length = 0;

    await act(async () => {
      store.dispatch(setSearchInputText('Alpha'));
    });

    // The control for this file: the search must actually have moved the
    // selection. Without this, a search that matched nothing would leave the
    // effect dormant and the dirty assertion would pass vacuously.
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'group-1'
    );
    expect(seen).not.toContain(IS_DIRTY_ACTION);
  });

  test('clicking a session does not mark the store dirty', async () => {
    const { store, seen } = await renderSeeded();
    seen.length = 0;

    await act(async () => {
      store.dispatch(selectTabContainer('group-1'));
    });

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'group-1'
    );
    expect(seen).not.toContain(IS_DIRTY_ACTION);
  });
});
