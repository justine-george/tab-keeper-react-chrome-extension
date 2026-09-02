import { describe, expect, test, vi } from 'vitest';

// common.ts reads window.screen at module load, and this is a node test.
vi.hoisted(() => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = g.window ?? globalThis;
  (g.window as { screen?: unknown }).screen = { height: 1080, width: 1920 };
});

vi.mock('../../utils/functions/external', () => ({
  loadFromFirestore: vi.fn(),
  saveToFirestore: vi.fn(),
  displayToast: vi.fn(),
}));

import { makeTestStore } from '../setup/makeStore';
import {
  saveToTabContainerInternal,
  selectTabContainer,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';
import { undo, redo } from '../../redux/slices/undoRedoSlice';

// KAN-57. Selecting a session used to go through `set`, the same reducer a
// content edit uses -- which pushes onto `past` and CLEARS `future`.
//
// Clearing redo is correct for a genuine edit: the old redo branch is
// incompatible with the state the user just moved to. Selection creates no such
// branch, so it inherited a consequence never meant for it. The measured
// result was that renaming, undoing, then clicking any other session made the
// rename permanently unrecoverable.
//
// Selection now updates `present` only, so history stays in sync with what is
// on screen without selection becoming an undoable step of its own.

const buildGroup = (n: number, title: string) => ({
  tabGroupId: `group-${n}`,
  title,
  createdTime: `2026-09-01 09:0${n}:00`,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `win-${n}`,
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: `Window ${n}`,
      tabs: [
        {
          tabId: `w${n}-t0`,
          favicon: '',
          title: `Page ${n}`,
          url: `https://example.com/${n}`,
        },
      ],
    },
  ],
});

// saveToTabContainerInternal unshifts and selects what it just saved, so
// group-2 is the selected one on entry and group-1 is the one to click to.
const seeded = () => {
  const { store, seen } = makeTestStore();
  store.dispatch(saveToTabContainerInternal(buildGroup(1, 'Alpha')));
  store.dispatch(saveToTabContainerInternal(buildGroup(2, 'Bravo')));
  seen.length = 0;
  return { store, seen };
};

const titleOf = (
  store: ReturnType<typeof makeTestStore>['store'],
  id: string
) =>
  store
    .getState()
    .tabContainerDataState.tabGroups.find((g) => g.tabGroupId === id)?.title;

const redoAvailable = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().undoRedo.future.length > 0;

const pastDepth = (store: ReturnType<typeof makeTestStore>['store']) =>
  store.getState().undoRedo.past.length;

describe('selection is not an undoable step (KAN-57)', () => {
  // The control, and the reason this whole file cannot just assert "never
  // clear future". Clearing redo after a real edit is correct undo semantics
  // and must survive the fix; without this test, deleting the `state.future =
  // []` line outright would pass everything else here.
  test('a content edit still clears the redo stack', () => {
    const { store } = seeded();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'RENAMED' })
    );
    store.dispatch(undo());
    expect(redoAvailable(store)).toBe(true);

    // A second, genuinely new edit. This is the case redo-clearing exists for.
    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'OTHER' })
    );

    expect(redoAvailable(store)).toBe(false);
  });

  // The headline defect. Measured before the fix: redoAvailable went true ->
  // false on the click, and the rename could never be recovered.
  test('selecting a session preserves the redo stack', () => {
    const { store } = seeded();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'RENAMED' })
    );
    store.dispatch(undo());
    expect(redoAvailable(store)).toBe(true);
    expect(titleOf(store, 'group-2')).toBe('Bravo');

    store.dispatch(selectTabContainer('group-1'));

    expect(redoAvailable(store)).toBe(true);
  });

  // The recovery has to actually work, not merely be advertised by a
  // non-empty stack.
  test('the redo still recovers the edit after a selection', () => {
    const { store } = seeded();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'RENAMED' })
    );
    store.dispatch(undo());
    store.dispatch(selectTabContainer('group-1'));
    store.dispatch(redo());

    expect(titleOf(store, 'group-2')).toBe('RENAMED');
  });

  // Documented consequence, not an accident. `UndoableStates` is just
  // `{ tabContainerDataState }`, and that slice holds the content AND the
  // selection, so a snapshot cannot carry one without the other: redo restores
  // the selection that was live when the edit happened.
  //
  // Measured: click group-1, redo, and the selection returns to group-2.
  // Left as-is rather than preserving the current selection through a redo,
  // because landing on the session whose edit was just restored is the more
  // defensible behaviour -- the user sees what changed. Pinned here so that a
  // future change to it has to be deliberate.
  test('redo restores the selection that was live when the edit was made', () => {
    const { store } = seeded();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'RENAMED' })
    );
    store.dispatch(undo());
    store.dispatch(selectTabContainer('group-1'));
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'group-1'
    );

    store.dispatch(redo());

    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe(
      'group-2'
    );
  });

  // The control for the pair below.
  test('a content edit still grows the undo stack', () => {
    const { store } = seeded();
    const before = pastDepth(store);

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'RENAMED' })
    );

    expect(pastDepth(store)).toBe(before + 1);
  });

  test('selecting a session does not grow the undo stack', () => {
    const { store } = seeded();
    const before = pastDepth(store);

    store.dispatch(selectTabContainer('group-1'));

    expect(pastDepth(store)).toBe(before);
  });

  // Undo must skip past the selection to the last real edit, rather than
  // spending itself undoing a click.
  test('undo after a selection undoes the content edit, not the selection', () => {
    const { store } = seeded();

    store.dispatch(
      updateTabGroupTitle({ tabGroupId: 'group-2', editableTitle: 'RENAMED' })
    );
    store.dispatch(selectTabContainer('group-1'));
    store.dispatch(undo());

    expect(titleOf(store, 'group-2')).toBe('Bravo');
  });

  // Carried over from the KAN-35 suite, where it guarded against dropping
  // SELECT_TAB_CONTAINER_ACTION out of `actionsToCapture` entirely. That
  // remains the hazard: history must keep tracking what is on screen, or the
  // next undo restores a stale selection. Only the mechanism changed --
  // `present` is now updated without touching either stack.
  test('undo history still tracks the current selection', () => {
    const { store } = seeded();

    store.dispatch(selectTabContainer('group-1'));

    expect(
      store.getState().undoRedo.present.tabContainerDataState.selectedTabGroupId
    ).toBe('group-1');
  });
});
