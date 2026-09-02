import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  closeSearchPanel,
  openSearchPanel,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-60. `Delta` is the session from the ticket, rebuilt at the same size: 7
// windows, 13 tabs, with exactly one tab titled "Example Domain". Searching
// that phrase narrows the session to 1 window / 1 tab -- and before this fix
// the row reported "1 Window - 1 Tab", the same words it uses outside search
// to mean the session holds one window and one tab.
const delta = () => {
  const tab = (id: string, title: string) => ({
    tabId: id,
    favicon: '',
    title,
    url: `https://site-${id}.test/`,
  });

  // 1 + 2 + 2 + 2 + 2 + 2 + 2 = 13 tabs across 7 windows. Only w4 holds the
  // phrase, and no window title and no session title contains it, so the match
  // is a single tab in a single window.
  const tabsPerWindow = [
    [tab('a1', 'Docs home')],
    [tab('b1', 'Laws of UX'), tab('b2', 'Type scale')],
    [tab('c1', 'Inbox'), tab('c2', 'Calendar')],
    [tab('d1', 'Example Domain'), tab('d2', 'Release notes')],
    [tab('e1', 'Pull requests'), tab('e2', 'Issues')],
    [tab('f1', 'Weather'), tab('f2', 'Transit')],
    [tab('g1', 'Recipes'), tab('g2', 'Shopping')],
  ];

  return {
    tabGroupId: 'delta',
    title: 'Delta',
    createdTime: '2026-09-01 19:13:05',
    windowCount: tabsPerWindow.length,
    tabCount: tabsPerWindow.reduce((n, tabs) => n + tabs.length, 0),
    isAutoSave: false,
    isSelected: false,
    windows: tabsPerWindow.map((tabs, i) => ({
      windowId: `win-${i}`,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: tabs.length,
      title: `Window ${i}`,
      tabs,
    })),
  };
};

describe('left pane count label', () => {
  test('describes the session when no search is running', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);

    store.dispatch(saveToTabContainerInternal(delta()));

    expect(await screen.findByText('7 Windows - 13 Tabs')).toBeTruthy();
  });

  // The case a fix keyed on `isSearchPanel` alone gets wrong. The panel is
  // open, so a naive guard would call these matches -- but filterTabGroups has
  // not run, and 7/13 is the session's real size.
  test('still describes the session when the search box is empty', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);

    store.dispatch(saveToTabContainerInternal(delta()));
    store.dispatch(openSearchPanel());

    expect(await screen.findByText('7 Windows - 13 Tabs')).toBeTruthy();
    expect(screen.queryByText('Matches: 7 Windows - 13 Tabs')).toBeNull();
  });

  test('says the counts are matches while a search is narrowing them', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);

    store.dispatch(saveToTabContainerInternal(delta()));
    store.dispatch(openSearchPanel());
    store.dispatch(setSearchInputText('Example Domain'));

    expect(await screen.findByText('Matches: 1 Window - 1 Tab')).toBeTruthy();
    // The bug itself: the narrowed numbers must never appear wearing the
    // unqualified label, because that is how the session's own size is stated.
    expect(screen.queryByText('1 Window - 1 Tab')).toBeNull();
  });

  test('goes back to describing the session when the search is cleared', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />);

    store.dispatch(saveToTabContainerInternal(delta()));
    store.dispatch(openSearchPanel());
    store.dispatch(setSearchInputText('Example Domain'));

    expect(await screen.findByText('Matches: 1 Window - 1 Tab')).toBeTruthy();

    store.dispatch(setSearchInputText(''));
    store.dispatch(closeSearchPanel());

    expect(await screen.findByText('7 Windows - 13 Tabs')).toBeTruthy();
    expect(screen.queryByText(/^Matches:/)).toBeNull();
  });
});

describe('right pane count label', () => {
  test('describes the session when no search is running', async () => {
    await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(delta()));
      },
    });

    expect(await screen.findByText('7 Windows - 13 Tabs')).toBeTruthy();
  });

  test('says the counts are matches while a search is narrowing them', async () => {
    await renderWithProviders(<HeroContainerRight />, {
      seedStore: (store) => {
        store.dispatch(saveToTabContainerInternal(delta()));
        store.dispatch(openSearchPanel());
        store.dispatch(setSearchInputText('Example Domain'));
      },
    });

    expect(await screen.findByText('Matches: 1 Window - 1 Tab')).toBeTruthy();
    expect(screen.queryByText('1 Window - 1 Tab')).toBeNull();
  });
});
