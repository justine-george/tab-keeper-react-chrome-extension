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
  VALUE_MOMENT_MIN_TABS,
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

describe('a save is a value moment only when it is substantial', () => {
  test(`a save of ${VALUE_MOMENT_MIN_TABS} tabs records one`, async () => {
    const { store } = makeTestStore();

    await store.dispatch(
      saveToTabContainer({
        container: session('big', VALUE_MOMENT_MIN_TABS),
        scope: 'all-windows',
      })
    );

    expect(typeof momentOf(store)).toBe('number');
  });

  // THE CONTROL, and the reason the threshold exists at all. Banking a couple
  // of tabs is housekeeping; if it counted, the prompt would ride on ordinary
  // use and become the nagging this ticket set out to avoid.
  test('a small save records nothing', async () => {
    const { store } = makeTestStore();

    await store.dispatch(
      saveToTabContainer({
        container: session('small', VALUE_MOMENT_MIN_TABS - 1),
        scope: 'current-window',
      })
    );

    expect(momentOf(store)).toBe('');
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
