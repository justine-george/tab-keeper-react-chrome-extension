import { describe, expect, test, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  setHasTabGroupsPermission,
  setSearchInputText,
} from '../../redux/slices/globalStateSlice';
import {
  deleteTabContainerInternal,
  restoreContainer,
  saveToTabContainerInternal,
  selectTabContainer,
  updateTabGroupTitle,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-143. Editing a session moves it to the top of the left pane (KAN-141),
// but the edit is made in the RIGHT pane -- a rename, adding a tab -- so the
// user is not watching the left pane when it happens. Scrolled down, the row
// they just edited leaves the viewport with nothing to say where it went.
//
// WHAT THESE TESTS CAN AND CANNOT PROVE. jsdom implements no layout and no
// scrolling (see the stub in componentSetup.ts), so the only observable here is
// WHICH row was asked to scroll and WHEN. That "the row ends up visible", that
// `block: 'nearest'` moves the minimum, and that it no-ops for an
// already-visible row are real-browser claims and are checked there instead.
// What is worth pinning in jsdom is the decision: the effect must fire when the
// list rearranges under the selection, and must NOT fire when it did not.

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

const session = (id: string, title: string, createdAt: number) => ({
  tabGroupId: id,
  title,
  createdTime: '2026-09-09 12:00:00',
  createdAt,
  windowCount: 1,
  tabCount: 1,
  isAutoSave: false,
  isSelected: false,
  windows: [
    {
      windowId: `${id}-w`,
      windowHeight: 100,
      windowWidth: 100,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 1,
      title: 'Window',
      tabs: [
        {
          tabId: `${id}-t`,
          favicon: '',
          title: `${title} tab`,
          url: 'https://a.co',
        },
      ],
    },
  ],
});

// Records every scrollIntoView the tree makes, by row id and argument.
//
// One recorder over the prototype rather than a spy per row, deliberately: a
// per-row spy is installed on a specific DOM node, so a call landing on a node
// React had recreated would be recorded by nothing and read as "it never
// scrolled". This sees every call whatever element it lands on, which is what
// makes `toEqual([])` in the control below mean what it says.
type ScrollCall = {
  rowId: string | undefined;
  options: ScrollIntoViewOptions | boolean | undefined;
};

const scrollCalls: ScrollCall[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

function recordScrolls(): void {
  scrollCalls.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(
    this: Element,
    options?: ScrollIntoViewOptions | boolean
  ) {
    scrollCalls.push({
      rowId: (this as HTMLElement).dataset?.dragRowId,
      options,
    });
  };
}

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  scrollCalls.length = 0;
});

// Saved oldest first, so the pane renders newest-first: CHARLIE, BRAVO, ALPHA.
// The clock is pinned per save (KAN-141): saving stamps contentModified with
// Date.now(), which is what the list is ordered by, so three saves in one tick
// would tie and collapse onto the id tiebreak.
const render = (selectedId: string) => {
  recordScrolls();
  return renderWithProviders(<TabGroupEntryContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(false));
      vi.useFakeTimers();
      try {
        for (const [id, title, at] of [
          ['a', 'ALPHA', T0 - 2 * HOUR],
          ['b', 'BRAVO', T0 - HOUR],
          ['c', 'CHARLIE', T0],
        ] as const) {
          vi.setSystemTime(at);
          store.dispatch(saveToTabContainerInternal(session(id, title, at)));
        }
      } finally {
        vi.useRealTimers();
      }
      store.dispatch(selectTabContainer(selectedId));
    },
  });
};

const renderedOrder = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-drag-row-id]')].map(
    (row) => row.dataset.dragRowId
  );

const rename = (
  store: Awaited<ReturnType<typeof render>>['store'],
  tabGroupId: string,
  editableTitle: string
) =>
  act(() => {
    store.dispatch(updateTabGroupTitle({ tabGroupId, editableTitle }));
  });

