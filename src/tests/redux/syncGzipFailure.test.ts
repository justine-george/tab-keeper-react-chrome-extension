import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

const mocks = vi.hoisted(() => ({
  saveToFirestore: vi.fn(async () => undefined),
}));

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: mocks.saveToFirestore,
}));

// KAN-6. gzip fails: the write must stay pending, never report success.
vi.mock('../../utils/functions/compression', () => ({
  compressToBytes: vi.fn(async () => {
    throw new Error('gzip failed');
  }),
  decompressFromBytes: vi.fn(),
}));

import {
  saveToFirestoreIfDirty,
  setIsDirtyWithoutSync,
  setUserId,
} from '../../redux/slices/globalStateSlice';
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { COMPRESS_FROM_BYTES } from '../../utils/functions/cloudDocument';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';

describe('a big account whose gzip fails (KAN-6)', () => {
  it('leaves the write pending and sync in error', async () => {
    const base = buildSession({ tabGroupId: 'big' });
    const tab = base.windows[0].tabs[0];
    const big = buildContainer([
      {
        ...base,
        windows: [
          {
            ...base.windows[0],
            tabs: [
              { ...tab, url: `${tab.url}${'a'.repeat(COMPRESS_FROM_BYTES)}` },
            ],
          },
        ],
      },
    ]);
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(big));
    store.dispatch(setIsDirtyWithoutSync());
    const result = await store.dispatch(saveToFirestoreIfDirty());
    expect(result.meta.requestStatus).toBe('rejected');
    expect(store.getState().globalState.isDirty).toBe(true);
    expect(store.getState().globalState.syncStatus).toBe('error');
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });
});
