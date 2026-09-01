import { describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import SettingsCategoryContainer from '../../components/settings/leftpane/SettingsCategoryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  deleteTabContainerInternal,
  deleteTabInternal,
  deleteWindowInternal,
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-28. These lists were rendered without `key`, so React fell back to
// matching children by position. Every assertion below is about identity
// surviving a deletion higher up the list -- deliberately NOT about React's
// "unique key" console warning, which is satisfied just as well by a key={index}
// that leaves the underlying bug completely intact.
//
// The mutation test for this file: swap any stable id below for the array
// index. An index key IS the positional default, so all three tests must go
// red again. If they stay green they are not testing identity.

const buildWindow = (n: number, tabTitles: string[]) => ({
  windowId: `win-${n}`,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabTitles.length,
  title: `Window ${n}`,
  tabs: tabTitles.map((title, i) => ({
    tabId: `w${n}-t${i}`,
    favicon: '',
    title,
    url: `https://example.com/w${n}/t${i}`,
  })),
});

// A factory rather than a shared constant, for the same reason as
// TabGroupDetailsContainer.test.tsx: saveToTabContainerInternal mutates its
// payload and Immer freezes it, so a reused object throws on the second
// dispatch.
const buildGroup = (n: number, windows: ReturnType<typeof buildWindow>[]) => ({
  tabGroupId: `group-${n}`,
  title: `Group ${n}`,
  createdTime: `2026-09-01 09:0${n}:00`,
  windowCount: windows.length,
  tabCount: windows.reduce((sum, w) => sum + w.tabs.length, 0),
  isAutoSave: false,
  isSelected: false,
  windows,
});

describe('list identity across deletions (KAN-28)', () => {
  // The strongest of the three: collapse is local component state, so if the
  // wrong instance survives a deletion the user watches a window they never
  // touched fold itself shut.
  test('a collapsed window stays collapsed when the window above it is deleted', async () => {
    const { store } = await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(
          saveToTabContainerInternal(
            buildGroup(1, [
              buildWindow(1, ['Alpha Page']),
              buildWindow(2, ['Bravo Page']),
              buildWindow(3, ['Charlie Page']),
            ])
          )
        );
        s.dispatch(selectTabContainer('group-1'));
      },
    });

    // All three start expanded, so every accordion icon reads "collapse".
    const accordions = await screen.findAllByLabelText('collapse');
    expect(accordions).toHaveLength(3);

    // Collapse the middle window only.
    await userEvent.click(accordions[1]);
    expect(screen.queryByText('Bravo Page')).toBeNull();
    expect(screen.getByText('Charlie Page')).toBeTruthy();

    // Delete the window ABOVE the collapsed one. Window 2 slides into slot 0.
    act(() => {
      store.dispatch(
        deleteWindowInternal({ tabGroupId: 'group-1', windowId: 'win-1' })
      );
    });

    expect(screen.queryByText('Alpha Page')).toBeNull();
    // Positional matching hands slot 0's expanded state to window 2, so
    // unkeyed this row springs back open and Bravo Page reappears.
    expect(screen.queryByText('Bravo Page')).toBeNull();
    // ...and window 3 inherits slot 1's collapsed state, hiding a window the
    // user never collapsed.
    expect(screen.getByText('Charlie Page')).toBeTruthy();
  });

  // Tab rows carry no local state, so nothing bleeds -- but the DOM node is
  // still recycled onto a different tab, which is the same defect one layer
  // down (it costs focus, in-flight CSS transitions, and any state a future
  // row gains).
  test('a tab row keeps its DOM node when the tab above it is deleted', async () => {
    const { store } = await renderWithProviders(<TabGroupDetailsContainer />, {
      seedStore: (s) => {
        s.dispatch(
          saveToTabContainerInternal(
            buildGroup(1, [
              buildWindow(1, ['Alpha Page', 'Bravo Page', 'Charlie Page']),
            ])
          )
        );
        s.dispatch(selectTabContainer('group-1'));
      },
    });

    const bravoNodeBefore = await screen.findByText('Bravo Page');

    act(() => {
      store.dispatch(
        deleteTabInternal({
          tabGroupId: 'group-1',
          windowId: 'win-1',
          tabId: 'w1-t0',
        })
      );
    });

    // Unkeyed, React rewrites slot 0's existing node to say "Bravo Page"
    // instead of moving Bravo's own node up, so this is a different element.
    expect(screen.getByText('Bravo Page')).toBe(bravoNodeBefore);
  });

  test('a tab group row keeps its DOM node when the group above it is deleted', async () => {
    const { store } = await renderWithProviders(<TabGroupEntryContainer />, {
      seedStore: (s) => {
        s.dispatch(
          saveToTabContainerInternal(buildGroup(1, [buildWindow(1, ['A'])]))
        );
        s.dispatch(
          saveToTabContainerInternal(buildGroup(2, [buildWindow(2, ['B'])]))
        );
        s.dispatch(
          saveToTabContainerInternal(buildGroup(3, [buildWindow(3, ['C'])]))
        );
        // Select the group we are NOT deleting, so the deletion cannot change
        // selection and re-render the list for an unrelated reason.
        s.dispatch(selectTabContainer('group-2'));
      },
    });

    const groupTwoNodeBefore = await screen.findByText('Group 2');

    // saveToTabContainerInternal unshifts, so the rendered order is
    // [Group 3, Group 2, Group 1]. Group 3 is the row ABOVE Group 2 -- delete
    // the tail (Group 1) instead and positional matching gets the right answer
    // by accident, which is how the first draft of this test passed unkeyed.
    act(() => {
      store.dispatch(deleteTabContainerInternal('group-3'));
    });

    expect(screen.queryByText('Group 3')).toBeNull();
    expect(screen.getByText('Group 2')).toBe(groupTwoNodeBefore);
  });

  // Deliberately weaker than the three above, and the comment says so rather
  // than the test pretending otherwise.
  //
  // The settings category list cannot lose identity: it is five fixed enum
  // members, and the only exported action on that slice is selectCategory,
  // which flips isSelected in place. The slice does define a replaceState
  // reducer, but it is not in the slice's export list, so nothing can dispatch
  // it -- there is no reachable path that adds, removes, or reorders a
  // category. A deletion test here would be theatre against a scenario the app
  // cannot produce.
  //
  // So the warning IS the whole observable defect for this one, and asserting
  // on it is honest here for the same reason it would be dishonest above.
  test('the settings category list renders keyed', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      await renderWithProviders(<SettingsCategoryContainer />);

      expect(await screen.findByText('Display')).toBeTruthy();

      const keyWarnings = consoleError.mock.calls.filter((args) =>
        String(args[0]).includes('unique "key" prop')
      );
      expect(keyWarnings).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });
});
