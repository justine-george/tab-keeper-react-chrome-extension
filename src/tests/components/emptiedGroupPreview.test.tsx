import { describe, expect, test, afterEach } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

import TabGroupDetailsContainer from '../../components/home/rightpane/TabGroupDetailsContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import {
  saveToTabContainerInternal,
  selectTabContainer,
} from '../../redux/slices/tabContainerDataStateSlice';
import {
  setHasTabGroupsPermission,
  setIsNotDirty,
} from '../../redux/slices/globalStateSlice';

// KAN-169. The whole chain, in jsdom: a group with ONE member, its member
// dragged out of the band. The reducer prunes the emptied group, and the
// preview has to say so -- the band stops drawing its chrome, and the rows
// below it close up by what that chrome occupied.
//
// jsdom has no layout, so every row, title row, tail marker and band is given
// a box. Bands carry a 2px margin either side.
//
//   a0 0, a1 20, [S title 42, s0 62, S:tail 82], a3 84, a4 104

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

const tab = (id: string, g?: string) => ({
  tabId: id,
  favicon: '',
  title: `Tab ${id}`,
  url: `https://${id}.test`,
  ...(g ? { chromeGroupId: g } : {}),
});

const ROW = 20;

const render = () =>
  renderWithProviders(<TabGroupDetailsContainer />, {
    seedStore: (store) => {
      store.dispatch(setHasTabGroupsPermission(true));
      store.dispatch(
        saveToTabContainerInternal({
          tabGroupId: 'tg',
          title: 'Session',
          createdTime: '2026-09-14 09:00:00',
          windowCount: 1,
          tabCount: 5,
          isAutoSave: false,
          isSelected: true,
          windows: [
            {
              windowId: 'w',
              windowHeight: 1080,
              windowWidth: 1920,
              windowOffsetTop: 0,
              windowOffsetLeft: 0,
              tabCount: 5,
              title: 'w',
              tabs: [
                tab('a0'),
                tab('a1'),
                tab('s0', 'S'),
                tab('a3'),
                tab('a4'),
              ],
              chromeTabGroups: [{ groupId: 'S', title: 'Solo', color: 'blue' }],
            },
          ],
        })
      );
      store.dispatch(selectTabContainer('tg'));
      store.dispatch(setIsNotDirty());
    },
  });

const ROWS: Record<string, number> = { a0: 0, a1: 20, s0: 62, a3: 84, a4: 104 };
const FIXED: Record<string, [number, number]> = {
  S: [42, ROW],
  'S:tail': [82, 0],
};

const layout = (container: HTMLElement) => {
  const q = (selector: string) =>
    container.querySelector<HTMLElement>(selector)!;
  for (const [id, top] of Object.entries(ROWS)) {
    q(`[data-drag-row-id="${id}"]`).getBoundingClientRect = () => box(top, ROW);
  }
  for (const [key, [top, height]] of Object.entries(FIXED)) {
    q(`[data-fixed-row-id="${key}"]`).getBoundingClientRect = () =>
      box(top, height);
  }
  q('[data-band-id="S"]').getBoundingClientRect = () => box(42, 40);
  q('[data-drop-window-id="w"]').getBoundingClientRect = () => box(-30, 160);
  return q;
};

const press = (el: HTMLElement, y: number) => {
  fireEvent.pointerDown(el, { clientX: 10, clientY: y, button: 0 });
  fireEvent.pointerMove(document, { clientX: 10, clientY: y + 6 });
};
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });

const shift = (el: HTMLElement) =>
  Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('the last member held outside its band', () => {
  test('held back inside its own band, the mark and the closing-up are gone', async () => {
    const { container } = await render();
    const q = layout(container);
    await act(async () => {
      press(q('[data-drag-row-id="s0"]'), 72);
      moveTo(36);
    });
    // PREMISE: it was removed a moment ago.
    expect(q('[data-band-id="S"]').hasAttribute('data-drag-removed')).toBe(
      true
    );

    await act(async () => {
      moveTo(72);
    });
    expect(q('[data-band-id="S"]').hasAttribute('data-drag-removed')).toBe(
      false
    );
    expect(shift(q('[data-drag-row-id="a3"]'))).toBe(0);
  });
});
