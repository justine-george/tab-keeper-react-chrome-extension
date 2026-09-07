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
  updateChromeTabGroupColor,
  updateChromeTabGroupTitle,
  ungroupChromeTabGroup,
  restoreContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo } from '../../redux/slices/undoRedoSlice';
import { makeTestStore } from '../setup/makeStore';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-125, the Chrome-tab-group half of the defect
// undoContentSurvivesSync.test.ts covers for session and window titles.
//
// reconcileAssertedContainer only stamps a restored session it can SEE has
// changed, and it decides that with sameSessionContent. That comparator walked
// windows and tabs and never looked at chromeTabGroups or at a tab's
// chromeGroupId -- so a session whose only change was a group recolour,
// rename or ungroup compared EQUAL, was handed back carrying its snapshot
// timestamp, and lost the next merge to the cloud copy that still held the
// edit. Reported from real use: "change color, syncs, undo -- it undoes for a
// bit then changes back and shows synced from another device."
//
// Delete-group and add-tab-to-group were never affected, but only by luck:
// both change tabs.length, which the comparator did look at.

function seed(overrides: Partial<tabContainerData> = {}): tabContainerData {
  return {
    tabGroupId: 's1',
    title: 'Alpha',
    createdTime: '2026-08-31 00:00:00',
    createdAt: Date.UTC(2026, 7, 31, 0, 0, 0),
    windowCount: 1,
    tabCount: 2,
    isAutoSave: false,
    isSelected: false,
    windows: [
      {
        windowId: 'w1',
        windowHeight: 100,
        windowWidth: 100,
        windowOffsetTop: 0,
        windowOffsetLeft: 0,
        tabCount: 2,
        title: 'window',
        tabs: [
          {
            tabId: 't1',
            favicon: '',
            title: 'Kagi',
            url: 'https://kagi.com/',
            chromeGroupId: 'grp',
          },
          {
            tabId: 't2',
            favicon: '',
            title: 'Loose',
            url: 'https://example.com/',
          },
        ],
        chromeTabGroups: [{ groupId: 'grp', title: 'Reading', color: 'blue' }],
      },
    ],
    ...overrides,
  };
}

type Store = ReturnType<typeof makeTestStore>['store'];
const win = (s: { tabGroups: tabContainerData[] }) => s.tabGroups[0].windows[0];

// Edit, let the cloud receive that edit exactly as auto-sync would have pushed
// it, undo, then sync. The undo is asserted separately from the merge, because
// the two failure modes look identical from the UI and are not the same bug.
async function editUndoSync(mutate: (store: Store) => void) {
  const { store } = makeTestStore();
  store.dispatch(setSignedIn());
  store.dispatch(setUserId('u1'));
  store.dispatch(saveToTabContainerInternal(seed()));

  mutate(store);
  const cloud = JSON.parse(
    JSON.stringify(store.getState().tabContainerDataState)
  );

  store.dispatch(undo());
  const afterUndo = store.getState().tabContainerDataState;

  mocks.loadFromFirestore.mockResolvedValue(cloud);
  localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
  await store.dispatch(syncStateWithFirestore() as never);

  return { afterUndo, merged: store.getState().tabContainerDataState };
}

