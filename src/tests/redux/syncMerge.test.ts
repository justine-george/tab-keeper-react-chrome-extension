import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
// Keep in step with src/tests/setup/domStub.ts.
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

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { TOAST_MESSAGES } from '../../utils/constants/common';
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

async function runSync(local: TabMasterContainer, cloud: TabMasterContainer) {
  localStorage.setItem('tabContainerData', JSON.stringify(local));
  mocks.loadFromFirestore.mockResolvedValue(cloud);
  const { store, seen } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  seen.length = 0;
  mocks.saveToFirestore.mockClear();
  await store.dispatch(syncStateWithFirestore() as never);
  return { store, seen };
}

const divergent = {
  local: (): TabMasterContainer => ({
    lastModified: 10,
    selectedTabGroupId: 'a',
    tabGroups: [group('a', 10)],
  }),
  cloud: (): TabMasterContainer => ({
    lastModified: 20,
    selectedTabGroupId: 'b',
    tabGroups: [group('b', 20)],
  }),
};

describe('sync merges instead of prompting', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('unions both sides - neither is discarded', async () => {
    const { store } = await runSync(divergent.local(), divergent.cloud());
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
        .sort()
    ).toEqual(['a', 'b']);
  });

  it('never opens a conflict modal - the state is gone', async () => {
    const { store } = await runSync(divergent.local(), divergent.cloud());
    expect('isConflictModalOpen' in store.getState().globalState).toBe(false);
  });

  it('writes to Firestore when local contributed something', async () => {
    await runSync(divergent.local(), divergent.cloud());
    expect(mocks.saveToFirestore).toHaveBeenCalled();
  });

  it('does NOT write when the two sides already agree', async () => {
    const same = (): TabMasterContainer => ({
      lastModified: 10,
      selectedTabGroupId: 'a',
      tabGroups: [group('a', 10)],
      deletedTabGroups: [],
    });
    await runSync(same(), same());
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });

  it('a deletion on this device survives a sync with a stale cloud', async () => {
    const { store } = await runSync(
      {
        lastModified: 90,
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: [{ tabGroupId: 'a', deletedAt: 90 }],
      },
      { lastModified: 50, selectedTabGroupId: 'a', tabGroups: [group('a', 50)] }
    );
    expect(store.getState().tabContainerDataState.tabGroups).toEqual([]);
  });

  // The toast is the only remaining signal that the two devices had diverged,
  // now that the blocking prompt is gone. It must fire when this device
  // learned something, and stay silent otherwise, or it becomes noise on every
  // popup open and users stop reading it.
  it('toasts when the merge brought something new to this device', async () => {
    const { store } = await runSync(divergent.local(), divergent.cloud());
    expect(store.getState().globalState.toastText).toBe(
      TOAST_MESSAGES.SYNC_MERGED
    );
  });

  it('stays silent when this device learned nothing', async () => {
    const same = (): TabMasterContainer => ({
      lastModified: 10,
      selectedTabGroupId: 'a',
      tabGroups: [group('a', 10)],
      deletedTabGroups: [],
    });
    const { store } = await runSync(same(), same());
    expect(store.getState().globalState.toastText).not.toBe(
      TOAST_MESSAGES.SYNC_MERGED
    );
    expect(store.getState().globalState.isToastOpen).toBe(false);
  });

  // Local-only changes must reach the cloud without telling the user anything:
  // this device already knows about them.
  it('writes but does not toast when only the cloud was behind', async () => {
    const { store } = await runSync(
      {
        lastModified: 30,
        selectedTabGroupId: 'a',
        tabGroups: [group('a', 30)],
        deletedTabGroups: [],
      },
      {
        lastModified: 20,
        selectedTabGroupId: null,
        tabGroups: [],
        deletedTabGroups: [],
      }
    );
    expect(mocks.saveToFirestore).toHaveBeenCalled();
    expect(store.getState().globalState.toastText).not.toBe(
      TOAST_MESSAGES.SYNC_MERGED
    );
  });
});
