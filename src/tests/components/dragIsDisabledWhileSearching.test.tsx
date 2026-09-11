import { describe, expect, test, afterEach } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  closeSearchPanel,
  setSearchInputText,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-131. A drag reports a position in the list ON SCREEN; the reducers apply
// it to the list in the STORE. Those are the same list right up until a search
// narrows the rendered one -- filterTabGroups drops non-matching tabs from a
// window and non-matching windows from a session (local.ts:133-160) -- and then
// the index crosses a boundary between two different arrays.
//
// The failure is silent and it is not a no-op: the computed target genuinely
// differs from the source index, so the move commits, stamps the session and
// queues a cloud write, landing the row somewhere the user never pointed at.
//
// jsdom reports every rect as zero, so the rows are given real boxes below --
// otherwise every row would share a midpoint of 0 and the landing index would
// be the same number however the pointer moved, which would make the CONTROLS
// prove nothing.
const ROW_H = 30;

const box = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    height,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

// Two of the four tabs match "match", so a search leaves a window rendering
// half its stored tabs.
const buildSession = () => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-09-07 09:00:00',
  windowCount: 1,
  tabCount: 4,
  isAutoSave: false,
  isSelected: true,
  windows: [
    {
      windowId: 'win-1',
      windowHeight: 1080,
      windowWidth: 1920,
      windowOffsetTop: 0,
      windowOffsetLeft: 0,
      tabCount: 4,
      title: 'Morning reading',
      tabs: [
        { tabId: 't1', favicon: '', title: 'Alpha', url: 'https://a.test' },
        {
          tabId: 't2',
          favicon: '',
          title: 'Beta match',
          url: 'https://b.test',
        },
        { tabId: 't3', favicon: '', title: 'Gamma', url: 'https://c.test' },
        {
          tabId: 't4',
          favicon: '',
          title: 'Delta match',
          url: 'https://d.test',
        },
      ],
    },
  ],
});

const render = (searchText?: string) =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(false));
      store.dispatch(saveToTabContainerInternal(buildSession()));
      store.dispatch(selectTabContainer('group-1'));
      if (searchText !== undefined) {
        store.dispatch(openSearchPanel());
        store.dispatch(setSearchInputText(searchText));
      }
      // Saving the session dirtied it on the way in. Without this reset the
      // dirty assertion below would be reading the seed rather than the drag,
      // and would fail against correct code.
      store.dispatch(setIsNotDirty());
    },
  });

// Only the tab rows: the window list and the group list (KAN-160) add
// draggable nodes of their own, and giving those boxes here would put them in
// the same coordinate space as the tabs. The group list's ids are prefixed
// `tab:` / `group:`, so a bare `^="t"` would also match `tab:t1`.
const layoutTabRows = (container: HTMLElement): HTMLElement[] => {
  const rows = [
    ...container.querySelectorAll<HTMLElement>(
      '[data-drag-row-id^="t"]:not([data-drag-row-id*=":"])'
    ),
  ];
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () => box(i * ROW_H, ROW_H);
  });
  return rows;
};

const dragToTop = (row: HTMLElement, fromY: number) => {
  fireEvent.pointerDown(row, { clientX: 10, clientY: fromY, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: fromY - 20 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: 5 });
  fireEvent.pointerUp(document, { clientX: 10, clientY: 5 });
};

const storedTabIds = (store: RenderWithProvidersResult['store']) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows[0].tabs.map((t) => t.tabId);

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('a tab drag inside a filtered list', () => {
  // THE CONTROL. Without it a guard that disabled dragging outright -- or a
  // harness whose pointer events never reached the area at all -- would pass
  // the test below while proving nothing.
  test('CONTROL: with no search running, the same drag does reorder', async () => {
    const { container, store } = await render();
    const rows = layoutTabRows(container);
    expect(rows).toHaveLength(4);

    dragToTop(rows[3], 3 * ROW_H + 15);

    expect(storedTabIds(store)).toEqual(['t4', 't1', 't2', 't3']);
  });

  test('commits nothing, because its indices are not the stored ones', async () => {
    const { container, store } = await render('match');
    const rows = layoutTabRows(container);
    // The premise: the window is rendering half of what it stores.
    expect(rows.map((r) => r.dataset.dragRowId)).toEqual(['t2', 't4']);

    dragToTop(rows[1], ROW_H + 15);

    expect(storedTabIds(store)).toEqual(['t1', 't2', 't3', 't4']);
  });

  // The consequences the reducer would have had, asserted separately: a drag
  // that reorders nothing but still dirties the session would sync a write for
  // an edit that did not happen.
  test('and does not dirty the session', async () => {
    const { container, store } = await render('match');
    const rows = layoutTabRows(container);

    dragToTop(rows[1], ROW_H + 15);

    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // KAN-140, and this assertion is the exact inverse of what it used to be.
  //
  // The old version allowed the drag, reasoning that an empty box filters
  // nothing, so the rendered list IS the stored one and nothing can go wrong.
  // That reasoning is still true -- KAN-131's index-crossing defect genuinely
  // cannot occur here -- and it is not what decides this.
  //
  // What decides it is that the box's contents are a terrible thing to hang an
  // affordance on. The same gesture on the same rows worked or did nothing
  // depending on whether a character had been typed, with rows rendering
  // `cursor: pointer` in both states (KAN-134), so nothing told the user which
  // one they were in. It also made the safety property depend on a keystroke
  // racing a pointer gesture; asking about the mode removes the timing
  // dimension rather than betting there is no race today.
  //
  // Note this file's OTHER tests still pass a query, so they continue to cover
  // KAN-131's actual subject -- a narrowed list -- which this change does not
  // touch. And the CONTROL above still reorders, so the harness is not simply
  // failing to deliver pointer events.
  test('an open search panel with an empty box does not allow dragging', async () => {
    const { container, store } = await render('');
    const rows = layoutTabRows(container);
    // The premise: nothing is filtered, so all four rows are on screen and the
    // drag below is the one that used to commit.
    expect(rows).toHaveLength(4);

    dragToTop(rows[3], 3 * ROW_H + 15);

    expect(storedTabIds(store)).toEqual(['t1', 't2', 't3', 't4']);
  });

  // The mode, not the query, all the way down: clearing the box mid-search
  // must not hand the gesture back.
  test('clearing the box does not re-enable dragging', async () => {
    const { container, store } = await render('match');
    // act, because a bare dispatch after render does not flush: the rows would
    // still be the two matching ones and this would assert against a list the
    // component has not caught up with.
    act(() => {
      store.dispatch(setSearchInputText(''));
    });

    const rows = layoutTabRows(container);
    expect(rows).toHaveLength(4);

    dragToTop(rows[3], 3 * ROW_H + 15);

    expect(storedTabIds(store)).toEqual(['t1', 't2', 't3', 't4']);
  });

  // And leaving search restores it, so the guard is a mode rather than a
  // one-way door. Without this, disabling dragging permanently would pass
  // every other test in this file.
  test('CONTROL: closing the search panel allows dragging again', async () => {
    const { container, store } = await render('');
    act(() => {
      store.dispatch(closeSearchPanel());
    });

    const rows = layoutTabRows(container);
    dragToTop(rows[3], 3 * ROW_H + 15);

    expect(storedTabIds(store)).toEqual(['t4', 't1', 't2', 't3']);
  });
});
