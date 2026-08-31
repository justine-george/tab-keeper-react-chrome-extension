import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  loadFromFirestore: vi.fn(async (): Promise<unknown> => undefined),
  saveToFirestore: vi.fn<(userId: string, data: unknown) => Promise<void>>(
    async () => undefined
  ),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: mocks.loadFromFirestore,
  saveToFirestore: mocks.saveToFirestore,
  displayToast: vi.fn(),
}));

import { setSignedIn, setUserId } from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  replaceState,
} from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { DEBOUNCE_TIME_WINDOW } from '../../utils/constants/common';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string, lastModified: number): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    lastModified,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 't',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' },
        ],
      },
    ],
  };
}

// customMiddleware schedules a debounced sync whenever it sees setIsDirty.
// That is right for a user edit and wrong for the merge branch, which is
// already running inside a sync: reusing the same action made every merge that
// wrote schedule another full sync, so each write cost an extra round trip and
// any persistent disagreement became an unbounded loop.
describe('a sync is scheduled by user edits, not by the merge persisting', () => {
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_TIME_WINDOW * 4);
  };

  // A fake backend rather than a mock that always answers the same thing: a
  // cloud stuck permanently empty would keep the sync legitimately dirty and
  // hide the difference this test is looking for.
  let cloudDoc: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    cloudDoc = undefined;
    mocks.loadFromFirestore
      .mockReset()
      .mockImplementation(async () => cloudDoc);
    mocks.saveToFirestore
      .mockReset()
      .mockImplementation(async (_userId, data) => {
        cloudDoc = JSON.parse(JSON.stringify(data));
      });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a sync when the user changes data', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    store.dispatch(saveToTabContainerInternal(group('a', 1000)));
    await settle();

    expect(mocks.loadFromFirestore).toHaveBeenCalledTimes(1);
  });

  it('does not schedule another sync just because the merge wrote', async () => {
    // Local and cloud each hold a session the other lacks, so the merge is
    // guaranteed to produce changedFromCloud and therefore a write.
    const local: TabMasterContainer = {
      lastModified: 10,
      selectedTabGroupId: null,
      tabGroups: [group('local-only', 10)],
      deletedTabGroups: [],
    };
    const cloud: TabMasterContainer = {
      lastModified: 20,
      selectedTabGroupId: null,
      tabGroups: [group('cloud-only', 20)],
      deletedTabGroups: [],
    };
    localStorage.setItem('tabContainerData', JSON.stringify(local));
    cloudDoc = cloud;

    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(local));

    // One user edit -> exactly one scheduled sync.
    store.dispatch(saveToTabContainerInternal(group('fresh', 30)));
    await settle();

    expect(mocks.saveToFirestore).toHaveBeenCalled();
    const readsAfterFirstSync = mocks.loadFromFirestore.mock.calls.length;

    // Let every timer the first sync may have armed run out. The merge wrote,
    // so under the old wiring its setIsDirty would have scheduled another
    // full sync here.
    await settle();
    await settle();

    expect(mocks.loadFromFirestore.mock.calls.length).toBe(readsAfterFirstSync);
  });
});
