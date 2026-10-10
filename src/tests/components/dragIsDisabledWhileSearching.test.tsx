import { describe, expect, test, afterEach } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  setSearchInputText,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-131. A drag reports an index in the list ON SCREEN; reducers apply it to the list in the STORE. A search narrows the
// rendered list, the index crosses arrays, and the move commits somewhere the user never pointed -- silently, with a cloud write.
// Rows get real boxes below: in jsdom every midpoint is 0 and the CONTROLS would prove nothing.
const ROW_H = 30;

const box = (top: number, height: number): DOMRect => ({
  top,
  bottom: top + height,
  left: 0,
  right: 200,
  height,
  width: 200,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

// Two of the four tabs match "match", so a search renders half the window.
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
        store.dispatch(setSearchInputText(searchText));
      }
      // Saving dirtied it: reset, so the dirty assertion reads the drag, not the seed.
      store.dispatch(setIsNotDirty());
    },
  });

// Only the tab rows: other lists' rows would share their coordinates, and a bare ^="t" would match `tab:t1`.
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
  // CONTROL: a guard that disabled dragging outright, or events that never reached the area, would pass the test below.
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
    // A drag that reorders nothing but dirties the session would sync a write for no edit.
    expect(store.getState().globalState.isDirty).toBe(false);
  });

  // Spaces alone are no search (R2): nothing is filtered and the drag is on.
  test('spaces alone leave dragging on', async () => {
    const { container, store } = await render('   ');
    const rows = layoutTabRows(container);
    expect(rows).toHaveLength(4);

    dragToTop(rows[3], 3 * ROW_H + 15);

    expect(storedTabIds(store)).toEqual(['t4', 't1', 't2', 't3']);
  });

  // The gate is the text (KAN-385): clearing it hands the drag back. Disabling dragging for good would pass the rest.
  test('CONTROL: clearing the box allows dragging again', async () => {
    const { container, store } = await render('match');
    // act, because a bare dispatch after render does not flush.
    act(() => {
      store.dispatch(setSearchInputText(''));
    });

    const rows = layoutTabRows(container);
    expect(rows).toHaveLength(4);

    dragToTop(rows[3], 3 * ROW_H + 15);

    expect(storedTabIds(store)).toEqual(['t4', 't1', 't2', 't3']);
  });
});
