import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// KAN-206. One control in the session header that folds every window in the
// selected session, and unfolds them again.
//
// The control cannot be built where the state currently lives. Collapse is
// `useState(true)` local to each WindowEntryContainer, and HeroContainerRight
// is its SIBLING -- both hang off RightPane -- so there is no prop path from
// the button to the chevrons. The state has to move into globalState, which is
// session-only: never persisted, never synced.
//
// Moving it costs something that has to be paid back deliberately. Today's
// "collapse resets when you switch sessions" is not implemented anywhere: it is
// a free side-effect of TabGroupDetailsContainer keying each window by
// windowId, so switching sessions swaps the key set, React remounts and
// useState(true) re-runs. The comment there records that an earlier
// effect-based reset was DELETED as redundant with that key (KAN-51). Lift the
// state out and the mechanism goes with it -- see the second test.

const buildWindow = (n: number, title: string, tabTitles: string[]) => ({
  windowId: `win-${n}`,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabTitles.length,
  title,
  tabs: tabTitles.map((tabTitle, i) => ({
    tabId: `w${n}-t${i}`,
    favicon: '',
    title: tabTitle,
    url: `https://example.com/w${n}/t${i}`,
  })),
});

// A factory rather than a shared constant, for the reason renameDrafts gives:
// saveToTabContainerInternal's reducer mutates what it is handed and Immer
// freezes it, so a session reused across tests arrives frozen and throws.
const buildGroup = (
  n: number,
  title: string,
  windows: ReturnType<typeof buildWindow>[]
) => ({
  tabGroupId: `group-${n}`,
  title,
  createdTime: `2026-09-01 09:0${n}:00`,
  createdAt: Date.UTC(2026, 8, 1, 9, n, 0),
  windowCount: windows.length,
  tabCount: windows.reduce((sum, w) => sum + w.tabs.length, 0),
  isAutoSave: false,
  isSelected: false,
  windows,
});

// The pane as the user meets it: the header and the window list together. The
// whole point of the ticket is that these two are siblings, so a test that
// renders only one of them cannot see the feature at all.
const pane = (
  <>
    <HeroContainerRight />
    <TabGroupDetailsContainer />
  </>
);

// How many windows are currently open, counted from the chevrons themselves
// rather than from the store -- an open window's accordion offers to Collapse
// it. Reading the rendered control is what makes these tests indifferent to
// where the state ends up living.
const openCount = () => screen.queryAllByLabelText('Collapse').length;
const shutCount = () => screen.queryAllByLabelText('Expand').length;