describe('following the selected session when the list rearranges', () => {
  test('scrolls to the selected row when an edit moves it to the top', async () => {
    const { container, store } = await render('a');
    // The premise: ALPHA is selected and last, i.e. the row a scrolled-down
    // user is looking at.
    expect(renderedOrder(container)).toEqual(['c', 'b', 'a']);
    scrollCalls.length = 0;

    await rename(store, 'a', 'ALPHA RENAMED');

    // The rearrangement this exists for, asserted before the consequence.
    expect(renderedOrder(container)).toEqual(['a', 'c', 'b']);
    expect(scrollCalls).toEqual([
      { rowId: 'a', options: { block: 'nearest' } },
    ]);
  });

  // The case that is easy to miss: the user did not touch the selected session
  // at all, but it moved anyway because something else jumped over it. A sync
  // arriving from another device does exactly this.
  test('scrolls to the selected row when ANOTHER session moves past it', async () => {
    const { container, store } = await render('b');
    expect(renderedOrder(container)).toEqual(['c', 'b', 'a']);
    scrollCalls.length = 0;

    await rename(store, 'a', 'ALPHA RENAMED');

    // BRAVO is still selected and untouched, but it is now index 2, not 1.
    expect(renderedOrder(container)).toEqual(['a', 'c', 'b']);
    expect(scrollCalls).toEqual([
      { rowId: 'b', options: { block: 'nearest' } },
    ]);
  });

  // The case where the INDEX alone is not enough to notice. An undo and a sync
  // merge each replace the whole container in one action, so the order and the
  // selection move together in a single commit -- and the newly selected
  // session can land on the index the old one just vacated. Keyed on the index
  // alone, the effect would see nothing change and leave the user looking at
  // wherever they happened to be scrolled.
  test('follows the selection when a restore moves the order AND the selection', async () => {
    const { container, store } = await render('c');
    expect(renderedOrder(container)).toEqual(['c', 'b', 'a']);
    scrollCalls.length = 0;

    const before = store.getState().tabContainerDataState;
    // BRAVO takes index 0, which is where CHARLIE -- the current selection --
    // is sitting right now.
    const reordered = ['b', 'c', 'a'].flatMap((id) =>
      before.tabGroups.filter((group) => group.tabGroupId === id)
    );
    expect(reordered).toHaveLength(before.tabGroups.length);

    act(() => {
      store.dispatch(
        restoreContainer({
          ...before,
          tabGroups: reordered,
          selectedTabGroupId: 'b',
        })
      );
    });

    expect(renderedOrder(container)).toEqual(['b', 'c', 'a']);
    expect(scrollCalls).toEqual([
      { rowId: 'b', options: { block: 'nearest' } },
    ]);
  });

  test('scrolls to the selected row on mount, for a selection already off screen', async () => {
    const { container } = await render('a');

    expect(renderedOrder(container)).toEqual(['c', 'b', 'a']);
    expect(scrollCalls).toEqual([
      { rowId: 'a', options: { block: 'nearest' } },
    ]);
  });
});

describe('NOT following when nothing moved under the selection', () => {
  // THE CONTROL. Without it, an effect that scrolled on every single render
  // would satisfy all three tests above -- and it would be the bug this ticket
  // is careful to avoid, because it would yank a hand-scrolled list back on any
  // unrelated state change.
  test('CONTROL: an edit that does not reorder the list scrolls nothing', async () => {
    const { container, store } = await render('a');
    expect(renderedOrder(container)).toEqual(['c', 'b', 'a']);
    scrollCalls.length = 0;

    // CHARLIE is already at the top, so touching it leaves every index alone.
    await rename(store, 'c', 'CHARLIE RENAMED');

    // The store really did change and the list really did re-render -- without
    // this the test would pass against a component that ignored the dispatch,
    // which proves nothing about the effect's dependencies.
    expect(
      store
        .getState()
        .tabContainerDataState.tabGroups.map((group) => group.title)
    ).toEqual(['CHARLIE RENAMED', 'BRAVO', 'ALPHA']);
    expect(renderedOrder(container)).toEqual(['c', 'b', 'a']);
    expect(scrollCalls).toEqual([]);
  });

  // The other way the selection stops having a row: a search narrows the list
  // past it. The effect re-runs mid-flight with an id that matches nothing in
  // the DOM -- KAN-90's effect has not yet moved the selection to the surviving
  // match -- so this is the path where a lookup that assumed a row would throw.
  test('a search that filters the selection out scrolls to the new match, not the old one', async () => {
    const { container, store } = await render('a');
    scrollCalls.length = 0;

    act(() => {
      store.dispatch(openSearchPanel());
      store.dispatch(setSearchInputText('CHARLIE'));
    });

    // ALPHA is gone from the list and KAN-90 has moved the selection onto the
    // one match. Nothing was scrolled on ALPHA's behalf along the way.
    expect(renderedOrder(container)).toEqual(['c']);
    expect(store.getState().tabContainerDataState.selectedTabGroupId).toBe('c');
    expect(scrollCalls).toEqual([
      { rowId: 'c', options: { block: 'nearest' } },
    ]);
  });

  // The worst path: there is no row to scroll to. Deleting the selected session
  // nulls selectedTabGroupId, so the effect re-runs with a selection that
  // matches nothing in the DOM.
  test('deleting the selected session scrolls nothing and does not throw', async () => {
    const { container, store } = await render('a');
    scrollCalls.length = 0;

    act(() => {
      store.dispatch(deleteTabContainerInternal('a'));
    });

    expect(
      store.getState().tabContainerDataState.selectedTabGroupId
    ).toBeNull();
    expect(renderedOrder(container)).toEqual(['c', 'b']);
    expect(scrollCalls).toEqual([]);
  });
});
