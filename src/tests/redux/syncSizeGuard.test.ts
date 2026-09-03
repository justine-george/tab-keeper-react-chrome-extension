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
  setIsDirtyWithoutSync,
  setUserId,
  saveToFirestoreIfDirty,
} from '../../redux/slices/globalStateSlice';
// replaceState lives on the data slice, not the global slice.
import { replaceState } from '../../redux/slices/tabContainerDataStateSlice';
import { makeTestStore } from '../setup/makeStore';
import { buildContainer, buildSession } from '../fixtures/sessionFixture';
import { FIRESTORE_MAX_DOCUMENT_BYTES } from '../../utils/functions/local';

// A session whose tab titles alone exceed the document limit. Built from real
// field names so estimateFirestoreBytes measures the same JSON production does.
function oversizedContainer() {
  const filler = 'x'.repeat(2000);
  const sessions = Array.from({ length: 600 }, (_, i) =>
    buildSession({ tabGroupId: `big-${i}`, title: `${filler}-${i}` })
  );
  return buildContainer(sessions);
}

describe('the sync write refuses a document Firestore would reject', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('the fixture really is over the limit (guards the test itself)', () => {
    const json = JSON.stringify(oversizedContainer());
    expect(new TextEncoder().encode(json).byteLength).toBeGreaterThan(
      FIRESTORE_MAX_DOCUMENT_BYTES
    );
  });

  it('does not call setDoc with an over-limit container', async () => {
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(oversizedContainer()));
    store.dispatch(setIsDirtyWithoutSync());
    await store.dispatch(saveToFirestoreIfDirty());
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });

  it('explains the refusal in MB, like the import guard does', async () => {
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(oversizedContainer()));
    store.dispatch(setIsDirtyWithoutSync());
    const result = await store.dispatch(saveToFirestoreIfDirty());
    expect(
      String((result as { error?: { message?: string } }).error?.message)
    ).toMatch(/too large to sync .* MB of a 1\.0 MB limit/);
  });

  // POSITIVE CONTROL. "not called" passes trivially against a broken store or
  // a thunk that never runs, so prove the same setup CAN write.
  it('control: an under-limit container IS written', async () => {
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(buildContainer([buildSession()])));
    store.dispatch(setIsDirtyWithoutSync());
    await store.dispatch(saveToFirestoreIfDirty());
    expect(mocks.saveToFirestore).toHaveBeenCalledTimes(1);
  });
});
