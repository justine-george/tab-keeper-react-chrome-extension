import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  hydrateFromOtherPage,
  replaceState,
  saveToTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { SAMPLE_ID_PREFIX } from '../../utils/functions/sampleSession';

// KAN-388. Each session the user saves plays the header mark's shutter; this is the count the mark watches.

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);

const session = (id: string, tabCount: number) => ({
  tabGroupId: id,
  title: id.toUpperCase(),
  createdTime: '2026-10-30 12:00:00',
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

type Store = ReturnType<typeof makeTestStore>['store'];

const saves = (store: Store) => store.getState().globalState.sessionSaves;

const seed = (store: Store, id: string) =>
  store.dispatch({
    type: 'tabContainerDataState/saveToTabContainerInternal',
    payload: session(id, 2),
  });

const save = (store: Store, id: string) =>
  store.dispatch(
    saveToTabContainer({ container: session(id, 2), scope: 'all-windows' })
  );

const listOf = (...ids: string[]) => ({
  lastModified: T0,
  selectedTabGroupId: null,
  tabGroups: ids.map((id) => session(id, 2)),
});

beforeEach(() => {
  localStorage.clear();
});

describe('every new session counts, for the header shutter', () => {
  test('the first save counts', async () => {
    const { store } = makeTestStore();
    expect(saves(store)).toBe(0);
    await save(store, 'a');
    expect(saves(store)).toBe(1);
  });

  test('each later save counts again', async () => {
    const { store } = makeTestStore();
    seed(store, 'a');
    await save(store, 'b');
    await save(store, 'c');
    expect(saves(store)).toBe(2);
  });

  test('two saves at once count twice', async () => {
    const { store } = makeTestStore();
    await Promise.all([save(store, 'a'), save(store, 'b')]);
    expect(saves(store)).toBe(2);
  });

  test('the sample saved does not count', async () => {
    const { store } = makeTestStore();
    await save(store, `${SAMPLE_ID_PREFIX}x`);
    expect(saves(store)).toBe(0);
  });

  test('sessions arriving from another page or sync do not count', () => {
    const { store } = makeTestStore();
    store.dispatch(hydrateFromOtherPage(listOf('a')));
    store.dispatch(replaceState(listOf('b')));
    expect(saves(store)).toBe(0);
  });
});
