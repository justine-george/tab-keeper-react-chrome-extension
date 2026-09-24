import { afterEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
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
  REOPEN_TOAST_MS,
  takeReopenOffer,
} from '../../redux/reopenOffer';
import {
  TOAST_MESSAGES,
  WINDOW_CLOSED_FRAME,
} from '../../utils/constants/common';

// KAN-280 O8a. The toast after a close offers Reopen for the latest close
// only, once, for 8 seconds, and the timer holds while the user is on it.

let handle: ChromeFakeHandle | undefined;

afterEach(() => {
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

  // Review Focus 6: a sync merge arriving over the Reopen toast replaces it,
  // and the offer goes with it -- in Redux AND in the registry.
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
