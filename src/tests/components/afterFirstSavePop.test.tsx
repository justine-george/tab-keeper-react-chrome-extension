import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { makeTestStore } from '../setup/makeStore';
import { afterFirstSavePop } from '../../components/home/leftpane/afterFirstSavePop';
import {
  noteFirstSave,
  setFirstSavePopping,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';

// KAN-875. The tour's save step waits for the first-save pop before its next card.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Store = ReturnType<typeof makeTestStore>['store'];

const pops = (store: Store) => store.getState().globalState.firstSavePops;

// When the promise settles, in the order promises settle.
const order: string[] = [];
const settled = (promise: Promise<void>, name = 'done') => {
  let isDone = false;
  void promise.then(() => {
    isDone = true;
    order.push(name);
  });
  return () => isDone;
};

describe('after the first-save pop', () => {
  test('an ordinary save goes on at once', async () => {
    const { store } = makeTestStore();
    const isDone = settled(afterFirstSavePop(store, pops(store)));
    await vi.advanceTimersByTimeAsync(0);
    expect(isDone()).toBe(true);
  });

  test('a first save with no pop on the page goes on a task later', async () => {
    const { store } = makeTestStore();
    store.dispatch(noteFirstSave());
    const isDone = settled(afterFirstSavePop(store, 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(isDone()).toBe(true);
  });

  test('a first save whose pop starts as it renders waits for the pop to end', async () => {
    const { store } = makeTestStore();
    store.dispatch(noteFirstSave());
    const isDone = settled(afterFirstSavePop(store, 0));
    store.dispatch(setFirstSavePopping(true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(isDone()).toBe(false);
    store.dispatch(setFirstSavePopping(false));
    await vi.advanceTimersByTimeAsync(0);
    expect(isDone()).toBe(true);
  });

  test('a save while a pop plays waits for it to end', async () => {
    const { store } = makeTestStore();
    store.dispatch(setFirstSavePopping(true));
    const isDone = settled(afterFirstSavePop(store, pops(store)));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(isDone()).toBe(false);
    store.dispatch(setFirstSavePopping(false));
    await vi.advanceTimersByTimeAsync(0);
    expect(isDone()).toBe(true);
  });

  test('other changes while the pop plays do not end the wait', async () => {
    const { store } = makeTestStore();
    store.dispatch(setFirstSavePopping(true));
    const isDone = settled(afterFirstSavePop(store, pops(store)));
    await vi.advanceTimersByTimeAsync(0);
    store.dispatch(setSearchInputText('trip'));
    await vi.advanceTimersByTimeAsync(0);
    expect(isDone()).toBe(false);
  });

  test('a second save right after the first goes on after it, not before', async () => {
    order.length = 0;
    const { store } = makeTestStore();
    store.dispatch(noteFirstSave());
    settled(afterFirstSavePop(store, 0), 'first');
    settled(afterFirstSavePop(store, pops(store)), 'second');
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['first', 'second']);
  });
});
