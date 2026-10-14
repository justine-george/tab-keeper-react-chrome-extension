import { describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import { toastTexts } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab } from '../fixtures/chromeTab';
import { showToast } from '../../redux/slices/globalStateSlice';
import {
  deleteTabContainer,
  recordsUndoStep,
  replaceSessionWithOpenWindows,
  replaceState,
  selectTabContainer,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  redo,
  resetHistory,
  setPresentStartup,
  undo,
} from '../../redux/slices/undoRedoSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-583. "Session deleted." and "Session replaced…" offer Undo, which steps back as ⌘Z does.
// Only while that change is still the latest undo step (L1): a later one takes the button off.

const KYOTO = buildSession({ tabGroupId: 'kyoto', title: 'Kyoto' });
const OSAKA = buildSession({ tabGroupId: 'osaka', title: 'Osaka' });

const renderToasts = () =>
  renderWithProviders(<Toast />, {
    seed: {
      windows: [
        {
          id: 1,
          tabs: [
            buildChromeTab({
              id: 11,
              windowId: 1,
              url: 'https://open.test/',
              title: 'Open now',
            }),
          ],
        },
      ],
    },
    seedStore: (store) => {
      store.dispatch(replaceState(buildContainer([KYOTO, OSAKA])));
      store.dispatch(
        setPresentStartup({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    },
  });

type Store = Awaited<ReturnType<typeof renderToasts>>['store'];

const sessionIds = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);
const urlsOf = (store: Store, id: string) =>
  store
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id)
    ?.windows.flatMap((w) => w.tabs.map((t) => t.url));
const undoButtons = () =>
  within(screen.getByRole('status')).queryAllByRole('button', {
    name: 'Undo',
  });

const deleteKyoto = (store: Store) =>
  act(async () => {
    await store.dispatch(deleteTabContainer('kyoto'));
  });

describe('Undo in the Delete and Replace toasts (KAN-583)', () => {
  test('Delete offers Undo; it brings the session back and closes the toast', async () => {
    const user = userEvent.setup();
    const { store } = await renderToasts();
    await deleteKyoto(store);
    // PREMISE: deleted, and said so.
    expect(sessionIds(store)).toEqual(['osaka']);
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
    ]);

    await user.click(undoButtons()[0]);

    expect(sessionIds(store)).toContain('kyoto');
    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('Replace offers Undo; it puts back what the session held', async () => {
    const user = userEvent.setup();
    const { store } = await renderToasts();
    const before = urlsOf(store, 'kyoto');
    await act(async () => {
      await store.dispatch(replaceSessionWithOpenWindows('kyoto'));
    });
    // PREMISE: replaced.
    expect(urlsOf(store, 'kyoto')).toEqual(['https://open.test/']);

    await user.click(undoButtons()[0]);

    expect(urlsOf(store, 'kyoto')).toEqual(before);
    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('the button names the undo key', async () => {
    const { store } = await renderToasts();
    await deleteKyoto(store);

    await waitFor(() =>
      expect(undoButtons()[0]).toHaveAttribute('aria-keyshortcuts', 'Control+Z')
    );
  });

  test('L1: a later change takes Undo off the older toast, which stays', async () => {
    const { store } = await renderToasts();
    await deleteKyoto(store);

    // PREMISE: Undo is offered first.
    expect(undoButtons()).toHaveLength(1);
    act(() => {
      store.dispatch(
        updateTabGroupTitle({ tabGroupId: 'osaka', editableTitle: 'Nara' })
      );
    });

    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
    ]);
    expect(undoButtons()).toHaveLength(0);
  });

  test('Replace then Delete: only the newest offers Undo, and it undoes the Delete', async () => {
    const user = userEvent.setup();
    const { store } = await renderToasts();
    await act(async () => {
      await store.dispatch(replaceSessionWithOpenWindows('osaka'));
    });
    await deleteKyoto(store);

    expect(
      store.getState().globalState.toasts.map((t) => t.offersUndo)
    ).toEqual([false, true]);
    await user.click(undoButtons()[0]);

    expect(sessionIds(store)).toContain('kyoto');
    // The Replace stands: one step back, not two.
    expect(urlsOf(store, 'osaka')).toEqual(['https://open.test/']);
  });

  test('selecting a session is no change: Undo stays', async () => {
    const { store } = await renderToasts();
    await deleteKyoto(store);

    // PREMISE: Undo is offered first.
    expect(undoButtons()).toHaveLength(1);
    act(() => {
      store.dispatch(selectTabContainer('osaka'));
    });

    expect(undoButtons()).toHaveLength(1);
  });

  test('a reset history (another page’s change, a merge) takes Undo off', async () => {
    const { store } = await renderToasts();
    await deleteKyoto(store);

    // PREMISE: Undo is offered first.
    expect(undoButtons()).toHaveLength(1);
    act(() => {
      store.dispatch(
        resetHistory({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    });

    expect(toastTexts(store.getState())).toHaveLength(1);
    expect(undoButtons()).toHaveLength(0);
  });

  test.each([
    ['undo', undo],
    ['redo', redo],
  ])('%s from the key or the header closes the Undo toast', async (_, step) => {
    const { store } = await renderToasts();
    await deleteKyoto(store);

    act(() => {
      store.dispatch(step());
    });

    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('a Reopen offer shown after takes the key: Undo still works by click, without the hint', async () => {
    const user = userEvent.setup();
    const { store } = await renderToasts();
    await deleteKyoto(store);
    await act(async () => {
      await store.dispatch(
        showToast({ toastText: TOAST_MESSAGES.TAB_CLOSED, reopenOfferId: 7 })
      );
    });
    const reopen = within(screen.getByRole('status')).getByRole('button', {
      name: 'Reopen',
    });
    await waitFor(() =>
      expect(reopen).toHaveAttribute('aria-keyshortcuts', 'Control+Z')
    );

    expect(undoButtons()[0]).not.toHaveAttribute('aria-keyshortcuts');
    await user.click(undoButtons()[0]);
    expect(sessionIds(store)).toContain('kyoto');
  });
});

describe('recordsUndoStep (KAN-583)', () => {
  test('true for a change customMiddleware records, false for one it does not', async () => {
    const { store } = await renderToasts();

    expect(
      recordsUndoStep(store.getState, () =>
        store.dispatch(
          updateTabGroupTitle({ tabGroupId: 'osaka', editableTitle: 'Nara' })
        )
      )
    ).toBe(true);
    // Selecting moves `present` without a step: Undo would take back the rename.
    const presentBefore = store.getState().undoRedo.present;
    expect(
      recordsUndoStep(store.getState, () =>
        store.dispatch(selectTabContainer('osaka'))
      )
    ).toBe(false);
    // PREMISE: the selection did move `present`.
    expect(store.getState().undoRedo.present).not.toBe(presentBefore);
  });
});
