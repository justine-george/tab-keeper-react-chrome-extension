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
import { markHadSavedSession } from '../../redux/slices/settingsDataStateSlice';
import { importBookmarkSessions } from '../../redux/bookmarkImport';

// Bookmarks the record names, made with no dateAdded as the fixtures are.
const marks = (ids: string[]) => ids.map((id) => ({ id, dateAdded: null }));

// KAN-875. The first session the user saves on this device pops floppy disks; this is the count the pop reads.

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

const pops = (store: Store) => store.getState().globalState.firstSavePops;

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

describe('the first save on this device', () => {
  test('the first real save counts once', async () => {
    const { store } = makeTestStore();
    expect(pops(store)).toBe(0);
    await save(store, 'a');
    expect(pops(store)).toBe(1);
  });

  test('two saves in a row count once', async () => {
    const { store } = makeTestStore();
    const first = save(store, 'a');
    const second = save(store, 'b');
    await Promise.all([first, second]);
    expect(pops(store)).toBe(1);
  });

  test('the sample saved does not count', async () => {
    const { store } = makeTestStore();
    await save(store, `${SAMPLE_ID_PREFIX}x`);
    expect(pops(store)).toBe(0);
  });

  test('a first real save beside only the sample counts', async () => {
    const { store } = makeTestStore();
    seed(store, `${SAMPLE_ID_PREFIX}x`);
    await save(store, 'a');
    expect(pops(store)).toBe(1);
  });

  test('after everything was deleted, saving again does not count', async () => {
    const { store } = makeTestStore();
    store.dispatch(markHadSavedSession());
    await save(store, 'a');
    expect(pops(store)).toBe(0);
  });

  test('sessions arriving from another page or sync do not count', () => {
    const { store } = makeTestStore();
    store.dispatch(hydrateFromOtherPage(listOf('a')));
    store.dispatch(replaceState(listOf('b')));
    expect(pops(store)).toBe(0);
  });

  test('CONTROL: a save onto an existing session list does not count', async () => {
    const { store } = makeTestStore();
    seed(store, 'a');
    await save(store, 'b');
    expect(pops(store)).toBe(0);
  });
});

// KAN-862 R14. An import is no save: the user's own first save after one still pops.
describe('the first save after an import', () => {
  const importOf = (store: Store, ...ids: string[]) =>
    store.dispatch(
      importBookmarkSessions(
        ids.map((id) => ({
          bookmarks: marks([`f-${id}`]),
          session: session(id, 2),
        }))
      )
    );

  test('an import, then the first own save, counts once', async () => {
    const { store } = makeTestStore();
    importOf(store, 'i1', 'i2');
    expect(pops(store)).toBe(0);
    await save(store, 'a');
    expect(pops(store)).toBe(1);
    await save(store, 'b');
    expect(pops(store)).toBe(1);
  });

  test('CONTROL: synced sessions held before the import still keep the pop away', async () => {
    const { store } = makeTestStore();
    store.dispatch(markHadSavedSession());
    importOf(store, 'i1');
    await save(store, 'a');
    expect(pops(store)).toBe(0);
  });

  test('synced sessions held after the import keep the pop away too', async () => {
    const { store } = makeTestStore();
    importOf(store, 'i1');
    store.dispatch(markHadSavedSession());
    await save(store, 'a');
    expect(pops(store)).toBe(0);
  });

  test('save, then import, then save: not a first', async () => {
    const { store } = makeTestStore();
    await save(store, 'a');
    importOf(store, 'i1');
    await save(store, 'b');
    expect(pops(store)).toBe(1);
  });
});
