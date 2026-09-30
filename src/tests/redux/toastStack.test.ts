import { describe, expect, test } from 'vitest';

import { addToast, MAX_TOASTS } from '../../redux/toastStack';
import type { ToastItem } from '../../redux/toastStack';

// KAN-349. The rules a new toast meets, in order: an offer replaces the offer
// in place (T4), a plain toast replaces its twin (T5), a saved-session change
// takes ⌘Z from the offer (Q1 C′), and past MAX_TOASTS the oldest goes (T2).

const plain = (id: number, text: string, params?: ToastItem['params']) => ({
  id,
  text,
  params,
  reopenOffer: null,
});

const offer = (id: number, offerId: number): ToastItem => ({
  id,
  text: 'Tab closed',
  params: undefined,
  reopenOffer: { id: offerId, keepsUndoKey: true },
});

const ids = (list: readonly ToastItem[]) => list.map((t) => t.id);

describe('addToast (KAN-349)', () => {
  test('the newest goes last', () => {
    const list = addToast([plain(1, 'A')], plain(2, 'B'), false);
    expect(ids(list)).toEqual([1, 2]);
  });

  test('T2: a fourth toast pushes the OLDEST out', () => {
    let list: ToastItem[] = [];
    for (const id of [1, 2, 3, 4]) {
      list = addToast(list, plain(id, `T${id}`), false);
    }
    expect(MAX_TOASTS).toBe(3);
    expect(ids(list)).toEqual([2, 3, 4]);
  });

  test('T5: the same toast again replaces the old one, at the bottom', () => {
    let list = addToast([], plain(1, 'Saved'), false);
    list = addToast(list, plain(2, 'Copied'), false);
    list = addToast(list, plain(3, 'Saved'), false);
    expect(ids(list)).toEqual([2, 3]);
  });

  test('T5: the same key with different params is a different toast', () => {
    let list = addToast([], plain(1, 'Window closed', { count: 3 }), false);
    list = addToast(list, plain(2, 'Window closed', { count: 2 }), false);
    expect(ids(list)).toEqual([1, 2]);
  });

  test('T5: equal params in a different key order are the same toast', () => {
    let list = addToast([], plain(1, 'Frame', { a: 1, b: 'x' }), false);
    list = addToast(list, plain(2, 'Frame', { b: 'x', a: 1 }), false);
    expect(ids(list)).toEqual([2]);
  });

  test('T5: params on one side only is a different toast', () => {
    let list = addToast([], plain(1, 'Frame'), false);
    list = addToast(list, plain(2, 'Frame', { a: 1 }), false);
    expect(ids(list)).toEqual([1, 2]);
  });

  test('T4: a new offer replaces the old offer IN PLACE', () => {
    let list = addToast([], offer(1, 10), false);
    list = addToast(list, plain(2, 'Copied'), false);
    list = addToast(list, offer(3, 11), false);
    expect(ids(list)).toEqual([3, 2]);
    expect(list[0].reopenOffer).toEqual({ id: 11, keepsUndoKey: true });
  });

  test('T4: a first offer is appended like any toast', () => {
    const list = addToast([plain(1, 'Copied')], offer(2, 10), false);
    expect(ids(list)).toEqual([1, 2]);
  });

  test('Q1 C′: a saved-session change takes ⌘Z from the offer', () => {
    let list = addToast([], offer(1, 10), false);
    list = addToast(list, plain(2, 'Tab deleted'), true);
    expect(list[0].reopenOffer).toEqual({ id: 10, keepsUndoKey: false });
  });

  test('Q1 C′: any other toast leaves ⌘Z with the offer', () => {
    let list = addToast([], offer(1, 10), false);
    list = addToast(list, plain(2, 'Sync merged'), false);
    expect(list[0].reopenOffer).toEqual({ id: 10, keepsUndoKey: true });
  });

  test('the list passed in is not changed', () => {
    const before = [offer(1, 10), plain(2, 'A'), plain(3, 'B')];
    const snapshot = structuredClone(before);
    addToast(before, plain(4, 'C'), true);
    expect(before).toEqual(snapshot);
  });
});
