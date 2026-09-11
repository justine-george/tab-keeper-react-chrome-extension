import { describe, expect, test, vi, beforeEach } from 'vitest';

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
import {
  moveSessionInternal,
  resetSessionOrder,
  saveToTabContainerInternal,
  sortSessions,
} from '../../redux/slices/tabContainerDataStateSlice';
import { TOAST_MESSAGES } from '../../utils/constants/common';

// KAN-151. Reordering the list says so, and says how to get back.
//
// Applying a sort overwrites every rank, so a user who has spent time dragging
// their sessions into an arrangement loses it in one click. Undo DOES restore
// it -- verified, sorting goes on the undo stack like any other data change --
// but nothing on screen says so, and "my arrangement is gone" is not a thought
// that leads anyone to press undo.
//
// So the recovery is announced at the moment it becomes relevant. No new state,
// no new menu item, and nothing to keep in step with the sort machinery.

const session = (id: string, title: string, tabCount = 1) => ({
  tabGroupId: id,
  title,
  createdTime: '2026-09-10 12:00:00',
  createdAt: 1,
  windowCount: 1,
  tabCount,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 1,
      windowWidth: 1,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount,
      title: 'Window',
      tabs: [
        { tabId: `${id}-t`, favicon: '', title: 'T', url: 'https://a.co' },
      ],
    },
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 10, 12, 0, 0);

// THE CLOCK IS PINNED, one hour apart per save. Saving stamps contentModified
// with Date.now(), and that is what orders the list before any rank exists --
// so unpinned, three saves may land in one millisecond or straddle a boundary
// depending on how loaded the machine is, and the seeded order changes with it.
//
// Found the hard way: this file passed alone and failed in the full suite,
// which is KAN-145 exactly, in a fixture written the same day that one was
// fixed. Seeded oldest first, so the list reads newest first.
const seed = (store: Store, titles: string[]) => {
  vi.useFakeTimers();
  try {
    titles.forEach((t, i) => {
      vi.setSystemTime(T0 - (titles.length - 1 - i) * HOUR);
      store.dispatch(saveToTabContainerInternal(session(`g${i}`, t)));
    });
  } finally {
    vi.useRealTimers();
  }
};

// showToast is a THUNK, so what the recorder sees is its lifecycle actions,
// not a bare 'showToast'. Counting the pending one counts each call exactly
// once -- fulfilled would too, but pending is the one that always fires.
const toasts = (seen: string[]) =>
  seen.filter((type) => type === 'global/showToast/pending');

const order = (store: Store) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.title);

beforeEach(() => localStorage.clear());

describe('a sort that rearranges the list announces itself', () => {
  test('sorting by name toasts', async () => {
    const { store, seen } = makeTestStore();
    seed(store, ['Banana', 'Cherry', 'Apple']);

    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));

    expect(order(store)).toEqual(['Apple', 'Banana', 'Cherry']);
    expect(toasts(seen)).toHaveLength(1);
    expect(store.getState().globalState.toastText).toBe(
      TOAST_MESSAGES.SESSION_ORDER_CHANGED
    );
  });

  test('clearing the order back to default toasts', async () => {
    const { store, seen } = makeTestStore();
    seed(store, ['Banana', 'Cherry', 'Apple']);
    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));
    const before = seen.length;

    await store.dispatch(resetSessionOrder());

    // Back to recency order, which is NOT name order -- so the list really
    // moved and the toast really had something to announce.
    expect(order(store)).toEqual(['Apple', 'Cherry', 'Banana']);
    expect(toasts(seen.slice(before))).toHaveLength(1);
  });
});

// THE HALF THAT KEEPS IT HONEST. A toast that always fires would satisfy every
// test above and would lie twice a day: both reducers return early when there
// is nothing to do, and announcing a change that did not happen -- while
// telling the user to undo it -- is worse than staying quiet.
describe('a sort that changes nothing stays quiet', () => {
  test('re-sorting an already-sorted list does not toast', async () => {
    const { store, seen } = makeTestStore();
    seed(store, ['Banana', 'Cherry', 'Apple']);
    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));

    // The control for the assertion below: the FIRST sort did announce itself,
    // so a zero count afterwards means this sort stayed quiet rather than that
    // the toast never worked.
    expect(toasts(seen)).toHaveLength(1);
    const before = seen.length;

    // Second identical sort: already in this order AND already pinned, which
    // is the early return in sortSessionsInternal.
    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));

    expect(toasts(seen.slice(before))).toHaveLength(0);
    expect(order(store)).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  test('clearing an order that is already default does not toast', async () => {
    const { store, seen } = makeTestStore();
    seed(store, ['Banana', 'Cherry', 'Apple']);
    const before = seen.length;

    // Never sorted, never dragged -- no ranks exist, so there is nothing to
    // clear and nothing to announce.
    await store.dispatch(resetSessionOrder());

    expect(toasts(seen.slice(before))).toHaveLength(0);
  });

  test('an empty list does not toast', async () => {
    const { store, seen } = makeTestStore();

    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));

    expect(toasts(seen)).toHaveLength(0);
  });
});

describe('the arrangement the toast promises back', () => {
  // The claim in the message, asserted rather than trusted: the previous order
  // really is one undo away. If this ever stops being true the toast becomes a
  // false instruction, which is worse than no toast at all.
  test('a dragged order survives a sort and one undo', async () => {
    const { store } = makeTestStore();
    seed(store, ['Banana', 'Cherry', 'Apple']);
    store.dispatch(moveSessionInternal({ tabGroupId: 'g0', toIndex: 0 }));
    const dragged = order(store);

    await store.dispatch(sortSessions({ by: 'name', locale: 'en' }));
    expect(order(store)).not.toEqual(dragged);

    store.dispatch({ type: 'undoRedo/undo' });

    expect(order(store)).toEqual(dragged);
  });
});
