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
  // Typed so a test can read back what would have been written to the cloud,
  // not merely whether the write happened.
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

const goodCloud = {
  lastModified: 5000,
  selectedTabGroupId: 'cloud-1',
  tabGroups: [
    {
      tabGroupId: 'cloud-1',
      title: 'Cloud session',
      createdTime: '2026-08-31 00:00:00',
      windowCount: 1,
      tabCount: 1,
      isAutoSave: false,
      isSelected: true,
      windows: [
        {
          windowId: 'w1',
          windowHeight: 100,
          windowWidth: 100,
          windowOffsetTop: 0,
          windowOffsetLeft: 0,
          tabCount: 1,
          title: 't',
          tabs: [{ tabId: 't1', favicon: '', title: 't', url: 'https://a.co' }],
        },
      ],
    },
  ],
};

describe('sync with invalid localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset().mockResolvedValue(goodCloud);
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ['null', 'null'],
    ['a bare string', '"corrupted"'],
    ['an array', '[]'],
    ['missing tabGroups', '{"lastModified":9999,"selectedTabGroupId":null}'],
    [
      'tabGroups not an array',
      '{"lastModified":9999,"selectedTabGroupId":null,"tabGroups":"x"}',
    ],
    [
      'a group missing isAutoSave',
      '{"lastModified":9999,"selectedTabGroupId":null,"tabGroups":[{"tabGroupId":"bad","title":"t","createdTime":"c","windowCount":1,"tabCount":1,"isSelected":false,"windows":[]}]}',
    ],
  ])('treats %s as absent and keeps the cloud copy', async (_label, raw) => {
    localStorage.setItem('tabContainerData', raw);

    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    await store.dispatch(syncStateWithFirestore() as never);

    // the intact cloud session survives
    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toEqual(['cloud-1']);
    // and nothing invalid was pushed back up
    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });

  // The guard must not change the behaviour it is not aimed at: a valid local
  // container still has to reach Redux and still has to be written to the
  // cloud when it is the newer side.
  //
  // Since KAN-32 that path is a union, not a replacement - both sessions
  // survive. The assertion is that the valid local one is not discarded, which
  // is what this test exists to protect; it deliberately does not pin down the
  // whole result, which mergeTabData.test.ts covers directly.
  it('leaves a valid newer local container on its existing path', async () => {
    const validLocal = {
      ...goodCloud,
      lastModified: 9000,
      selectedTabGroupId: 'local-1',
      tabGroups: [
        { ...goodCloud.tabGroups[0], tabGroupId: 'local-1', title: 'Local' },
      ],
    };
    localStorage.setItem('tabContainerData', JSON.stringify(validLocal));

    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(
      store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId)
    ).toContain('local-1');
    expect(mocks.saveToFirestore).toHaveBeenCalled();
  });
});

// The argument for landing KAN-33 ahead of the automatic merge is not that a
// corrupt container is *displayed*, it is that it *replicates*: the
// local-is-newer branch dispatches saveToFirestoreIfDirty, so an unvalidated
// object is written back over an intact cloud copy with no user present.
//
// That deserves its own assertion. Checked after the Redux check in the same
// test, it never executes on unguarded code - the earlier assertion fails
// first and shadows it, so reverting the guard proves only half the claim.
describe('invalid localStorage is not replicated to the cloud', () => {
  // Only shapes carrying a timestamp newer than the cloud copy reach the write
  // branch at all; the rest fall into the comparison's else arm and were never
  // going to write, so including them would weaken the assertion.
  const newerThanCloud: [string, string][] = [
    ['missing tabGroups', '{"lastModified":9999,"selectedTabGroupId":null}'],
    [
      'tabGroups not an array',
      '{"lastModified":9999,"selectedTabGroupId":null,"tabGroups":"x"}',
    ],
    [
      'a group missing isAutoSave',
      '{"lastModified":9999,"selectedTabGroupId":null,"tabGroups":[{"tabGroupId":"bad","title":"CORRUPT","createdTime":"c","windowCount":1,"tabCount":1,"isSelected":false,"windows":[]}]}',
    ],
  ];

  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset().mockResolvedValue(goodCloud);
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it.each(newerThanCloud)(
    'writes nothing to Firestore for %s, though it is newer than cloud',
    async (_label, raw) => {
      localStorage.setItem('tabContainerData', raw);

      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));
      await store.dispatch(syncStateWithFirestore() as never);

      // Asserted on the payloads rather than the call count so that reverting
      // the guard prints the object that would have replaced the cloud copy.
      const written = mocks.saveToFirestore.mock.calls.map((call) => call[1]);
      expect(written).toEqual([]);
    }
  );
});
