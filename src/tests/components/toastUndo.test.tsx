import { describe, expect, test } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Toast } from '../../components/common/Toast';
import { renderWithProviders } from '../setup/renderWithProviders';
import { toastTexts } from '../setup/toasts';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { buildChromeTab } from '../fixtures/chromeTab';
import {
  setHasTabGroupsPermission,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { sortOpenWindowBySite } from '../../redux/sortOpenWindow';
import {
  deleteChromeTabGroup,
  deleteTab,
  deleteTabContainer,
  deleteWindow,
  recordsUndoStep,
  replaceSessionWithOpenWindows,
  replaceState,
  saveToTabContainerInternal,
  selectTabContainer,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  redo,
  resetHistory,
  selectNewestLiveStep,
  setPresentStartup,
  undo,
} from '../../redux/slices/undoRedoSlice';
import { keepLiveStep, undoStep } from '../../redux/undoHistory';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import type { OpenNowDrop } from '../../utils/functions/openNowMoves';

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

// KAN-640, KAN-641. Window, tab and tab group deletes say so in a toast that offers Undo, as a session's does.
describe('Undo in the window, tab and tab group delete toasts (KAN-640, KAN-641)', () => {
  const tab = (tabId: string, chromeGroupId?: string) => ({
    tabId,
    favicon: '',
    title: tabId,
    url: `https://${tabId}.test/`,
    ...(chromeGroupId ? { chromeGroupId } : {}),
  });
  const win = (windowId: string, tabs: ReturnType<typeof tab>[]) => ({
    windowId,
    windowHeight: 800,
    windowWidth: 1200,
    windowOffsetTop: 0,
    windowOffsetLeft: 0,
    tabCount: tabs.length,
    title: windowId,
    tabs,
  });
  // Two windows, so no delete here empties the session.
  const TRIP = buildSession({
    tabGroupId: 'trip',
    title: 'Trip',
    windowCount: 2,
    tabCount: 4,
    windows: [
      {
        ...win('w1', [tab('loose'), tab('g1', 'grp'), tab('g2', 'grp')]),
        chromeTabGroups: [{ groupId: 'grp', title: 'Booked', color: 'blue' }],
      },
      win('w2', [tab('other')]),
    ],
  });

  const renderTrip = () =>
    renderWithProviders(<Toast />, {
      seedStore: (store) => {
        store.dispatch(replaceState(buildContainer([TRIP])));
        store.dispatch(
          setPresentStartup({
            tabContainerDataState: store.getState().tabContainerDataState,
          })
        );
      },
    });
  type TripStore = Awaited<ReturnType<typeof renderTrip>>['store'];
  const windowsOf = (store: TripStore) =>
    store
      .getState()
      .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 'trip')
      ?.windows.map((w) => ({
        windowId: w.windowId,
        tabIds: w.tabs.map((t) => t.tabId),
        groupIds: (w.chromeTabGroups ?? []).map((g) => g.groupId),
      }));
  const offers = (store: TripStore) =>
    store.getState().globalState.toasts.map((t) => t.offersUndo);

  test.each([
    [
      'window',
      () => deleteWindow({ tabGroupId: 'trip', windowId: 'w2' }),
      TOAST_MESSAGES.DELETE_WINDOW_SUCCESS,
    ],
    [
      'tab',
      () => deleteTab({ tabGroupId: 'trip', windowId: 'w1', tabId: 'loose' }),
      TOAST_MESSAGES.DELETE_TAB_SUCCESS,
    ],
    [
      'tab group',
      () =>
        deleteChromeTabGroup({
          tabGroupId: 'trip',
          windowId: 'w1',
          groupId: 'grp',
        }),
      TOAST_MESSAGES.DELETE_CHROME_GROUP_SUCCESS,
    ],
  ] as const)(
    'a %s delete says so and offers Undo, which puts it back',
    async (_, thunk, text) => {
      const user = userEvent.setup();
      const { store } = await renderTrip();
      const before = windowsOf(store);
      await act(async () => {
        await store.dispatch(thunk());
      });
      // PREMISE: deleted, and said so.
      expect(windowsOf(store)).not.toEqual(before);
      expect(toastTexts(store.getState())).toEqual([text]);

      await user.click(undoButtons()[0]);

      expect(windowsOf(store)).toEqual(before);
      expect(toastTexts(store.getState())).toEqual([]);
    }
  );

  test('two tab deletes: only the newer offers Undo, and it undoes that one', async () => {
    const user = userEvent.setup();
    const { store } = await renderTrip();
    await act(async () => {
      await store.dispatch(
        deleteTab({ tabGroupId: 'trip', windowId: 'w1', tabId: 'loose' })
      );
      await store.dispatch(
        deleteTab({ tabGroupId: 'trip', windowId: 'w1', tabId: 'g1' })
      );
    });

    expect(offers(store)).toEqual([false, true]);
    await user.click(undoButtons()[0]);

    // The first delete stands: one step back, not two.
    expect(windowsOf(store)?.[0].tabIds).toEqual(['g1', 'g2']);
  });

  test('a delete that empties the session: Undo brings the whole session back', async () => {
    const user = userEvent.setup();
    const { store } = await renderTrip();
    const before = windowsOf(store);
    await act(async () => {
      await store.dispatch(
        deleteWindow({ tabGroupId: 'trip', windowId: 'w2' })
      );
    });
    await act(async () => {
      await store.dispatch(
        deleteWindow({ tabGroupId: 'trip', windowId: 'w1' })
      );
    });
    // PREMISE: the last window took the session with it.
    expect(windowsOf(store)).toBeUndefined();
    expect(offers(store)).toEqual([false, true]);

    await user.click(undoButtons()[0]);

    // One step: the session, holding the window the first delete left.
    expect(windowsOf(store)).toEqual(before?.slice(0, 1));
  });

  test('a delete that found nothing records no step, so it offers no Undo', async () => {
    const { store } = await renderTrip();
    await act(async () => {
      await store.dispatch(
        deleteChromeTabGroup({
          tabGroupId: 'trip',
          windowId: 'w1',
          groupId: 'gone',
        })
      );
    });

    expect(offers(store)).toEqual([false]);
    expect(undoButtons()).toHaveLength(0);
  });
});

