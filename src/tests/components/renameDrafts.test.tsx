import { describe, expect, test } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HeroContainerRight from '../../components/home/rightpane/HeroContainerRight';
import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import {
  renderWithProviders,
  RenderWithProvidersResult,
} from '../setup/renderWithProviders';
import {
  replaceState,
  saveToTabContainerInternal,
  selectTabContainer,
  updateWindowGroupTitle,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-51. Three `react-hooks/set-state-in-effect` sites, all of them the same
// shape: a piece of state seeded from a prop by an effect.
//
// Two of them (HeroContainerRight's `editableTitle`, WindowEntryContainer's
// `newTitle`) are RENAME DRAFTS -- read only while `isEditing` is true. An
// effect that keeps re-seeding them from the prop for the component's whole
// lifetime does not just cost a render pass; it overwrites what the user is
// typing whenever the prop moves underneath them. That is reachable without
// any user action: customMiddleware.ts dispatches syncStateWithFirestore(),
// and the merge lands replaceState(merged) (globalStateSlice.ts:121).
//
// The third (WindowEntryContainer's `windowOpenState`) is a reset-on-identity
// -change, which is the job a `key` already does -- see the last test.

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

// A factory rather than a shared constant: saveToTabContainerInternal's reducer
// mutates what it is handed and Immer freezes it, so a session reused across
// tests arrives at the second dispatch already frozen and throws.
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

// What a Firestore merge does to the store: replaceState with a whole new
// container. structuredClone because the live state is Immer-frozen, and
// replaceState returns its payload verbatim -- so the copy has to be mutable
// and has to carry selectedTabGroupId, or the selection is lost for an
// unrelated reason and the test would pass by accident.
function landSyncMerge(
  store: RenderWithProvidersResult['store'],
  mutate: (container: TabMasterContainer) => void
) {
  const merged: TabMasterContainer = structuredClone(
    store.getState().tabContainerDataState
  );
  mutate(merged);
  act(() => {
    store.dispatch(replaceState(merged));
  });
}

describe('rename drafts survive the prop moving underneath them (KAN-51)', () => {
  describe('session title (HeroContainerRight)', () => {
    // The behaviour the effect currently provides, and the one a naive
    // "just delete the effect" silently breaks. Must stay green throughout.
    test('the rename field opens seeded with the current session title', async () => {
      await renderWithProviders(<HeroContainerRight />, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [buildWindow(1, 'Morning', ['Kagi'])])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      await userEvent.click(await screen.findByText('Research'));

      expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(
        'Research'
      );
    });

    // The second half of the same contract: seeding has to follow the
    // SELECTION, not just the first mount. Deleting the effect without moving
    // the seed into the click handler leaves this showing the stale title.
    test('the rename field seeds from the session selected now, not the one selected at mount', async () => {
      const { store } = await renderWithProviders(<HeroContainerRight />, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [buildWindow(1, 'Morning', ['Kagi'])])
            )
          );
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(2, 'Holiday', [buildWindow(2, 'Evening', ['Maps'])])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      expect(await screen.findByText('Research')).toBeTruthy();

      act(() => {
        store.dispatch(selectTabContainer('group-2'));
      });

      await userEvent.click(await screen.findByText('Holiday'));

      expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(
        'Holiday'
      );
    });

    // RED. The effect depends on the whole `selectedTabGroup` OBJECT, so any
    // change to the selected session -- including one the user did not make --
    // re-seeds the draft and throws away what they typed.
    test('an in-flight rename survives a sync merge landing', async () => {
      const { store } = await renderWithProviders(<HeroContainerRight />, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [buildWindow(1, 'Morning', ['Kagi'])])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      await userEvent.click(await screen.findByText('Research'));
      const input = screen.getByRole<HTMLInputElement>('textbox');

      await userEvent.clear(input);
      await userEvent.type(input, 'Thesis notes');
      expect(input.value).toBe('Thesis notes');

      // A merge lands while the user is still typing. It touches a DIFFERENT
      // session field -- the tab count -- so nothing about the title itself
      // changed; only the object identity did.
      landSyncMerge(store, (container) => {
        container.tabGroups[0].tabCount = 99;
      });

      expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(
        'Thesis notes'
      );
    });
  });

  describe('window title (WindowEntryContainer)', () => {
    test('the rename field opens seeded with the current window title', async () => {
      await renderWithProviders(<TabGroupDetailsContainer />, {
        seedStore: (s) => {
          s.dispatch(
            saveToTabContainerInternal(
              buildGroup(1, 'Research', [
                buildWindow(1, 'Morning reading', ['Kagi']),
              ])
            )
          );
          s.dispatch(selectTabContainer('group-1'));
        },
      });

      await userEvent.click(
        await screen.findByLabelText('rename window group')
      );

      expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(
        'Morning reading'
      );
    });

    // RED. Same defect one layer down. Here the effect depends on `title`
    // alone, so it takes a change to THAT window's title to trigger it --
    // which is what a merge carrying a rename made on another device does.
    // updateWindowGroupTitle is the minimal action that produces the identical
    // prop change; the reachable source is the sync merge.
    test('an in-flight rename survives that window being renamed elsewhere', async () => {
      const { store } = await renderWithProviders(
        <TabGroupDetailsContainer />,
        {
          seedStore: (s) => {
            s.dispatch(
              saveToTabContainerInternal(
                buildGroup(1, 'Research', [
                  buildWindow(1, 'Morning reading', ['Kagi']),
                ])
              )
            );
            s.dispatch(selectTabContainer('group-1'));
          },
        }
      );

      await userEvent.click(
        await screen.findByLabelText('rename window group')
      );
      const input = screen.getByRole<HTMLInputElement>('textbox');

      await userEvent.clear(input);
      await userEvent.type(input, 'Deep work');
      expect(input.value).toBe('Deep work');

      act(() => {
        store.dispatch(
          updateWindowGroupTitle({
            tabGroupId: 'group-1',
            windowId: 'win-1',
            editableTitle: 'Renamed on my laptop',
          })
        );
      });

      expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe(
        'Deep work'
      );
    });
  });

  describe('window collapse state (WindowEntryContainer)', () => {
    // NOT red -- this passes with the effect in place, and the point of the
    // ticket is that it also passes without it, because TabGroupDetailsContainer
    // keys each window by windowId (KAN-28) and window ids are uuidv4 minted in
    // exactly two places (capture.ts, HeroContainerRight) with nothing cloning a
    // session. Switching sessions therefore swaps the entire key set and React
    // remounts, which re-runs useState(true).
    //
    // A test that cannot fail proves nothing, so this one has a control: change
    // the key in TabGroupDetailsContainer to a constant (or to the array index,
    // which is the same thing for a single-window group -- use two windows) and
    // this MUST go red once the effect is gone. If it stays green it is not
    // testing the reset.
    test('a window collapsed in one session is not collapsed in another', async () => {
      const { store } = await renderWithProviders(
        <TabGroupDetailsContainer />,
        {
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
        }
      );

      const accordions = await screen.findAllByLabelText('collapse');
      expect(accordions).toHaveLength(2);

      // Collapse the SECOND window. Slot 1 in group-1 is collapsed; if the
      // instance is recycled rather than remounted, slot 1 of group-3 inherits
      // it and "Delta Page" disappears.
      await userEvent.click(accordions[1]);
      expect(screen.queryByText('Bravo Page')).toBeNull();

      act(() => {
        store.dispatch(selectTabContainer('group-3'));
      });

      expect(await screen.findByText('Charlie Page')).toBeTruthy();
      expect(screen.getByText('Delta Page')).toBeTruthy();
      expect(screen.queryAllByLabelText('collapse')).toHaveLength(2);
    });
  });
});
