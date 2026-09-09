import { describe, expect, test, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import TabGroupEntryContainer from '../../components/home/leftpane/TabGroupEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { RenderWithProvidersResult } from '../setup/renderWithProviders';
import {
  openSearchPanel,
  setSearchInputText,
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import { saveToTabContainerInternal } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-130. Dragging sessions in the left pane, and the strip that says the list
// has stopped meaning "newest first".

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);
const ROW_H = 40;

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

// Saved oldest first, so the pane renders newest-first: CHARLIE, BRAVO, ALPHA.
const render = (searchText?: string) =>
  renderWithProviders(<TabGroupEntryContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(false));
      store.dispatch(
        saveToTabContainerInternal(session('a', 'ALPHA', T0 - 2 * HOUR))
      );
      store.dispatch(
        saveToTabContainerInternal(session('b', 'BRAVO', T0 - HOUR))
      );
      store.dispatch(saveToTabContainerInternal(session('c', 'CHARLIE', T0)));
      if (searchText !== undefined) {
        store.dispatch(openSearchPanel());
        store.dispatch(setSearchInputText(searchText));
      }
      store.dispatch(setIsNotDirty());
    },
  });

const nodeFor = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;

const layout = (container: HTMLElement, ids: string[]) =>
  ids.forEach((id, i) => {
    nodeFor(container, id).getBoundingClientRect = () => box(i * ROW_H, ROW_H);
  });

const drag = (from: HTMLElement, startY: number, endY: number) => {
  fireEvent.pointerDown(from, { clientX: 10, clientY: startY, button: 0 });
  fireEvent.pointerMove(document, {
    clientX: 10,
    clientY: (startY + endY) / 2,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: endY });
  fireEvent.pointerUp(document, { clientX: 10, clientY: endY });
  // Chrome synthesizes a click after mouseup; jsdom does not. Firing it keeps
  // the sequence faithful, and it matters: the drag arms a 400ms suppression
  // window that this click SPENDS. Without it the window stays armed and the
  // next deliberate click in the test is swallowed -- which is a test artifact,
  // not the app's behaviour.
  fireEvent.click(from, { clientX: 10, clientY: endY });
};

const order = (store: RenderWithProvidersResult['store']) =>
  store.getState().tabContainerDataState.tabGroups.map((g) => g.tabGroupId);

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('dragging a session in the left pane', () => {
  test('moves it to the front', async () => {
    const { container, store } = await render();
    layout(container, ['c', 'b', 'a']);
    expect(order(store)).toEqual(['c', 'b', 'a']);

    // ALPHA is last (midpoint 100); drop it above CHARLIE.
    drag(nodeFor(container, 'a'), 100, 5);

    expect(order(store)).toEqual(['a', 'c', 'b']);
  });

  test('moves it to the back', async () => {
    const { container, store } = await render();
    layout(container, ['c', 'b', 'a']);

    drag(nodeFor(container, 'c'), 20, 115);

    expect(order(store)).toEqual(['b', 'a', 'c']);
  });

  // The invariant the reducer maintains, asserted through the UI: the rank it
  // wrote must reproduce the array order when sorted, or the next sync undoes
  // the drag the user just watched happen.
  test('the resulting order survives a re-sort by rank', async () => {
    const { container, store } = await render();
    layout(container, ['c', 'b', 'a']);

    drag(nodeFor(container, 'a'), 100, 5);

    const groups = store.getState().tabContainerDataState.tabGroups;
    const key = (g: (typeof groups)[number]) => g.rank ?? g.createdAt!;
    const resorted = [...groups].sort((x, y) => key(y) - key(x));
    expect(resorted.map((g) => g.tabGroupId)).toEqual(
      groups.map((g) => g.tabGroupId)
    );
  });
});

// KAN-131 at the session level, where it is most exposed: search filters
// sessions directly, so the rendered list and the stored one differ outright.
describe('a session drag inside a filtered list', () => {
  test('commits nothing', async () => {
    const { container, store } = await render('ALPHA');
    const rendered = [
      ...container.querySelectorAll<HTMLElement>('[data-drag-row-id]'),
    ];
    expect(rendered).toHaveLength(1);
    rendered[0].getBoundingClientRect = () => box(0, ROW_H);

    drag(rendered[0], 20, 300);

    expect(order(store)).toEqual(['c', 'b', 'a']);
    expect(store.getState().globalState.isDirty).toBe(false);
  });
});

describe('the custom-order strip', () => {
  const strip = () => screen.queryByLabelText('Sort by date saved');

  test('is absent until something is dragged', async () => {
    const { container } = await render();
    layout(container, ['c', 'b', 'a']);

    expect(strip()).toBeNull();
    expect(screen.queryByText('Custom order')).toBeNull();
  });

  test('appears once the list is in custom order', async () => {
    const { container } = await render();
    layout(container, ['c', 'b', 'a']);

    drag(nodeFor(container, 'a'), 100, 5);

    expect(strip()).not.toBeNull();
    expect(screen.getByText('Custom order')).toBeInTheDocument();
  });

  test('resets to newest-first and then hides itself', async () => {
    const { container, store } = await render();
    layout(container, ['c', 'b', 'a']);
    drag(nodeFor(container, 'a'), 100, 5);
    expect(order(store)).toEqual(['a', 'c', 'b']);

    fireEvent.click(strip()!);

    expect(order(store)).toEqual(['c', 'b', 'a']);
    expect(strip()).toBeNull();
  });

  // Offering the reset while searching would promise something about a list
  // the user cannot see -- the reset applies to the stored order, not the
  // narrowed one on screen.
  test('is hidden while a search is filtering the list', async () => {
    const { container, store, rerender } = await render();
    layout(container, ['c', 'b', 'a']);
    drag(nodeFor(container, 'a'), 100, 5);
    expect(strip()).not.toBeNull();

    store.dispatch(openSearchPanel());
    store.dispatch(setSearchInputText('ALPHA'));
    rerender(<TabGroupEntryContainer />);

    expect(strip()).toBeNull();
  });
});