describe('undoing a Chrome tab group edit survives the next sync (KAN-125)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  it('keeps a group colour the user undid', async () => {
    const { afterUndo, merged } = await editUndoSync((store) =>
      store.dispatch(
        updateChromeTabGroupColor({
          tabGroupId: 's1',
          windowId: 'w1',
          groupId: 'grp',
          color: 'purple',
        })
      )
    );

    // The undo itself works -- this is not where the defect was.
    expect(win(afterUndo).chromeTabGroups![0].color).toBe('blue');
    expect(win(merged).chromeTabGroups![0].color).toBe('blue');
  });

  it('keeps a group title the user undid', async () => {
    const { afterUndo, merged } = await editUndoSync((store) =>
      store.dispatch(
        updateChromeTabGroupTitle({
          tabGroupId: 's1',
          windowId: 'w1',
          groupId: 'grp',
          editableTitle: 'RENAMED',
        })
      )
    );

    expect(win(afterUndo).chromeTabGroups![0].title).toBe('Reading');
    expect(win(merged).chromeTabGroups![0].title).toBe('Reading');
  });

  it('keeps a grouping the user undid ungrouping', async () => {
    const { afterUndo, merged } = await editUndoSync((store) =>
      store.dispatch(
        ungroupChromeTabGroup({
          tabGroupId: 's1',
          windowId: 'w1',
          groupId: 'grp',
        })
      )
    );

    expect(win(afterUndo).chromeTabGroups).toHaveLength(1);
    expect(win(merged).chromeTabGroups).toHaveLength(1);
    // The group entry coming back is not enough: without its members pointing
    // at it, the group renders empty and applyTabGroups forms nothing.
    expect(win(merged).tabs[0].chromeGroupId).toBe('grp');
  });

  // THE CONTROL, and the one that decides whether the fix is scoped correctly.
  // Comparing MORE fields makes it easier to conclude "this session changed",
  // and a comparator that over-reports turns an undo into an assertion over
  // the whole container -- overwriting edits another device made to sessions
  // the user never touched here. The same trap the KAN-55 control was built
  // for, one field deeper.
  //
  // Time is pinned so the ordering is a property of the fix, not of how fast
  // the test happens to run.
  it('does not clobber an unrelated session edited elsewhere', async () => {
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
      store.dispatch(
        updateChromeTabGroupColor({
          tabGroupId: 's1',
          windowId: 'w1',
          groupId: 'grp',
          color: 'purple',
        })
      );

      // The laptop recoloured s2's group half a second after the save --
      // newer than this device's copy of s2, so the merge should keep it, but
      // comfortably in the past by the time the undo below runs.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const s2 = cloud.tabGroups.find((g) => g.tabGroupId === 's2')!;
      s2.windows[0].chromeTabGroups![0].color = 'green';
      s2.lastModified = T0 + 500;

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(undo());
      const afterUndo = store.getState().tabContainerDataState;

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
      await store.dispatch(syncStateWithFirestore() as never);

      const merged = store.getState().tabContainerDataState.tabGroups;
      const colourOf = (id: string) =>
        merged.find((g) => g.tabGroupId === id)!.windows[0].chromeTabGroups![0]
          .color;

      // The undo this device performed survives.
      expect(colourOf('s1')).toBe('blue');
      // And so does the recolour the other device made. A comparator that
      // reported every session as changed would stamp s2 at T0+2000,
      // outranking the laptop's T0+500, and this device's stale blue would
      // win.
      expect(colourOf('s2')).toBe('green');
    } finally {
      vi.useRealTimers();
    }
  });

  // A group entry with no members is a real state -- deleting a group's tabs
  // one at a time leaves the entry behind (noted in KAN-110) -- and it is the
  // only shape where the group LIST differs while every tab and every
  // chromeGroupId is identical. Without the length check the comparator walks
  // the longer list and reads right[i].groupId off undefined, so this is a
  // crash guard as much as a correctness one.
  it('sees a group entry that has lost all its members', async () => {
    const withOrphan = seed();
    withOrphan.windows[0].chromeTabGroups!.push({
      groupId: 'orphan',
      title: 'Empty',
      color: 'red',
    });

    const { store } = makeTestStore();
    store.dispatch(setSignedIn());
    store.dispatch(setUserId('u1'));
    store.dispatch(saveToTabContainerInternal(withOrphan));

    // Ungrouping the orphan changes nothing but the list's length: it has no
    // members whose chromeGroupId could change.
    store.dispatch(
      ungroupChromeTabGroup({
        tabGroupId: 's1',
        windowId: 'w1',
        groupId: 'orphan',
      })
    );
    const cloud = JSON.parse(
      JSON.stringify(store.getState().tabContainerDataState)
    );
    expect(win(cloud).chromeTabGroups).toHaveLength(1);

    store.dispatch(undo());
    const afterUndo = store.getState().tabContainerDataState;
    expect(win(afterUndo).chromeTabGroups).toHaveLength(2);

    mocks.loadFromFirestore.mockResolvedValue(cloud);
    localStorage.setItem('tabContainerData', JSON.stringify(afterUndo));
    await store.dispatch(syncStateWithFirestore() as never);

    expect(
      win(store.getState().tabContainerDataState).chromeTabGroups
    ).toHaveLength(2);
  });
});

