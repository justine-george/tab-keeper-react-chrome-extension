import { afterEach, describe, expect, test, vi } from 'vitest';

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
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle } from '../setup/chrome.fake';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { closeOpenTab, closeOpenWindow } from '../../utils/functions/reopen';
import type { ClosedItem } from '../../utils/functions/reopen';
import {
  holdToast,
  releaseToast,
  showToast,
} from '../../redux/slices/globalStateSlice';
import {
  offerReopen,
  reopenFromOffer,
  REOPEN_TOAST_MS,
  takeReopenOffer,
} from '../../redux/reopenOffer';
import {
  clearReopenFocus,
  expectReopenedRow,
  pendingReopenFocus,
  REOPEN_FOCUS_MS,
  subscribeReopenFocus,
} from '../../redux/reopenFocus';
import {
  TOAST_MESSAGES,
  WINDOW_CLOSED_FRAME,
} from '../../utils/constants/common';

// KAN-280 O8a. The toast after a close offers Reopen for the latest close
// only, once, for 8 seconds, and the timer holds while the user is on it.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
  clearReopenFocus();
  handle?.restore();
  handle = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const url = (name: string) => `https://${name}.test/`;

// Read through toOpenWindows off the fake, never hand-built, so every item
// here is one a real close produces.
async function openWindow(id: number): Promise<OpenWindow> {
  const all = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const found = toOpenWindows(all, null, null).find((w) => w.id === id);
  if (!found) throw new Error(`no open window ${id}`);
  return found;
}

// Two tabs closed, in order, from window 2 (window 1 is Tab Keeper's).
async function closedTabs(): Promise<[ClosedItem, ClosedItem]> {
  handle = setupChromeFake({
    windows: [
      { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
      { id: 2, tabs: [{ url: url('a') }, { url: url('b') }] },
    ],
  });
  const w2 = await openWindow(2);
  const first = await closeOpenTab(w2, w2.tabs[0]);
  const second = await closeOpenTab(w2, w2.tabs[1]);
  if (!first || !second) throw new Error('close failed');
  return [first, second];
}

const openState = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().globalState.isToastOpen;

describe('the Reopen offer (KAN-280 O8a)', () => {
  test('an offer is taken once', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));
    const id = store.getState().globalState.toastReopenOfferId;
    if (id === null) throw new Error('no offer id');

    expect(takeReopenOffer(id)).toBe(item);
    expect(takeReopenOffer(id)).toBeNull();
  });

  test('a newer offer replaces the older one', async () => {
    const [a, b] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(a));
    const idA = store.getState().globalState.toastReopenOfferId;
    await store.dispatch(offerReopen(b));
    const idB = store.getState().globalState.toastReopenOfferId;
    if (idA === null || idB === null) throw new Error('no offer id');

    expect(idB).not.toBe(idA);
    expect(takeReopenOffer(idA)).toBeNull();
    expect(takeReopenOffer(idB)).toBe(b);
  });

  // KAN-280 O8a: a plain toast (a sync merge, say) replacing the Reopen toast
  // takes the offer with it -- in Redux AND in the registry.
  test('a plain toast drops the offer', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));
    const id = store.getState().globalState.toastReopenOfferId;
    if (id === null) throw new Error('no offer id');
    await store.dispatch(showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED }));

    expect(store.getState().globalState.toastReopenOfferId).toBeNull();
    expect(takeReopenOffer(id)).toBeNull();
  });

  test('the Reopen toast lasts 8 seconds; others keep theirs', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();
    vi.useFakeTimers();

    expect(REOPEN_TOAST_MS).toBe(8000);
    await store.dispatch(offerReopen(item));
    vi.advanceTimersByTime(7999);
    expect(openState(store)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(openState(store)).toBe(false);

    await store.dispatch(showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED }));
    vi.advanceTimersByTime(4999);
    expect(openState(store)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(openState(store)).toBe(false);
  });

  // A closed toast offers nothing, so the closed tab or window it named is
  // not kept in memory after the toast has timed out.
  test('the toast timing out drops the offer', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();
    vi.useFakeTimers();

    await store.dispatch(offerReopen(item));
    const id = store.getState().globalState.toastReopenOfferId;
    if (id === null) throw new Error('no offer id');
    vi.advanceTimersByTime(REOPEN_TOAST_MS);

    expect(openState(store)).toBe(false);
    expect(takeReopenOffer(id)).toBeNull();
  });

  test('held, the timer stops; released, it runs out the time that was left', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();
    vi.useFakeTimers();

    await store.dispatch(offerReopen(item));
    vi.advanceTimersByTime(3000);
    store.dispatch(holdToast());
    vi.advanceTimersByTime(20_000);
    expect(openState(store)).toBe(true);

    store.dispatch(releaseToast());
    vi.advanceTimersByTime(4999);
    expect(openState(store)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(openState(store)).toBe(false);
  });

  test('a window close says how many tabs it held', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
        {
          id: 2,
          tabs: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ url: url(name) })),
        },
      ],
    });
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));

    const { toastText, toastParams } = store.getState().globalState;
    expect(toastText).toBe(WINDOW_CLOSED_FRAME);
    expect(WINDOW_CLOSED_FRAME).toBe('WindowClosed');
    expect(toastParams).toEqual({ count: 5 });
  });

  test('a closed tab says "Tab closed"', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));

    const { toastText, toastParams } = store.getState().globalState;
    expect(toastText).toBe(TOAST_MESSAGES.TAB_CLOSED);
    expect(toastParams).toBeUndefined();
  });
});

