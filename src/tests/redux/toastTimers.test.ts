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
  closeAllToasts,
  closeOfferToast,
  closePlainToasts,
  selectReopenOfferForKey,
  showToast,
} from '../../redux/slices/globalStateSlice';
import { holdToasts, releaseToasts } from '../../redux/toastTimers';

// KAN-349. Several toasts at once: each keeps its own timer (T3), a hold on
// any of them holds them all, and ⌘Z's claim on a Reopen offer follows Q1 C′.

type Store = ReturnType<typeof makeTestStore>['store'];

const texts = (store: Store) =>
  store.getState().globalState.toasts.map((t) => t.text);

const show = (
  store: Store,
  text: string,
  extra: { duration?: number; reopenOfferId?: number } = {}
) => store.dispatch(showToast({ toastText: text, ...extra }));

const showSavedChange = (store: Store, text: string) =>
  store.dispatch(showToast({ toastText: text, announcesSavedChange: true }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('each toast keeps its own timer (T3)', () => {
  test('toasts leave one by one, each on its own length', async () => {
    const { store } = makeTestStore();
    await show(store, 'A', { duration: 5000 });
    vi.advanceTimersByTime(1000);
    await show(store, 'B', { duration: 8000 });
    expect(texts(store)).toEqual(['A', 'B']);

    vi.advanceTimersByTime(4000);
    expect(texts(store)).toEqual(['B']);

    vi.advanceTimersByTime(3999);
    expect(texts(store)).toEqual(['B']);
    vi.advanceTimersByTime(1);
    expect(texts(store)).toEqual([]);
  });

  test('a replaced twin (T5) leaves on the NEW timer, not the old one', async () => {
    const { store } = makeTestStore();
    await show(store, 'A', { duration: 5000 });
    vi.advanceTimersByTime(4000);
    await show(store, 'A', { duration: 5000 });

    vi.advanceTimersByTime(1000);
    expect(texts(store)).toEqual(['A']);
    vi.advanceTimersByTime(4000);
    expect(texts(store)).toEqual([]);
  });

  test('two toasts fired in one tick keep their order', async () => {
    const { store } = makeTestStore();
    await Promise.all([show(store, 'Moved'), show(store, 'Removed')]);
    expect(texts(store)).toEqual(['Moved', 'Removed']);
  });
});

describe('a hold holds every toast (T3)', () => {
  test('a hold keeps each timer’s time left, and release resumes it', async () => {
    const { store } = makeTestStore();
    await show(store, 'A', { duration: 5000 });
    vi.advanceTimersByTime(1000);
    await show(store, 'B', { duration: 5000 });
    vi.advanceTimersByTime(3900);

    holdToasts();
    vi.advanceTimersByTime(60_000);
    expect(texts(store)).toEqual(['A', 'B']);

    releaseToasts();
    vi.advanceTimersByTime(99);
    expect(texts(store)).toEqual(['A', 'B']);
    vi.advanceTimersByTime(1);
    expect(texts(store)).toEqual(['B']);
    vi.advanceTimersByTime(1000);
    expect(texts(store)).toEqual([]);
  });

  test('a toast that arrives during a hold waits for the release', async () => {
    const { store } = makeTestStore();
    await show(store, 'A', { duration: 5000 });
    holdToasts();
    await show(store, 'B', { duration: 5000 });

    vi.advanceTimersByTime(30_000);
    expect(texts(store)).toEqual(['A', 'B']);

    releaseToasts();
    vi.advanceTimersByTime(5000);
    expect(texts(store)).toEqual([]);
  });

  test('a toast that arrives on an empty stack starts unheld', async () => {
    const { store } = makeTestStore();
    await show(store, 'A');
    holdToasts();
    store.dispatch(closeAllToasts());

    await show(store, 'B', { duration: 5000 });
    vi.advanceTimersByTime(5000);
    expect(texts(store)).toEqual([]);
  });
});

describe('closing', () => {
  test('closePlainToasts leaves the offer', async () => {
    const { store } = makeTestStore();
    await show(store, 'Tab closed', { reopenOfferId: 7, duration: 8000 });
    await show(store, 'Links copied');
    store.dispatch(closePlainToasts());
    expect(texts(store)).toEqual(['Tab closed']);
  });

  test('closeAllToasts closes every toast', async () => {
    const { store } = makeTestStore();
    await show(store, 'Tab closed', { reopenOfferId: 7, duration: 8000 });
    await show(store, 'Links copied');
    store.dispatch(closeAllToasts());
    expect(texts(store)).toEqual([]);
  });

  test('closeOfferToast closes only the toast naming that offer', async () => {
    const { store } = makeTestStore();
    await show(store, 'Tab closed', { reopenOfferId: 7, duration: 8000 });
    await show(store, 'Links copied');

    store.dispatch(closeOfferToast(6));
    expect(texts(store)).toEqual(['Tab closed', 'Links copied']);
    store.dispatch(closeOfferToast(7));
    expect(texts(store)).toEqual(['Links copied']);
  });
});

describe('which offer ⌘Z takes (Q1 C′)', () => {
  const offerOn = (store: Store) =>
    show(store, 'Tab closed', { reopenOfferId: 7, duration: 8000 });

  test('an offer alone has the key', async () => {
    const { store } = makeTestStore();
    await offerOn(store);
    expect(selectReopenOfferForKey(store.getState())).toBe(7);
  });

  test('no offer, no key', async () => {
    const { store } = makeTestStore();
    await show(store, 'Links copied');
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('a saved-session change announced after the offer takes the key', async () => {
    const { store } = makeTestStore();
    await offerOn(store);
    await showSavedChange(store, 'Tab deleted');
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
    expect(texts(store)).toEqual(['Tab closed', 'Tab deleted']);
  });

  test('a sync toast after the offer leaves the key with it', async () => {
    const { store } = makeTestStore();
    await offerOn(store);
    await show(store, 'Sync merged');
    expect(selectReopenOfferForKey(store.getState())).toBe(7);
  });

  test('the key does not come back when the taking toast times out', async () => {
    const { store } = makeTestStore();
    await offerOn(store);
    await store.dispatch(
      showToast({
        toastText: 'Tab deleted',
        duration: 3000,
        announcesSavedChange: true,
      })
    );
    vi.advanceTimersByTime(3000);
    expect(texts(store)).toEqual(['Tab closed']);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('the key does not come back when an undo closes the taking toast', async () => {
    const { store } = makeTestStore();
    await offerOn(store);
    await showSavedChange(store, 'Tab deleted');
    store.dispatch(closePlainToasts());
    expect(texts(store)).toEqual(['Tab closed']);
    expect(selectReopenOfferForKey(store.getState())).toBeNull();
  });

  test('a new close after a saved change has the key again', async () => {
    const { store } = makeTestStore();
    await offerOn(store);
    await showSavedChange(store, 'Tab deleted');
    await show(store, 'Tab closed', { reopenOfferId: 8, duration: 8000 });
    expect(selectReopenOfferForKey(store.getState())).toBe(8);
  });
});