describe('collapse every window in a session (KAN-206)', () => {
  describe('the control folds and unfolds the whole session', () => {
    test('collapses every window at once', async () => {
      await renderWithProviders(pane, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Alpha Page']),
                buildWindow(2, 'Afternoon reading', ['Bravo Page']),
                buildWindow(3, 'Evening reading', ['Charlie Page']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      expect(await screen.findByText('Alpha Page')).toBeTruthy();
      expect(openCount()).toBe(3);

      await userEvent.click(screen.getByLabelText('Collapse all windows'));

      expect(openCount()).toBe(0);
      expect(shutCount()).toBe(3);
      expect(screen.queryByText('Alpha Page')).toBeNull();
      expect(screen.queryByText('Bravo Page')).toBeNull();
      expect(screen.queryByText('Charlie Page')).toBeNull();
    });

    test('expands every window again once they are all shut', async () => {
      await renderWithProviders(pane, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Alpha Page']),
                buildWindow(2, 'Afternoon reading', ['Bravo Page']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      await userEvent.click(
        await screen.findByLabelText('Collapse all windows')
      );
      expect(openCount()).toBe(0);

      // The control has changed what it offers, which is the whole of the
      // majority rule's visible half: with everything shut, the only thing
      // left to do is open them.
      await userEvent.click(screen.getByLabelText('Expand all windows'));

      expect(openCount()).toBe(2);
      expect(screen.getByText('Alpha Page')).toBeTruthy();
      expect(screen.getByText('Bravo Page')).toBeTruthy();
    });

    // THE TEST THAT DISCRIMINATES. Every other assertion in this file passes
    // just as happily against a strict-flip boolean that ignores the windows
    // and simply alternates on each press.
    //
    // This is the one ordering where the two implementations disagree. After
    // collapsing everything and then opening ONE window by hand, majority-rules
    // asks "is any window open?" -- yes -- and collapses them all. A boolean
    // remembers only that its last act was to collapse, so it expands instead,
    // and the press appears to do nothing to the two windows already shut
    // while undoing the user's manual open.
    //
    // Deliberately NOT written as "collapse one by hand, then press", which is
    // the intuitive shape and which BOTH implementations pass.
    test('a window opened by hand makes the control collapse again, not expand', async () => {
      await renderWithProviders(pane, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Alpha Page']),
                buildWindow(2, 'Afternoon reading', ['Bravo Page']),
                buildWindow(3, 'Evening reading', ['Charlie Page']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      await userEvent.click(
        await screen.findByLabelText('Collapse all windows')
      );
      expect(openCount()).toBe(0);

      // One window back open, by its own chevron.
      await userEvent.click(screen.queryAllByLabelText('Expand')[0]);
      expect(openCount()).toBe(1);
      expect(shutCount()).toBe(2);

      // Any window open means the control offers to collapse, not to expand.
      await userEvent.click(screen.getByLabelText('Collapse all windows'));

      expect(openCount()).toBe(0);
      expect(shutCount()).toBe(3);
    });
  });

  describe('the reset that the windowId key used to provide for free', () => {
    // The behaviour renameDrafts.test.tsx pins for the per-window chevron,
    // restated for the whole session and for a state that no longer lives in
    // the component. Leaving a session and coming back shows it expanded.
    //
    // CONTROL: make the stored set a bare windowId list -- i.e. drop the
    // tabGroupId it is paired with, so the selector stops asking whether the
    // set belongs to the session on screen. This MUST go red. If it stays
    // green the pairing is not what is doing the work and this test is not
    // testing the reset.
    test('a session collapsed and left comes back expanded', async () => {
      const { store } = await renderWithProviders(pane, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Alpha Page']),
                buildWindow(2, 'Afternoon reading', ['Bravo Page']),
              ])
            )
          );
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(3, 'Holiday', [
                buildWindow(3, 'Flights', ['Charlie Page']),
                buildWindow(4, 'Hotels', ['Delta Page']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      await userEvent.click(
        await screen.findByLabelText('Collapse all windows')
      );
      expect(openCount()).toBe(0);

      act(() => {
        store.dispatch(selectTabContainer('group-3'));
      });

      // The other session was never collapsed, so it opens as it always did.
      expect(await screen.findByText('Charlie Page')).toBeTruthy();
      expect(openCount()).toBe(2);

      act(() => {
        store.dispatch(selectTabContainer('group-1'));
      });

      // AND COMING BACK IS THE ASSERTION. A bare id list would still hold
      // win-1 and win-2 here and fold them on arrival.
      expect(await screen.findByText('Alpha Page')).toBeTruthy();
      expect(screen.getByText('Bravo Page')).toBeTruthy();
      expect(openCount()).toBe(2);
    });

    // The other side of the same branch. Forgetting is keyed on the session
    // CHANGING, not on a selection happening, and selecting the session already
    // open is reachable: clicking its row in the left pane dispatches
    // selectTabContainer with the id it already holds
    // (TabGroupEntryContainer:229).
    //
    // CONTROL: drop the `!==` comparison so the case clears on every
    // selectTabContainer. This MUST go red while the test above stays green --
    // which is the point of having both, since a clear-always implementation
    // satisfies "comes back expanded" perfectly well.
    test('re-selecting the session already open keeps it folded', async () => {
      const { store } = await renderWithProviders(pane, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Alpha Page']),
                buildWindow(2, 'Afternoon reading', ['Bravo Page']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      await userEvent.click(
        await screen.findByLabelText('Collapse all windows')
      );
      expect(openCount()).toBe(0);

      act(() => {
        store.dispatch(selectTabContainer('group-1'));
      });

      expect(openCount()).toBe(0);
      expect(screen.queryByText('Alpha Page')).toBeNull();
    });
  });

  describe('folding a session is not an edit to it', () => {
    // Collapse is a view preference. It must not reach Firestore and must not
    // land on the undo stack -- pressing Undo after folding a session should
    // reverse whatever real edit came before it, not unfold windows.
    //
    // The middleware under test here is the real one: makeTestStore concats
    // customMiddleware, so these assertions run against the same two gates the
    // app uses -- isDataStateChangeAction for undo capture, and the setIsDirty
    // action type for the sync.
    //
    // CONTROL: call markDirty in the new reducer, or make it write anything at
    // all into tabContainerDataState. Either must turn this red.
    //
    // setIsNotDirty in the seed is load-bearing, and the first draft of this
    // test did without it and was wrong twice over. Seeding a session is itself
    // an edit -- saveToTabContainerInternal dirties the store -- so the flag is
    // already true before the control is ever pressed. Asserting `isDirty ===
    // false` without clearing it first fails against correct code; asserting
    // "unchanged" instead would pass against ANY code, including a reducer that
    // calls markDirty, because the value was true going in and true coming out.
    // A clean baseline is what gives the control something to turn red.
    test('collapsing all windows neither dirties the session nor enters undo history', async () => {
      const { store } = await renderWithProviders(pane, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Alpha Page']),
                buildWindow(2, 'Afternoon reading', ['Bravo Page']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
          s.dispatch(setIsNotDirty());
        },
      });

      await screen.findByText('Alpha Page');

      const dataBefore = store.getState().tabContainerDataState;
      const undoDepthBefore = store.getState().undoRedo.past.length;

      await userEvent.click(screen.getByLabelText('Collapse all windows'));
      expect(openCount()).toBe(0);

      // Reference identity, not deep equality: the undo capture gate is
      // `prevState.tabContainerDataState !== nextState.tabContainerDataState`,
      // so an untouched reference is exactly what makes the gate hold.
      expect(store.getState().tabContainerDataState).toBe(dataBefore);
      expect(store.getState().globalState.isDirty).toBe(false);
      expect(store.getState().undoRedo.past.length).toBe(undoDepthBefore);
    });

    // The per-window chevron moves into the store alongside the header
    // control, so it gets the same guarantee stated separately -- it is a
    // different reducer and could be written to dirty the session while the
    // header one does not.
    //
    // NOT RED, and deliberately so: the chevron already works, so this passes
    // before the ticket is implemented. It is a regression guard on behaviour
    // that must survive the state moving out of the component, and it must stay
    // green throughout rather than turn green at the end.
    test('collapsing a single window neither dirties the session nor enters undo history', async () => {
      const { store } = await renderWithProviders(pane, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Alpha Page']),
                buildWindow(2, 'Afternoon reading', ['Bravo Page']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
          s.dispatch(setIsNotDirty());
        },
      });

      await screen.findByText('Alpha Page');

      const dataBefore = store.getState().tabContainerDataState;
      const undoDepthBefore = store.getState().undoRedo.past.length;

      await userEvent.click(screen.queryAllByLabelText('Collapse')[0]);
      expect(screen.queryByText('Alpha Page')).toBeNull();

      expect(store.getState().tabContainerDataState).toBe(dataBefore);
      expect(store.getState().globalState.isDirty).toBe(false);
      expect(store.getState().undoRedo.past.length).toBe(undoDepthBefore);
    });
  });
});
