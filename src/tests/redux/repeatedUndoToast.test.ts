import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import type { tabContainerData } from '../../redux/slices/tabContainerDataStateSlice';

function group(id: string): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
    createdAt: Date.UTC(2026, 7, 31, 0, 0, 0),
    windowCount: 1,
    tabCount: 1,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: `w-${id}`,
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 1,
        title: 'window',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co/' },
        ],
      },
    ],
  };
}

// KAN-81. Restoring a container rebuilt `deletedTabGroups` entirely from the
// payload, and an undo snapshot is a photograph taken before any later
// tombstone existed -- so every undo discarded the tombstones written since,
// the next sync restored them from the cloud, the merged set differed from
// local's, and `changedFromLocal` raised "Synced changes from another device"
// on a device that has synced with nobody.
//
// The cloud here holds exactly what this device last wrote, so any claim that
// something arrived from elsewhere is false by construction. That is what makes
// this assertable at all: there is no other device.
describe('repeated undo does not claim changes came from another device (KAN-81)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('raises no merge toast across three undos', async () => {
    const { store, seen } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    for (const id of ['s1', 's2', 's3', 's4']) {
      store.dispatch(saveToTabContainerInternal(group(id)));
    }

    const roundsThatToasted: string[] = [];

    // The cloud accumulates what THIS device pushed, which is the whole point:
    // a tombstone local threw away is still up there to come back. Handing the
    // cloud a copy of local-after-the-undo instead makes every round agree by
    // construction, and the test then passes against the unfixed code -- which
    // is exactly what it did before this was corrected.
    let cloud: unknown = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    for (let round = 1; round <= 3; round++) {
      store.dispatch(undo());

      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      mocks.loadFromFirestore.mockResolvedValue(cloud);

      const before = seen.length;
      await store.dispatch(syncStateWithFirestore() as never);
      const during = seen.slice(before);
      if (during.includes('global/showToast/pending')) {
        roundsThatToasted.push(`round ${round}`);
      }

      // Whatever this device wrote is what the cloud now holds.
      const writes = mocks.saveToFirestore.mock.calls;
      if (writes.length > 0) cloud = writes[writes.length - 1][1];
    }

    // The control: the rounds really did run and really did sync, so an empty
    // toast list cannot mean the loop did nothing.
    expect(
      seen.filter((t) => t === 'global/syncStateWithFirestore/fulfilled')
    ).toHaveLength(3);
    expect(TOAST_MESSAGES.SYNC_MERGED).toBe(
      'Synced changes from another device.'
    );
    expect(roundsThatToasted).toEqual([]);
  });
});
