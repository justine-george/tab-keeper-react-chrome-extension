import { describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  openSearchPanel,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';

// KAN-57, the search route. TabGroupEntryContainer selects the first filtered
// result on every keystroke (the effect keyed on [searchInputText], which
// unlike the click handler beside it has no same-id guard), so each character
// typed used to push an undo entry and clear the redo stack.
//
// Measured before the fix, typing four characters: past 2 -> 6, future 1 -> 0.
//
// This is the component-level counterpart to
// src/tests/redux/selectionIsNotUndoable.test.ts, which pins the same
// behaviour at the store. Kept separate because only this one proves search
// still routes through selection at all -- a store-level test cannot.

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

const renderSeeded = () =>
  renderWithProviders(<TabGroupEntryContainer />, {
    seedStore: (s) => {
      s.dispatch(saveToTabContainerInternal(buildGroup(1, 'Alpha')));
      s.dispatch(saveToTabContainerInternal(buildGroup(2, 'Bravo')));
      s.dispatch(openSearchPanel());
    },
  });

const type = async (
  store: Awaited<ReturnType<typeof renderSeeded>>['store'],
  text: string
) => {
  for (let i = 1; i <= text.length; i++) {
    await act(async () => {
      store.dispatch(setSearchInputText(text.slice(0, i)));
    });
  }
};

describe('searching does not flood undo history (KAN-57)', () => {
  test('typing four characters adds no undo entries', async () => {
    const { store } = await renderSeeded();
    const before = store.getState().undoRedo.past.length;

    await type(store, 'Alph');

    // The control: the search must actually have moved the selection, or the
    // effect never fired and this passes for the wrong reason.
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'group-1'
    );
    expect(store.getState().undoRedo.past.length).toBe(before);
  });

  test('typing does not destroy a pending redo', async () => {
    const { store } = await renderSeeded();

    await act(async () => {
      store.dispatch(
        updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'RENAMED' })
      );
    });
    await act(async () => {
      store.dispatch(undo());
    });
    expect(store.getState().undoRedo.future.length).toBeGreaterThan(0);

    await type(store, 'Alph');

    expect(store.getState().undoRedo.future.length).toBeGreaterThan(0);
  });
});
