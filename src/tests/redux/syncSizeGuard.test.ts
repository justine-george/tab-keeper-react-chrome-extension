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
import { SYNC_SIZE_REFUSAL } from '../../utils/functions/local';
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

  // KAN-86. The refusal used to be a sentence built by concatenation, which
  // matched no i18n key and so reached every locale in English. It is now a
  // key plus the numbers it interpolates.
  //
  // Asserted on the STORE rather than on the thunk's rejection message,
  // because the toast is what a user actually sees; the rejection reason is
  // internal and nothing renders it.
  it('explains the refusal in MB, like the import guard does', async () => {
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(oversizedContainer()));
    store.dispatch(setIsDirtyWithoutSync());
    await store.dispatch(saveToFirestoreIfDirty());

    const { toastText, toastParams } = store.getState().globalState;
    expect(toastText).toBe(SYNC_SIZE_REFUSAL);
    // Both numbers must be present. A key dispatched without them still
    // translates, and still renders "(  MB of a   MB limit)".
    expect(toastParams).toEqual({
      used: expect.stringMatching(/^\d+\.\d$/),
      limit: '1.0',
    });
    expect(Number(toastParams!.used)).toBeGreaterThan(1.0);
  });

  // CONTROL for the assertion above: the key alone proves nothing unless an
  // under-limit save leaves no refusal toast behind at all.
  it('control: an under-limit container raises no refusal toast', async () => {
    const { store } = makeTestStore();
    store.dispatch(setUserId('u1'));
    store.dispatch(replaceState(buildContainer([buildSession()])));
    store.dispatch(setIsDirtyWithoutSync());
    await store.dispatch(saveToFirestoreIfDirty());
    expect(store.getState().globalState.toastText).not.toBe(SYNC_SIZE_REFUSAL);
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

// Production mints uuidv4() -- 36 characters -- for groupId (capture.ts:158),
// tabId (:186) and windowId (:197), and chromeGroupId is set to that same
// 36-char group uuid (:184). A fixture using short hand-written ids like
// `g-0-0-a` understates the real per-tab cost (the encoded JSON key/value
// pair costs 19 + len(id) bytes), so this pads any short id out to 36
// characters. It does not need to be a real uuid -- only the right length,
// since estimateFirestoreBytes only counts encoded bytes.
function id36(prefix: string): string {
  return prefix.padEnd(36, '0').slice(0, 36);
}

// A heavy but realistic account: 40 sessions x 3 windows x 20 tabs, with
// EVERY tab in one of two groups per window when grouped -- the worst case
// for a feature whose entire purpose is grouping, not a partial one.
function sizedContainer(grouped: boolean) {
  const sessions = Array.from({ length: 40 }, (_, s) =>
    buildSession({
      tabGroupId: `session-${s}`,
      windows: Array.from({ length: 3 }, (_, w) => ({
        windowId: id36(`w-${s}-${w}-`),
        windowHeight: 1080,
        windowWidth: 1920,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 20,
        title: 'A window of tabs',
        ...(grouped
          ? {
              chromeTabGroups: [
                {
                  groupId: id36(`g-${s}-${w}-a-`),
                  title: 'Work',
                  color: 'blue',
                },
                {
                  groupId: id36(`g-${s}-${w}-b-`),
                  title: 'Reading',
                  color: 'green',
                },
              ],
            }
          : {}),
        tabs: Array.from({ length: 20 }, (_, t) => ({
          tabId: id36(`t-${s}-${w}-${t}-`),
          favicon: '',
          title: 'A page title of about fifty characters, give or take',
          url: `https://example.com/some/path/segment/${s}/${w}/${t}?q=value`,
          // Fully grouped: every tab belongs to one of the two groups above.
          ...(grouped
            ? { chromeGroupId: id36(`g-${s}-${w}-${t < 10 ? 'a' : 'b'}-`) }
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

  // Measured with production-length (36-char) uuids, on a container where
  // EVERY tab is grouped -- the realistic ceiling for this feature, not a
  // 50%-grouped average: tab group metadata added ~32% on top of the
  // ungrouped baseline. The 35% budget below is a change-detector with some
  // headroom, not a safety limit -- it exists to make a future field
  // addition show up in review, nothing more.
  //
  // The actual safety limit is the FIRESTORE_MAX_DOCUMENT_BYTES assertion on
  // the next line: a 2,400-tab, fully-grouped account (this fixture) lands
  // at ~630 KB, about 60% of Firestore's 1 MiB ceiling, with margin to
  // spare.
  //
  // If a future field pushes this over, take the spec's §8.3 fallback:
  // reference groups by their index in chromeTabGroups instead of by uuid,
  // saving ~48 bytes per grouped tab.
  expect((withGroups - withoutGroups) / withoutGroups).toBeLessThan(0.35);
  expect(withGroups).toBeLessThan(FIRESTORE_MAX_DOCUMENT_BYTES);
});
