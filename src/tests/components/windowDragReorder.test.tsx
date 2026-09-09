import { describe, expect, test, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  setSearchInputText,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import { RESTORE_SESSION_MESSAGE } from '../../utils/functions/windows';

// KAN-129. Dragging the windows inside one saved session.
//
// The two lists are NESTED -- a window's draggable node has to wrap its own
// tabs so the whole block moves together -- so the interesting cases are not
// "does it reorder" but "which of the two areas owns this gesture". That is
// what `handleSelector` decides, and it is what most of this file is about.
//
// jsdom reports every rect as zero, so both levels are given real boxes below.
// Window blocks are deliberately UNEQUAL in height: a window holding three tabs
// is taller than one holding one, and the landing index has to come from each
// row's measured midpoint rather than from an assumed row size.

const win = (id: string, title: string, tabCount: number) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount,
  title,
  tabs: Array.from({ length: tabCount }, (_, i) => ({
    tabId: `${id}-t${i}`,
    favicon: '',
    title: `${title} tab ${i}`,
    url: `https://${id}-${i}.test`,
  })),
});

const buildSession = () => ({
  tabGroupId: 'group-1',
  title: 'Research',
  createdTime: '2026-09-07 09:00:00',
  windowCount: 3,
  tabCount: 6,
  isAutoSave: false,
  isSelected: true,
  windows: [
    win('w1', 'First', 1),
    win('w2', 'Second', 2),
    win('w3', 'Third', 3),
  ],
});

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
      // Saving dirtied the session on the way in; without this reset a dirty
      // assertion would be reading the seed rather than the drag.
      store.dispatch(setIsNotDirty());
    },
  });

// Window rows and tab rows are both draggable nodes, told apart by their id
// prefix. Heights are proportional to how many tabs each window holds, so the
// three blocks tile [0,40) [40,100) [100,180).
const WINDOW_BOXES: Record<string, [number, number]> = {
  w1: [0, 40],
  w2: [40, 60],
  w3: [100, 80],
};

const layout = (container: HTMLElement) => {
  const rows = (prefix: string) => [
    ...container.querySelectorAll<HTMLElement>(
      `[data-drag-row-id^="${prefix}"]`
    ),
  ];
  const windows = rows('w').filter((r) => !r.dataset.dragRowId!.includes('-t'));
  windows.forEach((row) => {
    const [top, height] = WINDOW_BOXES[row.dataset.dragRowId!];
    row.getBoundingClientRect = () => box(top, height);
  });
  return windows;
};

