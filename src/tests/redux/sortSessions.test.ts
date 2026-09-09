import { describe, expect, test, vi } from 'vitest';

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
  saveToTabContainerInternal,
  sortSessionsInternal,
  moveSessionInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { setIsNotDirty } from '../../redux/slices/globalStateSlice';

// KAN-136 / KAN-106. Sorting the session list.
//
// A sort is a ONE-SHOT ACTION on the stored order, not a mode: it assigns
// ranks once and stops. That is what lets it coexist with dragging, since both
// are then operations on the same stored order rather than two rival answers
// to "what order is this list in" (see KAN-130).
//
// The visible consequence, and it is deliberate: a session saved afterwards
// has no rank, falls back to createdInstant, and lands at the TOP rather than
// in its sorted position.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const build = (
  id: string,
  title: string,
  createdAt: number,
  tabCount: number
) => ({
  tabGroupId: id,
  title,
  createdTime: '2026-09-09 12:00:00',
  createdAt,
  windowCount: 1,
  tabCount,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount,
      title: 'Window',
      tabs: Array.from({ length: tabCount }, (_, i) => ({
        tabId: `${id}-t${i}`,
        favicon: '',
        title: 'Tab',
        url: 'https://a.co',
      })),
    },
  ],
});

type Store = ReturnType<typeof makeTestStore>['store'];

// Saved oldest first, so the list starts newest-first: Banana, apple, Cherry.
// Deliberately mixed case -- a raw `<` would sort every capital ahead of every
// lowercase, which is the bug Intl.Collator exists to avoid.
const seededList = () => {
  const { store } = makeTestStore();
  store.dispatch(
    saveToTabContainerInternal(build('c', 'Cherry', T0 - 2 * HOUR, 9))
  );
  store.dispatch(saveToTabContainerInternal(build('a', 'apple', T0 - HOUR, 2)));
  store.dispatch(saveToTabContainerInternal(build('b', 'Banana', T0, 5)));
  store.dispatch(setIsNotDirty());
  return store;
};

const titles = (s: Store) =>
  s.getState().tabContainerDataState.tabGroups.map((g) => g.title);
const groups = (s: Store) => s.getState().tabContainerDataState.tabGroups;

describe('sortSessionsInternal by name', () => {
  test('orders the list alphabetically', () => {
    const store = seededList();
    expect(titles(store)).toEqual(['Banana', 'apple', 'Cherry']);

    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));

    expect(titles(store)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  // A raw `<` puts every capital before every lowercase, so this list would
  // come out Banana, Cherry, apple. Ten locales ship; KAN-85 was this exact
  // mistake for dates.
  test('is case-insensitive, not codepoint order', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));
    expect(titles(store)[0]).toBe('apple');
  });

  test('gives every session an explicit rank', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));

    expect(groups(store).every((g) => g.rank !== undefined)).toBe(true);
  });

  // THE INVARIANT, same as the drag reducer's: the array and the ranks must
  // agree, or the next sync re-derives a different order from the one on
  // screen.
  test('the ranks reproduce the array order when sorted', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));

    const g = groups(store);
    const key = (x: (typeof g)[number]) => x.rank ?? x.createdAt!;
    const resorted = [...g].sort((x, y) => key(y) - key(x));
    expect(resorted.map((x) => x.title)).toEqual(g.map((x) => x.title));
  });

  test('does not restamp createdAt', () => {
    const store = seededList();
    const before = new Map(
      groups(store).map((g) => [g.tabGroupId, g.createdAt])
    );

    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));

    groups(store).forEach((g) => {
      expect(g.createdAt).toBe(before.get(g.tabGroupId));
    });
  });
});

describe('sortSessionsInternal by tab count', () => {
  test('orders largest first', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'tabCount', locale: 'en' }));
    // Cherry 9, Banana 5, apple 2
    expect(titles(store)).toEqual(['Cherry', 'Banana', 'apple']);
  });

  test('the ranks reproduce that order too', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'tabCount', locale: 'en' }));

    const g = groups(store);
    const key = (x: (typeof g)[number]) => x.rank ?? x.createdAt!;
    const resorted = [...g].sort((x, y) => key(y) - key(x));
    expect(resorted.map((x) => x.title)).toEqual(g.map((x) => x.title));
  });
});

describe('a sort is a one-shot action, not a mode', () => {
  // The deliberate consequence, pinned so it cannot change silently: after a
  // name sort, a NEW session lands at the top rather than in its alphabetical
  // place, because it has no rank and falls back to createdInstant.
  test('a session saved afterwards lands on top, not in sorted position', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));
    expect(titles(store)).toEqual(['apple', 'Banana', 'Cherry']);

    store.dispatch(
      saveToTabContainerInternal(build('z', 'zebra', T0 + HOUR, 1))
    );

    expect(titles(store)[0]).toBe('zebra');
  });

  // And a drag still overrides a sort, because both write the same field.
  test('dragging after a sort still wins', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));

    store.dispatch(moveSessionInternal({ tabGroupId: 'c', toIndex: 0 }));

    expect(titles(store)[0]).toBe('Cherry');
  });
});

describe('sortSessionsInternal does nothing when there is nothing to do', () => {
  // CONTROL. Re-sorting an already-sorted, already-ranked list must not stamp
  // every session and queue a cloud write each time the menu is used.
  test('re-sorting an already sorted list is not an edit', () => {
    const store = seededList();
    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));
    store.dispatch(setIsNotDirty());
    const before = groups(store).map((g) => g.lastModified);

    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));

    expect(groups(store).map((g) => g.lastModified)).toEqual(before);
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // But an already-ordered list with NO ranks must still be pinned: the order
  // is a coincidence of creation times until the ranks make it explicit.
  test('an unranked list in the right order still gets ranks', () => {
    const { store } = makeTestStore();
    store.dispatch(
      saveToTabContainerInternal(build('a', 'apple', T0 - HOUR, 1))
    );
    store.dispatch(saveToTabContainerInternal(build('b', 'Banana', T0, 1)));
    store.dispatch(setIsNotDirty());
    // Newest-first already happens to be reverse-alphabetical here.
    expect(titles(store)).toEqual(['Banana', 'apple']);

    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));

    expect(titles(store)).toEqual(['apple', 'Banana']);
    expect(groups(store).every((g) => g.rank !== undefined)).toBe(true);
  });

  test('an empty list does not throw', () => {
    const { store } = makeTestStore();
    store.dispatch(sortSessionsInternal({ by: 'name', locale: 'en' }));
    expect(groups(store)).toEqual([]);
  });
});
