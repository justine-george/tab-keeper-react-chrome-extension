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
import {
  FIRESTORE_MAX_DOCUMENT_BYTES,
  estimateFirestoreBytes,
} from '../../utils/functions/local';

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

// A heavy but realistic account: 40 sessions x 3 windows x 20 tabs, with half
// the tabs in one of two groups per window.
function sizedContainer(grouped: boolean) {
  const sessions = Array.from({ length: 40 }, (_, s) =>
    buildSession({
      tabGroupId: `session-${s}`,
      windows: Array.from({ length: 3 }, (_, w) => ({
        windowId: `w-${s}-${w}`,
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 20,
        title: 'A window of tabs',
        ...(grouped
          ? {
              chromeTabGroups: [
                { groupId: `g-${s}-${w}-a`, title: 'Work', color: 'blue' },
                { groupId: `g-${s}-${w}-b`, title: 'Reading', color: 'green' },
              ],
            }
          : {}),
        tabs: Array.from({ length: 20 }, (_, t) => ({
          tabId: `t-${s}-${w}-${t}`,
          favicon: '',
          title: 'A page title of about fifty characters, give or take',
          url: `https://example.com/some/path/segment/${s}/${w}/${t}?q=value`,
          // Half grouped, matching how people actually use groups: a few
          // organised runs among a majority of loose tabs.
          ...(grouped && t < 10
            ? { chromeGroupId: `g-${s}-${w}-${t < 5 ? 'a' : 'b'}` }
            : {}),
        })),
      })),
    })
  );
  return buildContainer(sessions);
}

it('tab group metadata does not materially change the size estimate', () => {
  const withoutGroups = estimateFirestoreBytes(sizedContainer(false));
  const withGroups = estimateFirestoreBytes(sizedContainer(true));

  // Measured (see the commit message and KAN-11 for the numbers): tab group
  // metadata added 11.7% on a grouped-heavy account, against the 15% budget
  // below -- about 3 points of margin left, not a lot. The document itself
  // is still well under Firestore's 1 MiB ceiling.
  //
  // If a future field pushes this over, take the spec's §8.3 fallback:
  // reference groups by their index in chromeTabGroups instead of by uuid,
  // saving ~48 bytes per grouped tab.
  expect((withGroups - withoutGroups) / withoutGroups).toBeLessThan(0.15);
  expect(withGroups).toBeLessThan(FIRESTORE_MAX_DOCUMENT_BYTES);
});
