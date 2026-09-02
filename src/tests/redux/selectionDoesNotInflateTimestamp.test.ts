import { describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
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
  replaceState,
  selectTabContainer,
  updateTabGroupTitle,
  TabMasterContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';
import { mergeTabContainers } from '../../utils/functions/mergeTabData';

// KAN-58. `selectTabContainer` used to stamp the container-wide `lastModified`
// on every click and every search keystroke.
//
// That is not cosmetic. `sessionTimestamp` (mergeTabData.ts:35-40) falls back
// to the container's timestamp for any session that has none of its own, and
// `touch()` only stamps the session it edits -- so a container stays partially
// legacy indefinitely. Sessions written before per-session timestamps existed,
// and never edited since, permanently inherit the container value.
//
// Browsing on device A therefore made A's stale copies of those sessions
// outrank device B's genuine edits on the next sync, and B's edit was lost.
// The same inflated value also feeds `signature()`, so it flipped
// `changedFromCloud` to true and forced a write.

// Deliberately WITHOUT `lastModified`: this is what a session saved before
// per-session timestamps existed looks like, and the only shape that reaches
// the container-level fallback.
const legacySession = (id: string, title: string): tabContainerData => ({
  tabGroupId: id,
  title,
  createdTime: '2026-01-01 09:00:00',
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `win-${id}`,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window',
      tabs: [
        {
          tabId: `${id}-t0`,
          favicon: '',
          title: 'Page',
          url: 'https://example.com/',
        },
      ],
    },
  ],
});

// An old, fixed instant, so the assertions do not depend on the wall clock.
const T = 1_700_000_000_000;

const legacyContainer = (): TabMasterContainer => ({
  lastModified: T,
  selectedTabGroupId: 'group-1',
  tabGroups: [
    { ...legacySession('group-1', 'Alpha'), isSelected: true },
    legacySession('group-2', 'Bravo'),
  ],
  deletedTabGroups: [],
});

const storeWithLegacyData = () => {
  const { store } = makeTestStore();
  store.dispatch(replaceState(legacyContainer()));
  return store;
};

describe('selection does not inflate the container timestamp (KAN-58)', () => {
  // The control. `lastModified` must still track real edits, or the merge
  // loses its ordering signal entirely and "never stamp it" would pass every
  // other test in this file.
  test('a content edit still advances the container timestamp', () => {
    const store = storeWithLegacyData();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-1', editableTitle: 'RENAMED' })
    );

    expect(store.getState().tabContainerDataState.lastModified).toBeGreaterThan(
      T
    );
  });

  test('selecting a session leaves the container timestamp alone', () => {
    const store = storeWithLegacyData();

    store.dispatch(selectTabContainer('group-2'));

    expect(store.getState().tabContainerDataState.lastModified).toBe(T);
  });

  test('the selection itself still takes effect', () => {
    const store = storeWithLegacyData();

    store.dispatch(selectTabContainer('group-2'));

    const state = store.getState().tabContainerDataState;
    expect(state.selectedTabGroupId).toBe('group-2');
    expect(
      state.tabGroups.find((g) => g.tabGroupId === 'group-2')?.isSelected
    ).toBe(true);
  });
});

// The consequence, end to end. These merge a real post-browsing local state
// against a cloud copy in which the other device genuinely edited a legacy
// session, and assert the edit survives.
describe('browsing does not outrank another device (KAN-58)', () => {
  // Device B edited group-1 shortly after T, which stamps that session with
  // its own timestamp. group-2 stays legacy on both sides.
  const cloudWithEdit = (): TabMasterContainer => ({
    lastModified: T + 100,
    selectedTabGroupId: null,
    tabGroups: [
      {
        ...legacySession('group-1', 'EDITED ON DEVICE B'),
        lastModified: T + 100,
      },
      legacySession('group-2', 'Bravo'),
    ],
    deletedTabGroups: [],
  });

  const titleAfterMerge = (local: TabMasterContainer) =>
    mergeTabContainers(
      local,
      cloudWithEdit(),
      T + 10_000
    ).merged.tabGroups.find((g) => g.tabGroupId === 'group-1')?.title;

  // The control for the test below: proves the scenario is built correctly and
  // that the cloud edit wins when nothing has inflated the local timestamp. If
  // this ever fails, the test below proves nothing about browsing.
  test("device B's edit wins when device A has not browsed", () => {
    const store = storeWithLegacyData();

    expect(titleAfterMerge(store.getState().tabContainerDataState)).toBe(
      'EDITED ON DEVICE B'
    );
  });

  // The defect. Selection is the only difference from the control above.
  test("device B's edit survives device A merely clicking around", () => {
    const store = storeWithLegacyData();

    store.dispatch(selectTabContainer('group-2'));
    store.dispatch(selectTabContainer('group-1'));

    expect(titleAfterMerge(store.getState().tabContainerDataState)).toBe(
      'EDITED ON DEVICE B'
    );
  });

  // Browsing must not manufacture a write either: the inflated timestamp fed
  // `signature()`, so it made the merge look different from the cloud even
  // though no content had changed.
  test('clicking around does not make the merge look changed from the cloud', () => {
    const store = storeWithLegacyData();

    store.dispatch(selectTabContainer('group-2'));

    const local = store.getState().tabContainerDataState;
    // Cloud identical to the untouched local container, so the only thing that
    // could differ is a timestamp the browsing moved.
    const { changedFromCloud } = mergeTabContainers(
      local,
      legacyContainer(),
      T + 10_000
    );

    expect(changedFromCloud).toBe(false);
  });
});
