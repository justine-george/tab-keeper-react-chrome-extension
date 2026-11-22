import { describe, expect, test } from 'vitest';
import { act } from '@testing-library/react';

import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import { toastTexts } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import {
  setHasTabGroupsPermission,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { sortOpenWindowBySite } from '../../redux/sortOpenWindow';
import {
  deleteTabContainer,
  replaceState,
  saveToTabContainer,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  resetHistory,
  setPresentStartup,
} from '../../redux/slices/undoRedoSlice';
import { redoStep, undoStep } from '../../redux/undoHistory';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-981. An undo (⌘Z, the menu, a toast's Undo) closes only the toasts
// announcing the step it took; every other toast stays. A redo, or a press
// with nothing to step, closes none.

const KYOTO = buildSession({ tabGroupId: 'kyoto', title: 'Kyoto' });
const OSAKA = buildSession({ tabGroupId: 'osaka', title: 'Osaka' });

const renderToasts = () =>
  renderWithProviders(<Toast />, {
    seed: {
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, url: 'https://b.test/', active: true },
            { id: 2, url: 'https://a.test/' },
            { id: 3, url: 'https://b.test/2' },
          ],
        },
      ],
    },
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(replaceState(buildContainer([KYOTO, OSAKA])));
      store.dispatch(
        setPresentStartup({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    },
  });

type Store = Awaited<ReturnType<typeof renderToasts>>['store'];

const toastIds = (store: Store) =>
  store.getState().globalState.toasts.map((t) => t.id);

const save = (store: Store, n: number) =>
  act(async () => {
    await store.dispatch(
      saveToTabContainer({
        container: buildSession({ tabGroupId: `saved-${n}`, title: `S${n}` }),
        scope: 'all-windows',
      })
    );
  });

const plain = (store: Store, toastText: string) =>
  act(async () => {
    await store.dispatch(showToast({ toastText }));
  });

const undo = (store: Store) =>
  act(async () => {
    await store.dispatch(undoStep());
  });

const redo = (store: Store) =>
  act(async () => {
    await store.dispatch(redoStep());
  });

describe('an undo closes only its own toast (KAN-981)', () => {
  test('four saves: each ⌘Z closes the newest save’s toast, one at a time', async () => {
    const { store } = await renderToasts();
    for (const n of [1, 2, 3, 4]) await save(store, n);
    const [first, second, third, fourth] = toastIds(store);
    // PREMISE: four "saved" toasts are up, one per save.
    expect(toastTexts(store.getState())).toHaveLength(4);
    expect(new Set(toastTexts(store.getState())).size).toBe(1);

    await undo(store);
    expect(toastIds(store)).toEqual([first, second, third]);
    expect(fourth).toBeDefined();

    await undo(store);
    expect(toastIds(store)).toEqual([first, second]);
  });

  // A selection moves `present` without a step: the save is still the step on top.
  test('a save, then a selection: ⌘Z still closes the save’s toast', async () => {
    const { store } = await renderToasts();
    await save(store, 1);
    act(() => {
      store.dispatch(selectTabContainer('osaka'));
    });
    // PREMISE: the selection moved `present`.
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'osaka'
    );

    await undo(store);

    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('a toast that announces no change stays up through an undo', async () => {
    const { store } = await renderToasts();
    await plain(store, TOAST_MESSAGES.SYNC_MERGED);
    await act(async () => {
      await store.dispatch(deleteTabContainer('kyoto'));
    });
    await plain(store, TOAST_MESSAGES.COPY_LINKS_SUCCESS);
    // PREMISE: all three are up.
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.SYNC_MERGED,
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
      TOAST_MESSAGES.COPY_LINKS_SUCCESS,
    ]);

    await undo(store);

    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.SYNC_MERGED,
      TOAST_MESSAGES.COPY_LINKS_SUCCESS,
    ]);
  });

  test('undoing an older step closes that step’s toast, past one that lost its Undo', async () => {
    const { store } = await renderToasts();
    await act(async () => {
      await store.dispatch(deleteTabContainer('kyoto'));
    });
    await act(async () => {
      await store.dispatch(deleteTabContainer('osaka'));
    });
    await undo(store);
    // PREMISE: Osaka's toast went with its undo; Kyoto's is up, its Undo taken off by the newer delete.
    expect(store.getState().globalState.toasts).toMatchObject([
      { text: TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS, offersUndo: false },
    ]);

    await undo(store);

    expect(toastTexts(store.getState())).toEqual([]);
  });

  test('undoing a sort closes the sort’s toast and leaves the save’s', async () => {
    const { store } = await renderToasts();
    await save(store, 1);
    await act(async () => {
      await store.dispatch(sortOpenWindowBySite(1));
    });
    // PREMISE: the save's toast, then the sort's.
    expect(toastTexts(store.getState())).toEqual([
      toastTexts(store.getState())[0],
      TOAST_MESSAGES.TABS_SORTED_BY_SITE,
    ]);
    const [saved] = toastIds(store);

    await undo(store);

    expect(toastIds(store)).toEqual([saved]);
  });

  test('a redo closes nothing', async () => {
    const { store } = await renderToasts();
    await save(store, 1);
    await save(store, 2);
    await undo(store);
    await plain(store, TOAST_MESSAGES.COPY_LINKS_SUCCESS);
    const before = toastIds(store);
    // PREMISE: save 1's toast and the plain one are up, and save 2 waits to be redone.
    expect(before).toHaveLength(2);
    expect(store.getState().undoRedo.future).toHaveLength(1);

    await redo(store);

    expect(store.getState().undoRedo.future).toHaveLength(0);
    expect(toastIds(store)).toEqual(before);
  });

  test('a press with nothing to undo or redo closes nothing', async () => {
    const { store } = await renderToasts();
    await plain(store, TOAST_MESSAGES.COPY_LINKS_SUCCESS);
    // PREMISE: nothing to step either way.
    expect(store.getState().undoRedo.past).toEqual([]);
    expect(store.getState().undoRedo.future).toEqual([]);

    await undo(store);
    await redo(store);

    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.COPY_LINKS_SUCCESS,
    ]);
  });

  // Worst path: the step a toast announced left the history before the undo reached it.
  test('a toast whose step a reset took out stays up when an undo steps past it', async () => {
    const { store } = await renderToasts();
    await save(store, 1);
    await act(async () => {
      store.dispatch(
        resetHistory({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    });
    await act(async () => {
      await store.dispatch(sortOpenWindowBySite(1));
    });
    const [saved] = toastIds(store);
    // PREMISE: the save is no longer a step; the sort is the only one.
    expect(store.getState().undoRedo.past).toHaveLength(1);

    await undo(store);

    expect(toastIds(store)).toEqual([saved]);
  });

  test('a toast that says it announces a change, but recorded no step, stays up', async () => {
    const { store } = await renderToasts();
    await save(store, 1);
    await act(async () => {
      await store.dispatch(
        showToast({
          toastText: TOAST_MESSAGES.SESSION_ORDER_CHANGED,
          announcesSavedChange: true,
          announcesStep: null,
        })
      );
    });
    const [, unstepped] = toastIds(store);

    await undo(store);

    expect(toastIds(store)).toEqual([unstepped]);
  });
});
