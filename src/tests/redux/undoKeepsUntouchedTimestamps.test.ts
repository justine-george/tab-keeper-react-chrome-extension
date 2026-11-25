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
}));

import {
  setSignedIn,
  setUserId,
  syncStateWithFirestore,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';
import { redo, undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
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

// KAN-1016. A redo stamps a session past its own grave, but the snapshot in
// history keeps the stamp it had before. A later undo that leaves that session
// untouched handed back the snapshot's older stamp; the cloud still held the
// newer one, so the next sync took it, said "Synced changes from another
// device" on a device that syncs with nobody, and cleared undo (D12).
//
// The cloud here holds only what this device wrote, so any toast is false.
describe('an undo leaves an untouched session stamped as it was (KAN-1016)', () => {
  let clock = Date.UTC(2026, 10, 25, 12, 0, 0);
  const tick = () => vi.setSystemTime((clock += 10));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('raises no merge toast and keeps the undo history', async () => {
    const { store, seen } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    const stampOf = (id: string) =>
      store
        .getState()
        .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id)
        ?.lastModified;

    // Whatever this device last wrote is what the cloud holds.
    const sync = async () => {
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const before = seen.length;
      await store.dispatch(syncStateWithFirestore() as never);
      await vi.waitFor(() =>
        expect(store.getState().globalState.syncsInFlight).toBe(0)
      );
      const writes = mocks.saveToFirestore.mock.calls;
      if (writes.length > 0) {
        mocks.loadFromFirestore.mockResolvedValue(
          JSON.parse(JSON.stringify(writes[writes.length - 1][1]))
        );
      }
      return seen.slice(before).includes('global/showToast/pending');
    };

    store.dispatch(saveToTabContainerInternal(group('a')));
    tick();
    store.dispatch(undo());
    tick();
    store.dispatch(redo());
    const redoneAt = stampOf('a');
    tick();
    store.dispatch(saveToTabContainerInternal(group('b')));
    tick();
    expect(await sync()).toBe(false);

    tick();
    store.dispatch(undo());
    // The undo took back b and never touched a.
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['a']);
    expect(stampOf('a')).toBe(redoneAt);
    const pastBefore = store.getState().undoRedo.past.length;
    expect(pastBefore).toBeGreaterThan(0);

    tick();
    expect(await sync()).toBe(false);
    expect(store.getState().undoRedo.past).toHaveLength(pastBefore);
    expect(
      seen.filter((t) => t === 'global/syncStateWithFirestore/fulfilled')
    ).toHaveLength(2);
  });
});