// KAN-744 R16, R17. An Open now drag is a step in the same history: it strips an older saved toast's Undo, and ⌘Z takes it before an older offer, so the offer's hint goes while it is newest.
describe('a drag in the history and the toasts (KAN-744)', () => {
  const DROP: OpenNowDrop = {
    kind: 'tab',
    moved: [
      {
        tabId: 11,
        before: { windowId: 1, index: 0, groupId: -1, group: null },
        after: { windowId: 1, index: 1, groupId: -1, group: null },
      },
    ],
  };
  const reopenButton = () =>
    within(screen.getByRole('status')).getByRole('button', { name: 'Reopen' });
  const keepDrop = (store: Store) =>
    act(() => {
      keepLiveStep(store.dispatch, DROP);
    });

  test('a drag after a saved change strips the saved toast’s Undo', async () => {
    const { store } = await renderToasts();
    await deleteKyoto(store);
    // PREMISE: Undo is offered first.
    expect(undoButtons()).toHaveLength(1);

    keepDrop(store);

    expect(undoButtons()).toHaveLength(0);
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS,
    ]);
  });

  test('Reopen: no hint while a drag after it is newest, back once the drag leaves the history', async () => {
    const { store } = await renderToasts();
    await act(async () => {
      await store.dispatch(
        showToast({ toastText: TOAST_MESSAGES.TAB_CLOSED, reopenOfferId: 7 })
      );
    });
    // PREMISE: the hint shows.
    await waitFor(() =>
      expect(reopenButton()).toHaveAttribute('aria-keyshortcuts', 'Control+Z')
    );

    keepDrop(store);

    expect(reopenButton()).not.toHaveAttribute('aria-keyshortcuts');
    expect(reopenButton().querySelector('[data-key-hint]')).toBeNull();

    // Tab 11 is not where the drop left it, so the undo is refused and the step dropped.
    await act(async () => {
      await store.dispatch(undoStep());
    });

    expect(selectNewestLiveStep(store.getState())).toBeNull();
    expect(reopenButton()).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
  });

  test('a saved change after a drag: its Undo names the key', async () => {
    const { store } = await renderToasts();
    keepDrop(store);

    await deleteKyoto(store);

    expect(undoButtons()).toHaveLength(1);
    expect(undoButtons()[0]).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
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

// KAN-694. "Sorted the tabs by site." after Open now sorts a live window: its Undo puts the tabs back.
describe('Undo in the live sort toast (KAN-694)', () => {
  const renderSorted = async () => {
    const rendered = await renderWithProviders(<Toast />, {
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
      seedStore: (store) => store.dispatch(setHasTabGroupsPermission(true)),
    });
    await act(async () => {
      await rendered.store.dispatch(sortOpenWindowBySite(1));
    });
    return rendered;
  };
  const strip = async () =>
    (await chrome.tabs.query({ windowId: 1 }))
      .sort((a, b) => a.index - b.index)
      .map((tab) => tab.id);

  const dragTab2ToTheFront = (store: Store) =>
    act(() => {
      keepLiveStep(store.dispatch, {
        kind: 'tab',
        moved: [
          {
            tabId: 2,
            before: { windowId: 1, index: 2, groupId: -1, group: null },
            after: { windowId: 1, index: 0, groupId: -1, group: null },
          },
        ],
      });
    });

  test('offers Undo, naming the key; it puts the tabs back and closes the toast', async () => {
    const user = userEvent.setup();
    const { store } = await renderSorted();
    // PREMISE: sorted, and said so.
    expect(await strip()).toEqual([1, 3, 2]);
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.TABS_SORTED_BY_SITE,
    ]);
    await waitFor(() =>
      expect(undoButtons()[0]).toHaveAttribute('aria-keyshortcuts', 'Control+Z')
    );

    await user.click(undoButtons()[0]);

    await waitFor(async () => expect(await strip()).toEqual([1, 2, 3]));
    expect(selectNewestLiveStep(store.getState())).toBeNull();
    expect(toastTexts(store.getState())).toEqual([]);
  });

  // R16. The chip walks the one history: the sort goes to the redo list, as ⌘Z would send it.
  test('the sort chip undoes the sort', async () => {
    const user = userEvent.setup();
    const { store, seen } = await renderSorted();
    const step = selectNewestLiveStep(store.getState());
    expect(step?.drop.kind).toBe('sort');

    await user.click(undoButtons()[0]);

    await waitFor(async () => expect(await strip()).toEqual([1, 2, 3]));
    expect(seen).toContain('history/undoStep/fulfilled');
    expect(store.getState().undoRedo.future[0]?.liveStep?.id).toBe(step?.id);
  });

  // R16. A saved change is a newer step: the chip would undo it, not the sort.
  test('a saved change after the sort takes Undo off; the toast stays', async () => {
    const { store } = await renderSorted();
    // PREMISE: Undo is offered first.
    expect(undoButtons()).toHaveLength(1);

    act(() => {
      store.dispatch(saveToTabContainerInternal(KYOTO));
    });

    expect(undoButtons()).toHaveLength(0);
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.TABS_SORTED_BY_SITE,
    ]);
  });

  // R14, R16. A wipe of the saved steps leaves the sort newest; a drag is newer.
  test('the sort toast keeps its Undo while its sort is newest, and loses it after a drag', async () => {
    const { store } = await renderSorted();
    expect(undoButtons()).toHaveLength(1);

    act(() => {
      store.dispatch(
        resetHistory({
          tabContainerDataState: store.getState().tabContainerDataState,
        })
      );
    });

    expect(undoButtons()).toHaveLength(1);

    dragTab2ToTheFront(store);

    expect(undoButtons()).toHaveLength(0);
    expect(toastTexts(store.getState())).toEqual([
      TOAST_MESSAGES.TABS_SORTED_BY_SITE,
    ]);
  });

  test('⌘Z taking the sort takes Undo off', async () => {
    const { store } = await renderSorted();
    expect(undoButtons()).toHaveLength(1);

    await act(async () => {
      await store.dispatch(undoStep());
    });

    expect(undoButtons()).toHaveLength(0);
  });
});