// KAN-311 (O8c). The Reopen button and the ⌘Z / Ctrl+Z key both dispatch
// this one thunk, so the two cannot drift apart.
describe('reopenFromOffer (KAN-311)', () => {
  const offerId = (store: ReturnType<typeof makeTestStore>['store']) => {
    const id = store.getState().globalState.toastReopenOfferId;
    if (id === null) throw new Error('no offer id');
    return id;
  };
  // Window 2 keeps a, so b reopens into it.
  const closedB = async (): Promise<ClosedItem> => {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
        { id: 2, tabs: [{ url: url('a') }, { url: url('b') }] },
      ],
    });
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, w2.tabs[1]);
    if (!item) throw new Error('close failed');
    return item;
  };
  const urlsIn = async (windowId: number) =>
    (await chrome.tabs.query({ windowId }))
      .sort((x, y) => x.index - y.index)
      .map((tab) => tab.url);

  test('takes the offer, closes the toast, reopens, and names the new tab for focus', async () => {
    const item = await closedB();
    const { store } = makeTestStore();
    await store.dispatch(offerReopen(item));
    const id = offerId(store);

    await store.dispatch(reopenFromOffer(id));

    expect(openState(store)).toBe(false);
    expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
    const back = (await chrome.tabs.query({ windowId: 2 })).find(
      (tab) => tab.url === url('b')
    );
    expect(back?.id).toBeDefined();
    expect(pendingReopenFocus()).toEqual({ kind: 'tab', tabId: back?.id });
    // Taken: the offer is gone from the registry.
    expect(takeReopenOffer(id)).toBeNull();
  });

  test('a second dispatch for the same offer does nothing', async () => {
    const item = await closedB();
    const { store } = makeTestStore();
    await store.dispatch(offerReopen(item));
    const id = offerId(store);

    await Promise.all([
      store.dispatch(reopenFromOffer(id)),
      store.dispatch(reopenFromOffer(id)),
    ]);

    expect(handle?.createdTabs).toHaveLength(1);
    expect(await urlsIn(2)).toEqual([url('a'), url('b')]);
  });

  // An offer a plain toast replaced cannot be taken, and the plain toast it
  // did not offer stays up.
  test('an offer already dropped reopens nothing and leaves the toast showing', async () => {
    const item = await closedB();
    const { store } = makeTestStore();
    await store.dispatch(offerReopen(item));
    const id = offerId(store);
    await store.dispatch(showToast({ toastText: TOAST_MESSAGES.SYNC_MERGED }));

    await store.dispatch(reopenFromOffer(id));

    expect(handle?.createdTabs).toEqual([]);
    expect(openState(store)).toBe(true);
    expect(store.getState().globalState.toastText).toBe(
      TOAST_MESSAGES.SYNC_MERGED
    );
    expect(pendingReopenFocus()).toBeNull();
  });

  test('nothing coming back says so, and asks for no focus move', async () => {
    handle = setupChromeFake({
      refusedUrls: [url('b')],
      windows: [
        { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
        { id: 2, tabs: [{ url: url('a') }, { url: url('b') }] },
      ],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, w2.tabs[1]);
    if (!item) throw new Error('close failed');
    const { store } = makeTestStore();
    await store.dispatch(offerReopen(item));

    await store.dispatch(reopenFromOffer(offerId(store)));

    // PREMISE: Chrome was asked, and refused.
    expect(handle.createdTabs).toHaveLength(1);
    expect(store.getState().globalState.toastText).toBe(
      TOAST_MESSAGES.REOPEN_FAILED
    );
    expect(openState(store)).toBe(true);
    expect(pendingReopenFocus()).toBeNull();
  });

  test('a reopened window is named for focus by its new id', async () => {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
        { id: 2, tabs: [{ url: url('a') }] },
      ],
    });
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');
    const { store } = makeTestStore();
    await store.dispatch(offerReopen(item));

    await store.dispatch(reopenFromOffer(offerId(store)));

    const ids = (await chrome.windows.getAll({})).map((w) => w.id);
    const made = ids.find((id) => id !== 1);
    expect(made).toBeDefined();
    expect(pendingReopenFocus()).toEqual({ kind: 'window', windowId: made });
  });
});

describe('the reopened row to focus (KAN-311)', () => {
  test('is kept for 3 seconds, then forgotten', () => {
    vi.useFakeTimers();
    expect(REOPEN_FOCUS_MS).toBe(3000);

    expectReopenedRow({ kind: 'tab', tabId: 7 });
    vi.advanceTimersByTime(REOPEN_FOCUS_MS - 1);
    expect(pendingReopenFocus()).toEqual({ kind: 'tab', tabId: 7 });
    vi.advanceTimersByTime(1);
    expect(pendingReopenFocus()).toBeNull();
  });

  // The pane reads it through useSyncExternalStore, which re-reads only when
  // told: expiry is a change like any other.
  test('its expiry is announced to subscribers', () => {
    vi.useFakeTimers();
    expectReopenedRow({ kind: 'tab', tabId: 7 });
    const listener = vi.fn();
    const unsubscribe = subscribeReopenFocus(listener);

    vi.advanceTimersByTime(REOPEN_FOCUS_MS - 1);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(pendingReopenFocus()).toBeNull();
    unsubscribe();
  });

  test('a newer reopen replaces it, with its own 3 seconds', () => {
    vi.useFakeTimers();
    expectReopenedRow({ kind: 'tab', tabId: 7 });
    vi.advanceTimersByTime(2000);
    expectReopenedRow({ kind: 'window', windowId: 9 });
    vi.advanceTimersByTime(2000);

    expect(pendingReopenFocus()).toEqual({ kind: 'window', windowId: 9 });
  });
});
