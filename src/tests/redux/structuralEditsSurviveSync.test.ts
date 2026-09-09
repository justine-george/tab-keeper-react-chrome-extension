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
import {
  saveToTabContainerInternal,
  addCurrWindowToTabGroupInternal,
  addCurrTabToWindowInternal,
  addCurrTabToChromeGroupInternal,
  deleteChromeTabGroupInternal,
  deleteWindowInternal,
  deleteTabInternal,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-139. The six STRUCTURAL edits -- add or remove a window or tab -- must
// stay visible to `sameSessionContent` on their own merits.
//
// WHY THIS FILE EXISTS. Those six reducers call `stampCreated`, which rewrites
// `createdAt` and `createdTime` to now. That means they are currently visible
// to the comparator TWICE OVER: once through the structure they changed, and
// once through the timestamps. KAN-139 removes the second, on the grounds that
// re-stamping a *creation* date on a delete is a lie. The question this file
// answers is whether the first was ever load-bearing, or whether `createdAt`
// has been quietly carrying all six.
//
// The stakes are the usual ones for this comparator. reconcileAssertedContainer
// only stamps a restored session it can SEE has changed; a session it thinks is
// unchanged is handed back with its snapshot timestamp and loses the next merge
// to the cloud copy that still holds the edit. The undo applies, then sync
// silently puts the edit back. That is KAN-80, KAN-83 and KAN-125, three times.
//
// So each test below undoes one structural edit and syncs against a cloud that
// still holds it. Passing means the comparator saw the change.
//
// Written and run against main BEFORE the stampCreated calls were removed, so
// that a pass after their removal is a statement about the removal rather than
// about a test authored to suit it.

const tab = (id: string, chromeGroupId?: string) => ({
  tabId: id,
  favicon: '',
  title: `tab ${id}`,
  url: `https://${id}.test`,
  ...(chromeGroupId ? { chromeGroupId } : {}),
});

const win = (id: string, tabs: ReturnType<typeof tab>[]) => ({
  windowId: id,
  windowHeight: 100,
  windowWidth: 100,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: tabs.length,
  title: `window ${id}`,
  tabs,
});

// Two windows, four tabs, one Chrome group -- enough that every one of the six
// reducers has something real to act on, and enough that deleting any single
// thing never empties the session (an emptied session is removed outright by
// the cascade, which would pass these assertions for the wrong reason).
function seed(overrides: Partial<tabContainerData> = {}): tabContainerData {
  return {
    tabGroupId: 's1',
    title: 'Alpha',
    createdTime: '2026-09-07 00:00:00',
    createdAt: Date.UTC(2026, 8, 7, 0, 0, 0),
    windowCount: 2,
    tabCount: 4,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        ...win('w1', [tab('t1', 'grp'), tab('t2', 'grp'), tab('t3')]),
        chromeTabGroups: [{ groupId: 'grp', title: 'Research', color: 'blue' }],
      },
      win('w2', [tab('t4')]),
    ],
    ...overrides,
  };
}

const shapeOf = (state: { tabGroups: tabContainerData[] }, id = 's1') => {
  const g = state.tabGroups.find((x) => x.tabGroupId === id);
  if (!g) return 'SESSION GONE';
  return g.windows
    .map(
      (w) =>
        `${w.windowId}[${w.tabs.map((t) => t.tabId).join(',')}]` +
        `{${(w.chromeTabGroups ?? []).map((c) => c.groupId).join(',')}}`
    )
    .join(' ');
};

type Store = ReturnType<typeof makeTestStore>['store'];

// Each entry: apply one structural edit to the seeded session.
const STRUCTURAL_EDITS: [string, (s: Store) => void][] = [
  [
    'addCurrWindowToTabGroupInternal',
    (s) =>
      s.dispatch(
        addCurrWindowToTabGroupInternal({
          tabGroupId: 's1',
          window: win('w3', [tab('t9')]),
        })
      ),
  ],
  [
    'addCurrTabToWindowInternal',
    (s) =>
      s.dispatch(
        addCurrTabToWindowInternal({
          tabGroupId: 's1',
          windowId: 'w2',
          tabData: tab('t9'),
        })
      ),
  ],
  [
    'addCurrTabToChromeGroupInternal',
    (s) =>
      s.dispatch(
        addCurrTabToChromeGroupInternal({
          tabGroupId: 's1',
          windowId: 'w1',
          groupId: 'grp',
          tabData: tab('t9', 'grp'),
        })
      ),
  ],
  [
    'deleteChromeTabGroupInternal',
    (s) =>
      s.dispatch(
        deleteChromeTabGroupInternal({
          tabGroupId: 's1',
          windowId: 'w1',
          groupId: 'grp',
        })
      ),
  ],
  [
    'deleteWindowInternal',
    (s) =>
      s.dispatch(deleteWindowInternal({ tabGroupId: 's1', windowId: 'w2' })),
  ],
  [
    'deleteTabInternal',
    (s) =>
      s.dispatch(
        deleteTabInternal({ tabGroupId: 's1', windowId: 'w1', tabId: 't3' })
      ),
  ],
];

describe('undoing a structural edit survives the next sync (KAN-139)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it.each(STRUCTURAL_EDITS)('%s', async (_name, edit) => {
    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(saveToTabContainerInternal(seed()));

    const before = shapeOf(store.getState().tabContainerDataState);

    edit(store);
    const after = shapeOf(store.getState().tabContainerDataState);
    // The edit did something. Without this an inert dispatch would sail
    // through every assertion below, since undoing nothing trivially survives.
    expect(after).not.toBe(before);

    // The cloud received the edit exactly as auto-sync would have pushed it.
    const cloud = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );

    store.dispatch(undo());
    expect(shapeOf(store.getState().tabContainerDataState)).toBe(before);

    const afterUndo = store.getState().tabContainerDataState;
    mocks.loadFromFirestore.mockResolvedValue(cloud);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    // The assertion that depends on the comparator. If it could not see this
    // edit, the merge hands back the cloud's copy and this reads `after`.
    expect(shapeOf(store.getState().tabContainerDataState)).toBe(before);
  });

  it('covers every reducer that re-stamps createdAt', () => {
    expect(STRUCTURAL_EDITS).toHaveLength(6);
  });
});

// THE CONTROL. Reporting MORE sessions as changed makes every assertion above
// easier to pass, and turns an undo into an assertion over the whole container
// -- overwriting edits another device made to sessions the user never touched
// here. A comparator "fixed" by returning false unconditionally would pass all
// six tests above and fail this one.
describe('and does not clobber an unrelated session edited elsewhere', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it.each(STRUCTURAL_EDITS)('%s leaves s2 alone', async (_name, edit) => {
    const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);

      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));
      store.dispatch(saveToTabContainerInternal(seed()));
      store.dispatch(
        saveToTabContainerInternal(seed({ tabGroupId: 's2', title: 'Bravo' }))
      );

      vi.setSystemTime(T0 + 1_000);
      edit(store);

      // The laptop renamed s2 half a second after the save -- newer than this
      // device's copy, so the merge should keep it.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const s2 = cloud.tabGroups.find((g) => g.tabGroupId === 's2')!;
      s2.title = 'EDITED ON LAPTOP';
      s2.lastModified = T0 + 500;

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      expect(
        store
          .getState()
          .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 's2')!
          .title
      ).toBe('EDITED ON LAPTOP');
    } finally {
      vi.useRealTimers();
    }
  });
});
