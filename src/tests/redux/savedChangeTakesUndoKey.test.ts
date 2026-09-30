import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load. In node, window is made
// globalThis itself, so window.screen is the screen set beside it.
vi.hoisted(() => {
  Object.assign(globalThis, {
    window: globalThis,
    screen: { height: 1080, width: 1920 },
  });
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  selectReopenOfferForKey,
  showToast,
} from '../../redux/slices/globalStateSlice';
import {
  addCurrTabToWindow,
  addCurrWindowToTabGroup,
  deleteTab,
  deleteTabContainer,
  deleteWindow,
  resetSessionOrder,
  saveToTabContainer,
  saveToTabContainerInternal,
  sortSessions,
} from '../../redux/slices/tabContainerDataStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-349 Q1 C′. Every toast that announces a saved-session change the user
// just made takes ⌘Z from a Reopen offer showing above it. One test per call
// site: a thunk that forgets the flag leaves the key with an older close, and
// ⌘Z then reopens a tab instead of undoing what the user just did.

type Store = ReturnType<typeof makeTestStore>['store'];

const window1 = (id: string) => ({
  windowId: `${id}-w`,
  windowHeight: 1,
  windowWidth: 1,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title: 'Window',
  tabs: [{ tabId: `${id}-t`, favicon: '', title: 'T', url: 'https://a.co' }],
});

const session = (id: string, title: string) => ({
  tabGroupId: id,
  title,
  createdTime: '2026-09-10 12:00:00',
  createdAt: 1,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [window1(id)],
});

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 10, 12, 0, 0);

// The clock is pinned per save (KAN-145): saves stamp Date.now(), which
// orders the list before any rank exists. Seeded oldest first, so the list
// reads newest first: Banana, Cherry, Apple -> Apple, Cherry, Banana.
const seed = (store: Store) => {
  ['Banana', 'Cherry', 'Apple'].forEach((title, i) => {
    vi.setSystemTime(T0 + i * HOUR);
    store.dispatch(saveToTabContainerInternal(session(`g${i}`, title)));
  });
  vi.setSystemTime(T0 + 10 * HOUR);
};

const texts = (store: Store) =>
  store.getState().globalState.toasts.map((t) => t.text);

async function withOffer() {
  const { store } = makeTestStore();
  seed(store);
  await store.dispatch(
    showToast({
      toastText: TOAST_MESSAGES.TAB_CLOSED,
      duration: 8000,
      reopenOfferId: 7,
    })
  );
  expect(selectReopenOfferForKey(store.getState())).toBe(7);
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a saved-session change takes ⌘Z from the offer (Q1 C′)', () => {
  test('saving', async () => {
    const store = await withOffer();
    await store.dispatch(
      saveToTabContainer({
        container: session('g9', 'New'),
        scope: 'current-window',
      })
    );
    expect(texts(store)).toContain(TOAST_MESSAGES.SAVE_CURRENT_WINDOW_SUCCESS);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('adding the current window to a session', async () => {
    const store = await withOffer();
    await store.dispatch(
      addCurrWindowToTabGroup({ tabGroupId: 'g0', window: window1('n') })
    );
    expect(texts(store)).toContain(
      TOAST_MESSAGES.ADD_CURR_WINDOW_TO_TABGROUP_SUCCESS
    );
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('adding the current tab to a window', async () => {
    const store = await withOffer();
    await store.dispatch(
      addCurrTabToWindow({
        tabGroupId: 'g0',
        windowId: 'g0-w',
        tabData: { tabId: 'n-t', favicon: '', title: 'N', url: 'https://n.co' },
      })
    );
    expect(texts(store)).toContain(
      TOAST_MESSAGES.ADD_CURR_TAB_TO_WINDOW_SUCCESS
    );
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('deleting a session', async () => {
    const store = await withOffer();
    await store.dispatch(deleteTabContainer('g0'));
    expect(texts(store)).toContain(TOAST_MESSAGES.DELETE_TAB_CONTAINER_SUCCESS);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('deleting a window', async () => {
    const store = await withOffer();
    await store.dispatch(deleteWindow({ tabGroupId: 'g0', windowId: 'g0-w' }));
    expect(texts(store)).toContain(TOAST_MESSAGES.DELETE_WINDOW_SUCCESS);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('deleting a tab', async () => {
    const store = await withOffer();
    await store.dispatch(
      deleteTab({ tabGroupId: 'g0', windowId: 'g0-w', tabId: 'g0-t' })
    );
    expect(texts(store)).toContain(TOAST_MESSAGES.DELETE_TAB_SUCCESS);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('sorting the sessions', async () => {
    const store = await withOffer();
    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));
    expect(texts(store)).toContain(TOAST_MESSAGES.SESSION_ORDER_CHANGED);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('resetting the session order', async () => {
    const { store } = makeTestStore();
    seed(store);
    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));
    await store.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.TAB_CLOSED,
        duration: 8000,
        reopenOfferId: 7,
      })
    );
    expect(selectReopenOfferForKey(store.getState())).toBe(7);

    await store.dispatch(resetSessionOrder());
    expect(texts(store)).toContain(TOAST_MESSAGES.SESSION_ORDER_CHANGED);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });
});