// The import path reaches the same comparator through restoreContainer, and it
// is the only one where the two sides can spell "no groups" differently: a
// backup file is JSON someone else's version of the app wrote, so it may carry
// `chromeTabGroups: []` where the live session, saved before KAN-11 or without
// the tabGroups permission, carries no key at all. Reading that as a
// difference would make an import assert sessions it is not changing, and
// overwrite whatever another device did to them.
describe('an absent group list and an empty one are the same (KAN-125)', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadFromFirestore.mockReset();
    mocks.saveToFirestore.mockReset().mockResolvedValue(undefined);
  });

  // The one difference the group LIST cannot show: a tab moving between two
  // groups that both still exist. No reducer does that today, which is exactly
  // why it needs a test -- the comparator has to be right about the join key
  // before some future move-to-group action depends on it. Reachable now
  // through import: a backup taken while the tab sat in the other group.
  it('sees a tab that changed which group it belongs to', async () => {
    const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);

      const twoGroups = seed();
      twoGroups.windows[0].chromeTabGroups!.push({
        groupId: 'grp2',
        title: 'Later',
        color: 'green',
      });
      twoGroups.windows[0].tabs[1].chromeGroupId = 'grp2';

      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));
      store.dispatch(saveToTabContainerInternal(twoGroups));

      // The cloud holds the live arrangement, stamped after the save.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      cloud.tabGroups[0].lastModified = T0 + 500;

      // The backup moves t2 from grp2 back to grp. Both groups still exist and
      // both are unchanged, so the group list is byte-identical -- the ONLY
      // difference is the tab's join key.
      const backup: TabMasterContainer = JSON.parse(JSON.stringify(cloud));
      backup.tabGroups[0].lastModified = T0;
      backup.lastModified = T0;
      backup.tabGroups[0].windows[0].tabs[1].chromeGroupId = 'grp';

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(restoreContainer(backup));

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      // The import IS a change to this session, so it must be stamped and must
      // outrank the cloud copy it is replacing.
      expect(
        win(store.getState().tabContainerDataState).tabs[1].chromeGroupId
      ).toBe('grp');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not stamp a session whose group list is merely spelled differently', async () => {
    const T0 = Date.UTC(2026, 8, 7, 12, 0, 0);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);

      const { store } = makeTestStore();
      store.dispatch(setSignedIn());
      store.dispatch(setUserId('u1'));

      // Live: no chromeTabGroups key at all.
      const bare = seed();
      delete bare.windows[0].chromeTabGroups;
      bare.windows[0].tabs.forEach((tab) => delete tab.chromeGroupId);
      store.dispatch(saveToTabContainerInternal(bare));

      // The laptop edited this same session a moment later. Nothing this
      // device does below is a change to it, so the laptop's copy must win.
      const cloud: TabMasterContainer = JSON.parse(
        JSON.stringify(store.getState().tabContainerDataState)
      );
      const s1 = cloud.tabGroups.find((g) => g.tabGroupId === 's1')!;
      s1.title = 'EDITED ON LAPTOP';
      s1.lastModified = T0 + 500;

      // The backup spells the empty group list as [].
      const backup: TabMasterContainer = JSON.parse(JSON.stringify(bare));
      const imported: TabMasterContainer = {
        lastModified: T0,
        selectedTabGroupId: null,
        tabGroups: [
          {
            ...(backup as unknown as tabContainerData),
            lastModified: T0,
            windows: [
              {
                ...(backup as unknown as tabContainerData).windows[0],
                chromeTabGroups: [],
              },
            ],
          },
        ],
      };

      vi.setSystemTime(T0 + 2_000);
      store.dispatch(restoreContainer(imported));

      mocks.loadFromFirestore.mockResolvedValue(cloud);
      localStorage.setItem(
        'tabContainerData',
        JSON.stringify(store.getState().tabContainerDataState)
      );
      await store.dispatch(syncStateWithFirestore() as never);

      // [] vs absent is not a change, so the import stamped nothing and the
      // laptop's newer copy stands. A comparator that saw a difference would
      // stamp s1 at T0+2000 and silently discard the laptop's rename.
      expect(
        store
          .getState()
          .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === 's1')!
          .title
      ).toBe('EDITED ON LAPTOP');
    } finally {
      vi.useRealTimers();
    }
  });
});
