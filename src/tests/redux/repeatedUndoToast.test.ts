import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  closeToast,
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import { TOAST_MESSAGES } from '../../utils/constants/common';
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';

// Reported from the live extension: create four sessions, then undo
// repeatedly. The first undo is clean; every undo after it raises "Synced
// changes from another device", though no other device exists.
//
// changedFromLocal is what raises that toast, and it means "the merge changed
// what this device had". So the question this file asks is whether a plain
// local undo can make the merge disagree with local state.

function group(id: string): tabContainerData {
  return {
    tabGroupId: id,
    title: id,
    createdTime: '2026-08-31 00:00:00',
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
        title: 't',
        tabs: [
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' },
        ],
      },
    ],
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const ids = (c: TabMasterContainer) =>
  c.tabGroups.map((g) => g.tabGroupId).sort();

describe('repeated undo does not claim another device changed something', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('raises no merge toast on any undo, first or later', async () => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));

    for (const id of ['s1', 's2', 's3', 's4']) {
      store.dispatch(saveToTabContainerInternal(group(id)));
    }

    // The cloud only ever holds what this device last wrote. Nothing else
    // touches it, so any "changed from another device" claim is false.
    let cloud = clone(store.getState().tabContainerDataState);

    const toasted: Array<{ round: number; text: string; left: string[] }> = [];

    for (let round = 1; round <= 3; round++) {
      store.dispatch(closeToast());
      store.dispatch(undo());

      const local = store.getState().tabContainerDataState;
      localStorage.setItem('tabContainerData', JSON.stringify(local));
      mocks.loadFromFirestore.mockResolvedValue(clone(cloud));

      const writesBefore = mocks.saveToFirestore.mock.calls.length;
      await store.dispatch(syncStateWithFirestore() as never);
      const writesAfter = mocks.saveToFirestore.mock.calls.length;

      const global = store.getState().globalState;
      if (global.isToastOpen && global.toastText === TOAST_MESSAGES.SYNC_MERGED)
        toasted.push({
          round,
          text: global.toastText,
          left: ids(store.getState().tabContainerDataState),
        });

      // Whatever the sync wrote becomes the cloud, as Firestore would hold it.
      if (writesAfter > writesBefore) {
        cloud = clone(
          mocks.saveToFirestore.mock.calls[
            writesAfter - 1
          ][1] as TabMasterContainer
        );
      }
    }

    expect(toasted).toEqual([]);
  });
});
