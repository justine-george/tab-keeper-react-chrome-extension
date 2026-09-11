import { describe, expect, test, afterEach } from 'vitest';
import { fireEvent, within } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';

// KAN-162, through the component that shipped the bug: the window rename
// <input> lives inside [data-window-drag-handle], so selecting its text used
// to start a window drag.

const win = (id: string, title: string) => ({
  windowId: id,
  windowHeight: 1080,
  windowWidth: 1920,
  windowOffsetTop: 0,
  windowOffsetLeft: 0,
  tabCount: 1,
  title,
  tabs: [
    {
      tabId: `${id}-t0`,
      favicon: '',
      title: `${title} tab`,
      url: `https://${id}.test`,
    },
  ],
});

const render = () =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(false));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'group-1',
          title: 'Research',
          createdTime: '2026-09-11 09:00:00',
          windowCount: 3,
          tabCount: 3,
          isAutoSave: false,
          isSelected: true,
          windows: [
            win('w1', 'First'),
            win('w2', 'Second'),
            win('w3', 'Third'),
          ],
        })
      );
      store.dispatch(selectTabContainer('group-1'));
      store.dispatch(setIsNotDirty());
    },
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

const rowOf = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;
const layout = (container: HTMLElement) =>
  ['w1', 'w2', 'w3'].forEach(
    (id, i) =>
      (rowOf(container, id).getBoundingClientRect = () => box(i * 64, 64))
  );

type Store = Awaited<ReturnType<typeof render>>['store'];
const order = (store: Store) =>
  store
    .getState()
    .tabContainerDataState.tabGroups[0].windows.map((w) => w.windowId);

const dragFrom = (target: Element, y: number) => {
  fireEvent.pointerDown(target, { clientX: 20, clientY: y, button: 0 });
  fireEvent.pointerMove(document, { clientX: 100, clientY: y });
  fireEvent.pointerMove(document, { clientX: 100, clientY: 5 });
  fireEvent.pointerUp(document, { clientX: 100, clientY: 5 });
};

afterEach(() => document.documentElement.removeAttribute('data-dragging'));

describe('selecting text in a window rename field (KAN-162)', () => {
  test('starts no window drag and moves nothing', async () => {
    const { container, store } = await render();
    layout(container);
    fireEvent.click(
      within(rowOf(container, 'w2')).getByRole('button', {
        name: 'Rename window group',
      })
    );
    const input = within(rowOf(container, 'w2')).getByRole('textbox');

    const seen: (string | null)[] = [];
    const observer = new MutationObserver(() =>
      seen.push(document.documentElement.getAttribute('data-dragging'))
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-dragging'],
    });
    dragFrom(input, 96);
    await Promise.resolve();
    observer.disconnect();

    expect(seen).toEqual([]);
    expect(order(store)).toEqual(['w1', 'w2', 'w3']);
  });

  // CONTROL: the same gesture from the header outside the field is a drag.
  test('CONTROL: the same gesture on the header moves the window', async () => {
    const { container, store } = await render();
    layout(container);
    const handle = rowOf(container, 'w2').querySelector(
      '[data-window-drag-handle]'
    )!;
    dragFrom(handle, 96);
    expect(order(store)).toEqual(['w2', 'w1', 'w3']);
  });
});
