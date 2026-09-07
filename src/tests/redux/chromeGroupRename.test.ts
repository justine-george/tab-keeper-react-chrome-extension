import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inlined rather than imported: a vi.hoisted block runs before the module
// graph is evaluated, and common.ts reads window.screen at module load.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

// Importing the slice reaches globalStateSlice -> external -> config/firebase,
// which calls getAuth() at module load and throws without a Firebase config.
vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(async () => undefined),
  saveToFirestore: vi.fn(async () => undefined),
  displayToast: vi.fn(),
}));

import reducer, {
  saveToTabContainerInternal,
  updateChromeTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// Renaming a Chrome tab group inside a saved window.
//
// The rule here deliberately DIFFERS from updateTabGroupTitle and
// updateWindowGroupTitle, which refuse a blank title outright (KAN-84). A
// session and a window must always carry a name, because a nameless row is
// identifiable only by its counts and date. A Chrome group has no such
// problem: Chrome itself allows an unnamed group, this pane already renders
// one as the bare colour band, and the pane shows a placeholder in its place.
// Refusing a blank here would make "named" a one-way door and let the
// extension hold a state Chrome cannot express back.
//
// Asserted on the REDUCER because that is the choke point: it is the only
// place a group title is written by user action, and no sync, merge or import
// path reaches it.

function group(id: string, groupTitle: string): tabContainerData {
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
        title: 'original window',
        tabs: [
          {
            tabId: `t-${id}`,
            favicon: '',
            title: 't',
            url: 'https://a.co',
            chromeGroupId: `g-${id}`,
          },
        ],
        chromeTabGroups: [
          { groupId: `g-${id}`, title: groupTitle, color: 'blue' },
        ],
      },
    ],
  };
}

const base = (): TabMasterContainer => ({
  lastModified: 1,
  selectedTabGroupId: null,
  tabGroups: [],
});

const groupTitleOf = (s: TabMasterContainer, id: string) =>
  s.tabGroups.find((g) => g.tabGroupId === id)!.windows[0].chromeTabGroups![0]
    .title;

const seed = (groupTitle: string) =>
  reducer(base(), saveToTabContainerInternal(group('a', groupTitle)));

const rename = (state: TabMasterContainer, editableTitle: string) =>
  reducer(
    state,
    updateChromeTabGroupTitle({
      tabGroupId: 'a',
      windowId: 'w-a',
      groupId: 'g-a',
      editableTitle,
    })
  );

describe('renaming a Chrome tab group', () => {
  beforeEach(() => localStorage.clear());

  it('renames a group that already had a name', () => {
    expect(groupTitleOf(rename(seed('Research'), 'Reading'), 'a')).toBe(
      'Reading'
    );
  });

  it('names a group that had none', () => {
    expect(groupTitleOf(rename(seed(''), 'Research'), 'a')).toBe('Research');
  });

  it('trims surrounding whitespace, as the other renames do', () => {
    expect(groupTitleOf(rename(seed(''), '  Research  '), 'a')).toBe(
      'Research'
    );
  });

  // The point of divergence from KAN-84, asserted directly so that reusing
  // isBlankTitle here would fail rather than quietly make naming one-way.
  it.each([[''], ['   '], ['\t\n'], ['　']])(
    'clears the name when given %j, unlike a session rename',
    (blank) => {
      expect(groupTitleOf(rename(seed('Research'), blank), 'a')).toBe('');
    }
  );

  it('leaves an unknown groupId alone', () => {
    const before = seed('Research');
    const after = reducer(
      before,
      updateChromeTabGroupTitle({
        tabGroupId: 'a',
        windowId: 'w-a',
        groupId: 'no-such-group',
        editableTitle: 'Reading',
      })
    );
    expect(groupTitleOf(after, 'a')).toBe('Research');
  });

  it('leaves an unknown windowId alone', () => {
    const before = seed('Research');
    const after = reducer(
      before,
      updateChromeTabGroupTitle({
        tabGroupId: 'a',
        windowId: 'no-such-window',
        groupId: 'g-a',
        editableTitle: 'Reading',
      })
    );
    expect(groupTitleOf(after, 'a')).toBe('Research');
  });
});

describe('renaming a Chrome tab group and the dirty flag', () => {
  // Real time is useless here: seed and rename land in the same millisecond,
  // so Date.now() returns the same value whether or not the reducer touched
  // lastModified, and every assertion below would pass against broken code.
  // The clock is advanced explicitly between the two so that "unchanged"
  // means the reducer declined to write, not that the clock did not move.
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  const laterOn = () => vi.setSystemTime(2_000_000);

  const sessionModified = (s: TabMasterContainer) =>
    s.tabGroups.find((g) => g.tabGroupId === 'a')!.lastModified;

  // Same reasoning as updateTabGroupTitle's early return: bumping
  // lastModified marks the container dirty and pushes a write to Firestore.
  // An edit that changed nothing must not pay for one.
  it('does not touch lastModified when the title is unchanged', () => {
    const before = seed('Research');
    laterOn();
    const after = rename(before, 'Research');
    expect(sessionModified(after)).toBe(sessionModified(before));
    expect(after.lastModified).toBe(before.lastModified);
  });

  it('does not touch lastModified when a blank re-clears an unnamed group', () => {
    const before = seed('');
    laterOn();
    const after = rename(before, '   ');
    expect(sessionModified(after)).toBe(sessionModified(before));
    expect(after.lastModified).toBe(before.lastModified);
  });

  // THE CONTROL. Both assertions above are "nothing happened", which a reducer
  // that ignored every rename would satisfy. This proves the same setup can
  // actually mark a change.
  it('CONTROL: a real rename does bump lastModified', () => {
    const before = seed('Research');
    laterOn();
    const after = rename(before, 'Reading');
    expect(sessionModified(after)).toBeGreaterThan(sessionModified(before)!);
    expect(after.lastModified).toBeGreaterThan(before.lastModified);
  });
});
