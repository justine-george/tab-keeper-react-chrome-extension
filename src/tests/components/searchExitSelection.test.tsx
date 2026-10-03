import { describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setSearchInputText } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-90. Clearing the search used to land on BETA, the newest session: the
// effect re-ran on the cleared text and selected [0] of the whole list. It
// must leave you on the match you found. Clearing is the only way out now
// that the search is a row (KAN-385).

const session = (id: string, title: string): tabContainerData => ({
  tabGroupId: id,
  title,
  createdTime: '2026-09-01 00:00:00',
  createdAt: Date.UTC(2026, 8, 1),
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `w-${id}`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: `window of ${title}`,
      tabs: [
        {
          tabId: `t-${id}`,
          favicon: '',
          title: `tab of ${title}`,
          url: 'https://a.co/',
        },
      ],
    },
  ],
});

type Store = {
  dispatch: (a: unknown) => void;
  getState: () => {
    tabContainerDataState: { selectedTabGroupId: string | null };
  };
};

// Seeded newest-last so that after the unshift each save performs, the list
// reads BETA, ALPHA, COUNTS -- the same order as the live reproduction.
const renderWithSessions = () =>
  renderWithProviders(<TabGroupEntryContainer />, {
    seedStore: (store: Store) => {
      store.dispatch(saveToTabContainerInternal(session('c', 'COUNTS')));
      store.dispatch(saveToTabContainerInternal(session('a', 'ALPHA')));
      store.dispatch(saveToTabContainerInternal(session('b', 'BETA')));
    },
  });

const selected = (store: Store) =>
  store.getState().tabContainerDataState.selectedTabGroupId;

const search = (store: Store, text: string) =>
  act(() => {
    store.dispatch(setSearchInputText(text));
  });

describe('clearing the search does not move the user (KAN-90)', () => {
  test('CONTROL: searching still selects the first match', async () => {
    const { store } = await renderWithSessions();
    act(() => {
      store.dispatch(selectTabContainer('c'));
    });
    expect(selected(store)).toBe('c');

    search(store, 'ALPHA');
    expect(selected(store)).toBe('a');
  });

  test('clearing the box leaves you on the match you found', async () => {
    const { store } = await renderWithSessions();
    act(() => {
      store.dispatch(selectTabContainer('c'));
    });
    search(store, 'ALPHA');
    expect(selected(store)).toBe('a');

    act(() => {
      store.dispatch(setSearchInputText(''));
    });

    // Was 'b' (BETA, the newest session) before the fix.
    expect(selected(store)).toBe('a');
  });

  // Narrowing a query should not walk the user back to the top of the results.
  //
  // The fixture is built so this discriminates: both sessions match the query
  // throughout, and the one selected is deliberately NOT the first result. A
  // reducer that re-selected [0] on every keystroke would move it to ZULU, so
  // asserting YANKEE cannot pass by coincidence.
  test('typing more keeps the selection while it still matches', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />, {
      seedStore: (s: Store) => {
        s.dispatch(saveToTabContainerInternal(session('y', 'YANKEE-match')));
        s.dispatch(saveToTabContainerInternal(session('z', 'ZULU-match')));
      },
    });

    // list order after the unshifts: ZULU-match, YANKEE-match
    search(store, 'matc');
    expect(selected(store)).toBe('z'); // first result, as designed

    act(() => {
      store.dispatch(selectTabContainer('y')); // pick the SECOND result
    });
    expect(selected(store)).toBe('y');

    act(() => {
      store.dispatch(setSearchInputText('match')); // both still match
    });

    expect(selected(store)).toBe('y');
  });
});