const nodeFor = (container: HTMLElement, id: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`);
  if (!el) throw new Error(`no draggable node for ${id}`);
  return el;
};

// The window's own header row -- the part that is the drag handle. Found by
// the attribute the production code marks it with, so a test cannot pass
// against a handle that moved somewhere else.
const handleIn = (row: HTMLElement): HTMLElement => {
  const el = row.querySelector<HTMLElement>('[data-window-drag-handle]');
  if (!el) throw new Error('no drag handle in this window row');
  return el;
};

const drag = (from: HTMLElement, startY: number, endY: number) => {
  fireEvent.pointerDown(from, { clientX: 10, clientY: startY, button: 0 });
  fireEvent.pointerMove(document, {
    clientX: 10,
    clientY: (startY + endY) / 2,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: endY });
  fireEvent.pointerUp(document, { clientX: 10, clientY: endY });
};

const windowIds = (store: RenderWithProvidersResult['store']) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows.map((w) => w.windowId);

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('dragging a window inside a session', () => {
  test('moves it to the front', async () => {
    const { container, store } = await render();
    layout(container);

    drag(handleIn(nodeFor(container, 'w3')), 140, 5);

    expect(windowIds(store)).toEqual(['w3', 'w1', 'w2']);
  });

  test('moves it to the back', async () => {
    const { container, store } = await render();
    layout(container);

    drag(handleIn(nodeFor(container, 'w1')), 20, 175);

    expect(windowIds(store)).toEqual(['w2', 'w3', 'w1']);
  });

  // The midpoint is the boundary, not the row's edge, and the rows are unequal
  // in height -- so this lands only if the index came from w2's OWN measured
  // midpoint (70) rather than from a uniform row size.
  test('stopping short of the next midpoint does not advance it', async () => {
    const { container, store } = await render();
    layout(container);

    drag(handleIn(nodeFor(container, 'w1')), 20, 65);

    expect(windowIds(store)).toEqual(['w1', 'w2', 'w3']);
  });

  test('a window carries its tabs with it', async () => {
    const { container, store } = await render();
    layout(container);

    drag(handleIn(nodeFor(container, 'w3')), 140, 5);

    const moved =
      store.getState().tabContainerDataState.tabGroups[0].windows[0];
    expect(moved.title).toBe('Third');
    expect(moved.tabs).toHaveLength(3);
  });
});

// THE NESTING CASE, and the reason handleSelector exists. A window's draggable
// node wraps its tabs, so without a handle the tab area and the window area
// would both start a drag from the same pointerdown -- and the window would
// silently reorder every time a tab was dragged.
describe('the two nested lists do not fight over one gesture', () => {
  test('dragging a tab does not reorder the windows', async () => {
    const { container, store } = await render();
    layout(container);
    const tabRow = nodeFor(container, 'w3-t0');
    tabRow.getBoundingClientRect = () => box(110, 20);

    drag(tabRow, 120, 5);

    expect(windowIds(store)).toEqual(['w1', 'w2', 'w3']);
  });

  // THE CONTROL for the test above. Without it, a window drag that was broken
  // outright -- or a handle attribute that never rendered -- would pass it.
  test('CONTROL: the same gesture from the header does reorder the windows', async () => {
    const { container, store } = await render();
    layout(container);

    drag(handleIn(nodeFor(container, 'w3')), 120, 5);

    expect(windowIds(store)).toEqual(['w3', 'w1', 'w2']);
  });

  // The other half of the same claim: the tab drag still works. A handle rule
  // applied to the wrong area would disable it.
  test('CONTROL: dragging a tab still reorders that window’s tabs', async () => {
    const { container, store } = await render();
    layout(container);
    const rows = ['w3-t0', 'w3-t1', 'w3-t2'].map((id, i) => {
      const el = nodeFor(container, id);
      el.getBoundingClientRect = () => box(100 + i * 20, 20);
      return el;
    });

    drag(rows[2], 150, 105);

    const tabs =
      store.getState().tabContainerDataState.tabGroups[0].windows[2].tabs;
    expect(tabs.map((t) => t.tabId)).toEqual(['w3-t2', 'w3-t0', 'w3-t1']);
  });
});

// A window's title click opens every tab in it in a new window. Chrome
// synthesizes a click after mouseup aimed at whatever the pointer released
// over, and the held row tracks the pointer -- so without suppression a drag
// that committed nothing would open a whole window's worth of tabs. Strictly
// worse than the tab case this was first found in.
describe('a window drag does not also open the window', () => {
  const restoreMessages = (chrome: RenderWithProvidersResult['chrome']) =>
    chrome.sentMessages.filter(
      (m) => (m as { type?: string }).type === RESTORE_SESSION_MESSAGE
    );

  test('CONTROL: a plain click on the title still opens the window', async () => {
    const { container, chrome } = await render();
    layout(container);
    const title = handleIn(nodeFor(container, 'w2')).querySelector('button')!;

    fireEvent.pointerDown(title, { clientX: 10, clientY: 50, button: 0 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 50 });
    fireEvent.click(title, { clientX: 10, clientY: 50 });

    expect(restoreMessages(chrome)).toHaveLength(1);
  });

  test('the click after a drag that moved nothing is swallowed', async () => {
    const { container, chrome, store } = await render();
    layout(container);
    const row = nodeFor(container, 'w2');
    const title = handleIn(row).querySelector('button')!;

    // A drag that commits no reorder: it stays inside its own slot. These are
    // precisely the drags that open something, because a committed move takes
    // the DOM node out from under the click before it is dispatched.
    fireEvent.pointerDown(title, { clientX: 10, clientY: 50, button: 0 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 60 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 60 });
    fireEvent.click(title, { clientX: 10, clientY: 60 });

    expect(windowIds(store)).toEqual(['w1', 'w2', 'w3']);
    expect(restoreMessages(chrome)).toHaveLength(0);
  });
});

// KAN-131 at the window level. Search narrows windows[] as well as a window's
// tabs, so the same index mismatch applies one level up.
describe('a window drag inside a filtered list', () => {
  test('commits nothing, because its indices are not the stored ones', async () => {
    // "Third" matches only w3, so the session renders one of its three
    // windows.
    const { container, store } = await render('Third');
    const rendered = [
      ...container.querySelectorAll<HTMLElement>('[data-drag-row-id^="w"]'),
    ].filter((r) => !r.dataset.dragRowId!.includes('-t'));
    expect(rendered.map((r) => r.dataset.dragRowId)).toEqual(['w3']);

    rendered[0].getBoundingClientRect = () => box(0, 80);
    drag(handleIn(rendered[0]), 40, 200);

    expect(windowIds(store)).toEqual(['w1', 'w2', 'w3']);
    expect(store.getState().globalState.isDirty).toBe(false);
  });
});
