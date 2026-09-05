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
import type {
  TabMasterContainer,
  tabContainerData,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-79. `syncStatus` is not bookkeeping -- it is the only thing the header
// icon reads (MenuContainer.tsx:54-63), and it is the only state that can say
// "local and cloud are confirmed to agree".
//
// `isDirty` cannot say that, which is why the icon cannot be derived from it.
// globalState is in-memory and rebuilt on every popup open, so `isDirty ===
// false` at open means only "no edits yet this session" -- with auto-sync off,
// nothing has been compared at all. Only a completed sync licenses `success`.

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
          {
            tabId: `t-${id}`,
            favicon: '',
            title: 't',
            url: 'https://example.com/',
          },
        ],
      },
    ],
  };
}

const agreeing = (): TabMasterContainer => ({
  lastModified: 10,
  selectedTabGroupId: 'a',
  tabGroups: [group('a', 10)],
  deletedTabGroups: [],
});

async function runSync(local: TabMasterContainer | null, cloud: unknown) {
  if (local) localStorage.setItem('tabContainerData', JSON.stringify(local));
  mocks.loadFromFirestore.mockResolvedValue(cloud);
  const { store } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  await store.dispatch(syncStateWithFirestore() as never);
  return store;
}

describe('the sync status the header icon reads', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  // The control, and the branch that already worked: with nothing stored
  // locally the cloud document is taken wholesale, and that path dispatches
  // setSyncStatus('success') explicitly. Without this, a failure below could
  // just mean the thunk never ran.
  it('CONTROL: reports success when the cloud document is taken wholesale', async () => {
    const store = await runSync(null, agreeing());

    expect(store.getState().globalState.syncStatus).toBe('success');
  });

  // The defect. Both sides already hold the same thing, so the merge writes
  // nothing -- the MOST in-sync a user can be, and the most common state on
  // any popup open. It was the one branch that left syncStatus at its initial
  // 'idle', so the header showed the actionable "sync" icon on a session that
  // had just been confirmed up to date.
  it('reports success when local and cloud already agree', async () => {
    const store = await runSync(agreeing(), agreeing());

    expect(store.getState().globalState.syncStatus).toBe('success');
  });

  // Pins the reason the branch above is reachable at all: agreeing sides mean
  // no write. If this ever fails, the test above is passing for the wrong
  // reason -- it would be going through saveToFirestoreIfDirty's fulfilled
  // reducer rather than the branch it is meant to cover.
  it('and does so without writing to Firestore', async () => {
    await runSync(agreeing(), agreeing());

    expect(mocks.saveToFirestore).not.toHaveBeenCalled();
  });

  // A bad sync must not read as "up to date". This one already worked; it is
  // here so a future change to the success paths cannot quietly make every
  // outcome report success.
  //
  // The trigger is an UNREADABLE cloud document, not a failed read. The real
  // loadFromFirestore never rejects -- it catches everything and returns
  // undefined (external.ts:49-66), and `undefined` means "no document yet",
  // which is a success path. A mock that rejects would be testing a contract
  // the real function does not have.
  it('reports error when the cloud document cannot be understood', async () => {
    const store = await runSync(agreeing(), { not: 'a container' });

    expect(store.getState().globalState.syncStatus).toBe('error');
  });
});
