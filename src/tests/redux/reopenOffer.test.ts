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
}));

import { makeTestStore } from '../setup/makeStore';
import { isToastShowing, shownOfferId, toastTexts } from '../setup/toasts';
import { setupChromeFake } from '../setup/chrome.fake';
import type { ChromeFakeHandle } from '../setup/chrome.fake';
import { toOpenWindows } from '../../utils/functions/openNow';
import type { OpenWindow } from '../../utils/functions/openNow';
import { closeOpenTab, closeOpenWindow } from '../../utils/functions/reopen';
import { setPinTabKeeperInNewWindows } from '../../redux/slices/settingsDataStateSlice';
import type { ClosedItem } from '../../utils/functions/reopen';
import {
  closeAllToasts,
  closePlainToasts,
  selectReopenOfferForKey,
  showToast,
} from '../../redux/slices/globalStateSlice';
import {
  offerReopen,
  reopenFromOffer,
  takeReopenOffer,
} from '../../redux/reopenOffer';
import { NEEDS_YOU_TOAST_MS } from '../../redux/toastDuration';
import { MAX_TOASTS } from '../../redux/toastStack';
import {
  clearReopenFocus,
  expectReopenedRow,
  pendingReopenFocus,
  REOPEN_FOCUS_MS,
  subscribeReopenFocus,
} from '../../redux/reopenFocus';
import { TOAST_MESSAGES } from '../../utils/constants/common';

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
  isToastShowing(store.getState());

describe('the Reopen offer (KAN-280 O8a)', () => {
  test('an offer is taken once', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');

    expect(takeReopenOffer(id)).toBe(item);
    expect(takeReopenOffer(id)).toBeNull();
  });

  test('a newer offer replaces the older one', async () => {
    const [a, b] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(a));
    const idA = shownOfferId(store.getState());
    await store.dispatch(offerReopen(b));
    const idB = shownOfferId(store.getState());
    if (idA === null || idB === null) throw new Error('no offer id');

    expect(idB).not.toBe(idA);
    expect(takeReopenOffer(idA)).toBeNull();
    expect(takeReopenOffer(idB)).toBe(b);
  });

  // KAN-349 Q1 C′. ⌘Z goes to the saved change, but the Reopen button on the
  // offer, still showing, still works.
  test('a saved change takes ⌘Z, and the offer can still be taken', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');
    await store.dispatch(
      showToast({
        toastText: TOAST_MESSAGES.DELETE_TAB_SUCCESS,
        announcesSavedChange: true,
      })
    );

    expect(selectReopenOfferForKey(store.getState())).toBeNull();
    expect(shownOfferId(store.getState())).toBe(id);
    expect(takeReopenOffer(id)).toBe(item);
  });

  test('two newer toasts leave the offer', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');
    for (const toastText of ['One', 'Two']) {
      await store.dispatch(showToast({ toastText }));
    }

    expect(takeReopenOffer(id)).toBe(item);
  });

  test('closing every toast (Settings) drops the offer', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');
    store.dispatch(closeAllToasts());

    expect(takeReopenOffer(id)).toBeNull();
  });

  test('closing the plain toasts (undo) keeps the offer', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();

    await store.dispatch(offerReopen(item));
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');
    await store.dispatch(showToast({ toastText: 'One' }));
    store.dispatch(closePlainToasts());

    expect(takeReopenOffer(id)).toBe(item);
  });

  test('the Reopen toast lasts 8 seconds; others keep theirs', async () => {
    const [item] = await closedTabs();
    const { store } = makeTestStore();
    vi.useFakeTimers();

    expect(NEEDS_YOU_TOAST_MS).toBe(8000);
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
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');
    vi.advanceTimersByTime(NEEDS_YOU_TOAST_MS);

    expect(openState(store)).toBe(false);
    expect(takeReopenOffer(id)).toBeNull();
  });
});

// KAN-311 (O8c). The Reopen button and the ⌘Z / Ctrl+Z key both dispatch
// this one thunk, so the two cannot drift apart.
describe('reopenFromOffer (KAN-311)', () => {
  const offerId = (store: ReturnType<typeof makeTestStore>['store']) => {
    const id = shownOfferId(store.getState());
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
    // Dropped the one way a stack drops an offer from under other toasts:
    // MAX_TOASTS newer ones push it out (KAN-349 T2).
    const newer = [
      ...Array.from({ length: MAX_TOASTS - 1 }, (_, i) => `Toast ${i + 1}`),
      TOAST_MESSAGES.SYNC_MERGED,
    ];
    for (const toastText of newer) {
      await store.dispatch(showToast({ toastText }));
    }

    await store.dispatch(reopenFromOffer(id));

    expect(handle?.createdTabs).toEqual([]);
    expect(openState(store)).toBe(true);
    expect(toastTexts(store.getState())).toEqual(newer);
    expect(pendingReopenFocus()).toBeNull();
  });
});

// KAN-280 Part D: with `sessions` held, the service worker restores the item
// with its history and answers with the new ids; the row focus follows them.
describe('reopenFromOffer with history (KAN-280 Part D)', () => {
  test('names the tab the worker restored for focus', async () => {
    handle = setupChromeFake({
      grantedPermissions: ['sessions'],
      action: {},
      windows: [
        { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
        { id: 2, tabs: [{ url: url('a'), active: true }, { url: url('b') }] },
      ],
    });
    vi.resetModules();
    await import('../../background');
    const w2 = await openWindow(2);
    const item = await closeOpenTab(w2, w2.tabs[1]);
    if (!item) throw new Error('close failed');
    // PREMISE: the close recorded Chrome's entry, so this goes to the worker.
    expect(item.restorableSessionId).toEqual(expect.any(String));
    const { store } = makeTestStore();
    await store.dispatch(offerReopen(item));
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');

    await store.dispatch(reopenFromOffer(id));

    const back = (await chrome.tabs.query({ windowId: 2 })).find(
      (tab) => tab.url === url('b')
    );
    if (back?.id === undefined) throw new Error('b did not come back');
    expect(handle.restoredFromSession(back.id)).toBe(true);
    expect(pendingReopenFocus()).toEqual({ kind: 'tab', tabId: back.id });
    expect(openState(store)).toBe(false);
  });
});

describe('the reopened row to focus (KAN-311)', () => {
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

describe('reopenFromOffer reads the Pin Tab Keeper setting (KAN-459)', () => {
  const STUB_URL = 'chrome-extension://faketestid/pinned.html';

  async function reopenedWindowHasStub(on: boolean): Promise<boolean> {
    handle = setupChromeFake({
      windows: [
        { id: 1, focused: true, tabs: [{ url: url('home'), active: true }] },
        { id: 2, tabs: [{ url: url('a') }, { url: url('b') }] },
      ],
    });
    const item = await closeOpenWindow(await openWindow(2));
    if (!item) throw new Error('close failed');
    const { store } = makeTestStore();
    store.dispatch(setPinTabKeeperInNewWindows(on));
    await store.dispatch(offerReopen(item));
    const id = shownOfferId(store.getState());
    if (id === null) throw new Error('no offer id');

    await store.dispatch(reopenFromOffer(id));

    const back = (await chrome.windows.getAll({ populate: true })).find(
      (w) => w.id !== 1
    );
    return (back?.tabs ?? []).some((tab) => tab.url === STUB_URL);
  }

  test('On: the reopened window gets the stub', async () => {
    expect(await reopenedWindowHasStub(true)).toBe(true);
  });

  test('Off: it does not', async () => {
    expect(await reopenedWindowHasStub(false)).toBe(false);
  });
});
