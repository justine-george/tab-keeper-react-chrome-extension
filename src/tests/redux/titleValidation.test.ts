import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  updateTabGroupTitle,
  updateWindowGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import type {
  tabContainerData,
  TabMasterContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { isBlankTitle, normalizeTitle } from '../../utils/functions/local';

// KAN-84. Nothing validated a title, so a session could be renamed to "" or
// "   " and end up with no name in either pane and no accessible name on its
// row -- identifiable only by its counts and date.
//
// One rule: never leave a session without a name, and never discard a name it
// already had. Renaming has a prior title, so a blank one is refused.
//
// These assert on the REDUCER rather than through a component, because the
// reducer is the choke point the fix deliberately chose: updateTabGroupTitle
// has exactly one production dispatcher and no sync, merge or import path
// reaches it, so a guard here cannot be bypassed by a future caller.

function group(id: string, title = id): tabContainerData {
  return {
    tabGroupId: id,
    title,
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
          { tabId: `t-${id}`, favicon: '', title: 't', url: 'https://a.co' },
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

const byId = (s: TabMasterContainer, id: string) =>
  s.tabGroups.find((g) => g.tabGroupId === id)!;

describe('normalizeTitle / isBlankTitle', () => {
  // trim() strips the full Unicode WhiteSpace set, not just ASCII, and the
  // cases below are the ones that actually reach this app.
  //
  // U+3000 IDEOGRAPHIC SPACE is the one that matters in practice: it is the
  // ordinary space character in Japanese input, so a ja user typing nothing
  // but spaces produces a title of U+3000, not U+0020. An ASCII-only check
  // (a hand-rolled [ \t\n] list) would let that through and leave exactly the
  // nameless session this ticket is about, for the users least likely to
  // report it in English.
  it.each([
    ['', true],
    ['   ', true],
    ['\t\n ', true],
    ['\u00a0', true], // NBSP
    ['\u3000', true], // IDEOGRAPHIC SPACE
    ['\u3000\u3000', true],
    ['a', false],
    ['  a  ', false],
    ['\u3000a\u3000', false],
  ])('isBlankTitle(%j) === %s', (input, expected) => {
    expect(isBlankTitle(input)).toBe(expected);
  });

  // A known and deliberate limit. U+200B ZERO WIDTH SPACE is a format
  // character rather than whitespace, so trim() leaves it and a title made
  // only of it is stored and renders as nothing. Not guarded: reaching it
  // takes a deliberate paste, and the alternative is maintaining a list of
  // invisible codepoints that would go stale. Pinned so the behaviour is a
  // decision on record rather than a surprise.
  it('does NOT treat a zero-width space as blank', () => {
    expect(isBlankTitle('\u200b')).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTitle('  Research  ')).toBe('Research');
    expect(normalizeTitle('Research')).toBe('Research');
    expect(normalizeTitle('\u3000\u3000Research\u3000')).toBe('Research');
  });
});

describe('a session title cannot be blanked (KAN-84)', () => {
  beforeEach(() => localStorage.clear());

  it.each([[''], ['   '], ['\t\n']])(
    'refuses %j and keeps the existing name',
    (blank) => {
      const before = reducer(base(), saveToTabContainerInternal(group('a')));
      const after = reducer(
        before,
        updateTabGroupTitle({ tabGroupId: 'a', editableTitle: blank })
      );
      expect(byId(after, 'a').title).toBe('a');
    }
  );

  // THE CONTROL. Every assertion above is "nothing happened", which a reducer
  // that ignored all renames would satisfy. This proves the same setup can
  // actually rename.
  it('CONTROL: a real rename still lands', () => {
    const before = reducer(base(), saveToTabContainerInternal(group('a')));
    const after = reducer(
      before,
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'Research' })
    );
    expect(byId(after, 'a').title).toBe('Research');
  });

  it('stores the trimmed name, so " Research " is not stored with its padding', () => {
    const before = reducer(base(), saveToTabContainerInternal(group('a')));
    const after = reducer(
      before,
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: '  Research  ' })
    );
    expect(byId(after, 'a').title).toBe('Research');
  });

  // A refused rename must not look like an edit to the sync layer. Bumping
  // lastModified would mark the container dirty and push a no-op write to
  // Firestore for something the user did not change.
  //
  // Date.now is pinned to a DIFFERENT value for the rename than for the save.
  // Without that this passes vacuously: both run inside the same millisecond,
  // so an unguarded reducer writes back the identical timestamp and "unchanged"
  // holds even though the guard is gone. Caught by the mutation run, which
  // killed the other four cases here and left this one green.
  it('does not restamp the container for a refused rename', () => {
    const before = reducer(base(), saveToTabContainerInternal(group('a')));
    const stampBefore = before.lastModified;
    const sessionStampBefore = byId(before, 'a').lastModified;

    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    const after = reducer(
      before,
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: '   ' })
    );
    vi.restoreAllMocks();

    expect(stampBefore).not.toBe(9_999_999);
    expect(after.lastModified).toBe(stampBefore);
    expect(byId(after, 'a').lastModified).toBe(sessionStampBefore);
  });

  // The counterpart control: an ACCEPTED rename must restamp, or the guard
  // above could be implemented by never stamping at all.
  it('CONTROL: an accepted rename does restamp', () => {
    const before = reducer(base(), saveToTabContainerInternal(group('a')));

    vi.spyOn(Date, 'now').mockReturnValue(9_999_999);
    const after = reducer(
      before,
      updateTabGroupTitle({ tabGroupId: 'a', editableTitle: 'Research' })
    );
    vi.restoreAllMocks();

    expect(after.lastModified).toBe(9_999_999);
    expect(byId(after, 'a').lastModified).toBe(9_999_999);
  });
});

describe('a window group title cannot be blanked (KAN-84)', () => {
  beforeEach(() => localStorage.clear());

  const windowTitle = (s: TabMasterContainer) => byId(s, 'a').windows[0].title;

  it.each([[''], ['   ']])(
    'refuses %j and keeps the existing name',
    (blank) => {
      const before = reducer(base(), saveToTabContainerInternal(group('a')));
      const after = reducer(
        before,
        updateWindowGroupTitle({
          tabGroupId: 'a',
          windowId: 'w-a',
          editableTitle: blank,
        })
      );
      expect(windowTitle(after)).toBe('original window');
    }
  );

  it('CONTROL: a real window rename still lands, trimmed', () => {
    const before = reducer(base(), saveToTabContainerInternal(group('a')));
    const after = reducer(
      before,
      updateWindowGroupTitle({
        tabGroupId: 'a',
        windowId: 'w-a',
        editableTitle: '  Morning reading  ',
      })
    );
    expect(windowTitle(after)).toBe('Morning reading');
  });
});
