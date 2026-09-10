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
  openAllTabContainer,
  openTabsInAWindow,
  saveToTabContainer,
  isSubstantialSave,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-149. What counts as the extension having visibly paid off.
//
// These are the writes the review prompt reads. Each is asserted at the store,
// because the prompt's own decision (reviewAsk.test.ts) is pure and cannot see
// whether anything ever calls it -- a trigger that never fires would leave that
// suite entirely green.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 10, 12, 0, 0);

const session = (id: string, tabCount: number) => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-09-10 12:00:00',
  createdAt: T0,
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
        title: `Tab ${i}`,
        url: 'https://a.co',
      })),
    },
  ],
});

const momentOf = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().settingsDataState.lastValueMomentTime;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // The restore thunks hand off to the service worker, which does not exist
  // here. Only the dispatch before it is under test.
  globalThis.chrome = {
    ...(globalThis.chrome ?? {}),
    runtime: { sendMessage: vi.fn() },
  } as unknown as typeof chrome;
});

describe('restoring a session is a value moment', () => {
  test('opening every window records one', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });
    expect(momentOf(store)).toBe('');

    await store.dispatch(
      openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
    );

    expect(typeof momentOf(store)).toBe('number');
  });

  test('opening a single window records one', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });

    await store.dispatch(
      openTabsInAWindow({
        tabGroupId: 'a',
        windowId: 'a-w',
        goToURLText: 'Go to URL',
      })
    );

    expect(typeof momentOf(store)).toBe('number');
  });

  // The guard clause above the dispatch has to hold: a restore of something
  // that is not there did nothing for the user and must not be spent.
  test('a restore of a session that does not exist records nothing', async () => {
    const { store } = makeTestStore();

    await store.dispatch(
      openAllTabContainer({ tabGroupId: 'missing', goToURLText: 'Go to URL' })
    );

    expect(momentOf(store)).toBe('');
  });
});

// KAN-150. Sized against the user's own library rather than a constant.
const seedSizes = (
  store: ReturnType<typeof makeTestStore>['store'],
  sizes: number[]
) =>
  sizes.forEach((n, i) =>
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session(`seed${i}`, n),
    })
  );

describe('a save is a value moment only when it is substantial for this user', () => {
  test('a save larger than their median records one', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [2, 3, 4]); // median 3
    localStorage.clear();

    await store.dispatch(
      saveToTabContainer({ container: session('big', 5), scope: 'all-windows' })
    );

    expect(typeof momentOf(store)).toBe('number');
  });

  // THE CONTROL. The same five-tab save, for someone who saves far more --
  // proof this is relative rather than a constant wearing a new name. A fixed
  // threshold could not tell these two cases apart.
  test('CONTROL: the same save records nothing for a heavier user', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [30, 40, 50]); // median 40

    await store.dispatch(
      saveToTabContainer({ container: session('big', 5), scope: 'all-windows' })
    );

    expect(momentOf(store)).toBe('');
  });

  test('a save at exactly the median records nothing', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [4, 6, 8]); // median 6

    await store.dispatch(
      saveToTabContainer({
        container: session('same', 6),
        scope: 'all-windows',
      })
    );

    expect(momentOf(store)).toBe('');
  });

  // The library is read BEFORE the new session joins it, and this is the case
  // that can tell. Against [1, 10] the median is 5.5 and a six-tab save wins;
  // once the six is a member, [1, 6, 10] has median 6 and it ties, which loses.
  // Every other size pairing gives the same answer either way.
  test('measures against the library as it was before this save', async () => {
    const { store } = makeTestStore();
    seedSizes(store, [1, 10]);

    await store.dispatch(
      saveToTabContainer({ container: session('six', 6), scope: 'all-windows' })
    );

    expect(typeof momentOf(store)).toBe('number');
  });

  // Nothing has been demonstrated yet on an install holding one session.
  test('the very first save records nothing', async () => {
    const { store } = makeTestStore();

    await store.dispatch(
      saveToTabContainer({
        container: session('first', 99),
        scope: 'all-windows',
      })
    );

    expect(momentOf(store)).toBe('');
  });
});

describe('isSubstantialSave', () => {
  const lib = (...sizes: number[]) =>
    sizes.map((n, i) => session(`s${i}`, n)) as never;

  test('an empty library is never a payoff', () => {
    expect(isSubstantialSave(100, [])).toBe(false);
  });

  test('takes the middle of an odd-sized library', () => {
    expect(isSubstantialSave(6, lib(1, 5, 9))).toBe(true);
    expect(isSubstantialSave(5, lib(1, 5, 9))).toBe(false);
  });

  // Averaged, not "the one to the left". With [2,4,6,8] the median is 5, so a
  // five-tab save is NOT larger -- picking counts[1] would have called it one.
  test('averages the middle two of an even-sized library', () => {
    expect(isSubstantialSave(5, lib(2, 4, 6, 8))).toBe(false);
    expect(isSubstantialSave(6, lib(2, 4, 6, 8))).toBe(true);
  });

  // The counts are SORTED before the middle is taken. [1, 9, 5] is chosen
  // deliberately: unsorted, its middle element is 9 and a six-tab save loses;
  // sorted, the median is 5 and it wins. Comparing [9, 1, 5] against [1, 5, 9]
  // -- the obvious pair -- cannot see this, because 6 beats the middle of both.
  test('sorts before taking the middle, whatever order they arrive in', () => {
    expect(isSubstantialSave(6, lib(1, 9, 5))).toBe(true);
    expect(isSubstantialSave(6, lib(1, 5, 9))).toBe(true);
    expect(isSubstantialSave(6, lib(9, 5, 1))).toBe(true);
  });
});

describe('the recorded moment', () => {
  test('is written to localStorage, since the popup is about to close', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });

    await store.dispatch(
      openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
    );

    const stored = JSON.parse(localStorage.getItem('settingsData') ?? '{}');
    expect(typeof stored.lastValueMomentTime).toBe('number');
    expect(stored.lastValueMomentTime).toBe(momentOf(store));
  });

  test('moves forward when a newer moment happens', async () => {
    const { store } = makeTestStore();
    store.dispatch({
      type: 'tabContainerDataState/saveToTabContainerInternal',
      payload: session('a', 3),
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      await store.dispatch(
        openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
      );
      const first = momentOf(store);

      vi.setSystemTime(T0 + HOUR);
      await store.dispatch(
        openAllTabContainer({ tabGroupId: 'a', goToURLText: 'Go to URL' })
      );

      expect(momentOf(store)).toBe(T0 + HOUR);
      expect(momentOf(store)).toBeGreaterThan(first as number);
    } finally {
      vi.useRealTimers();
    }
  });
});
