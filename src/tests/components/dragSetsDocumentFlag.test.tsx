import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import WindowEntryContainer from '../../components/home/rightpane/WindowEntryContainer';
import { renderWithProviders } from '../setup/renderWithProviders';
import { setHasTabGroupsPermission } from '../../redux/slices/globalStateSlice';
import type { tabData } from '../../redux/slices/tabContainerDataStateSlice';

// KAN-134 / KAN-135. What a drag publishes to the document, so CSS can react.
//
// The previous mechanism set `document.body.style.cursor` directly, and the
// test asserted exactly that -- and passed while the user saw no change at all,
// because `cursor` inherits and every row declares its own. jsdom resolves no
// cascade, so this layer can only pin that the FLAG is published and cleared
// correctly; that the flag then does anything is `dragStyles.test.ts` (the rule
// exists) plus a browser pass (the rule renders).
//
// Splitting it that way is deliberate: an assertion this layer *can* make
// honestly, rather than one that looks stronger and proves nothing.

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

const Harness = () => (
  <RowDragArea rowIds={['a', 'b', 'c']} onMove={() => undefined}>
    {['a', 'b', 'c'].map((id) => (
      <DraggableRow key={id} rowId={id}>
        <div>Row {id}</div>
      </DraggableRow>
    ))}
  </RowDragArea>
);

const nodeFor = (id: string) =>
  document.querySelector<HTMLElement>(`[data-drag-row-id="${id}"]`)!;

const layout = () =>
  ['a', 'b', 'c'].forEach((id, i) => {
    nodeFor(id).getBoundingClientRect = () => box(i * ROW_H, ROW_H);
  });

const press = (id: string, y: number) =>
  fireEvent.pointerDown(nodeFor(id), { clientX: 10, clientY: y, button: 0 });
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });
const release = (y: number) =>
  fireEvent.pointerUp(document, { clientX: 10, clientY: y });

const isDragging = () => document.documentElement.hasAttribute('data-dragging');

afterEach(() => {
  document.documentElement.removeAttribute('data-dragging');
});

describe('a drag publishes a flag on the document', () => {
  beforeEach(() => {
    render(<Harness />);
    layout();
  });

  test('set while dragging, cleared on drop', () => {
    expect(isDragging()).toBe(false);

    press('a', 15);
    moveTo(50);
    expect(isDragging()).toBe(true);

    release(50);
    expect(isDragging()).toBe(false);
  });

  test('Escape clears it too', () => {
    press('a', 15);
    moveTo(50);
    expect(isDragging()).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(isDragging()).toBe(false);
  });

  // THE CONTROL. A press that never crosses the activation distance is a
  // click, not a drag -- flagging it would force the grabbing cursor and hide
  // every row's actions on an ordinary click.
  test('CONTROL: a press below the threshold never sets it', () => {
    press('a', 15);
    moveTo(17);

    expect(isDragging()).toBe(false);
    release(17);
    expect(isDragging()).toBe(false);
  });
});

describe('a drag interrupted by unmount', () => {
  test('does not leave the document flagged', () => {
    const { unmount } = render(<Harness />);
    layout();

    press('a', 15);
    moveTo(50);
    expect(isDragging()).toBe(true);

    unmount();

    expect(isDragging()).toBe(false);
  });
});

// KAN-135. The stylesheet hides the strips during a drag, so it needs a stable
// hook to find them by -- the reveal itself is an emotion class keyed on React
// state, which no stylesheet can select.
describe('a tab row marks its action strip for the stylesheet', () => {
  const TABS: tabData[] = [
    { tabId: 't1', favicon: '', title: 'One', url: 'https://one.test' },
    { tabId: 't2', favicon: '', title: 'Two', url: 'https://two.test' },
  ];

  test('every tab row carries data-row-actions', async () => {
    const { container } = await renderWithProviders(
      <WindowEntryContainer
        title="Window 1"
        tabGroupId="tg1"
        windowId="w1"
        tabs={TABS}
        onWindowTitleClick={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />,
      { seedStore: (store) => store.dispatch(setHasTabGroupsPermission(false)) }
    );

    const strips = container.querySelectorAll('[data-row-actions]');
    // One per tab row, plus the window header's own strip.
    expect(strips.length).toBeGreaterThanOrEqual(TABS.length);
  });

  test('the marked strip is the one holding the delete control', async () => {
    const { container } = await renderWithProviders(
      <WindowEntryContainer
        title="Window 1"
        tabGroupId="tg1"
        windowId="w1"
        tabs={TABS}
        onWindowTitleClick={() => undefined}
        onUpdateWindowGroupTitle={() => undefined}
        onAddCurrTabToWindowClick={() => undefined}
        onDeleteClick={() => undefined}
      />,
      { seedStore: (store) => store.dispatch(setHasTabGroupsPermission(false)) }
    );

    const deleteControls = [
      ...container.querySelectorAll('[aria-label="Delete tab"]'),
    ];
    expect(deleteControls.length).toBe(TABS.length);
    deleteControls.forEach((control) => {
      expect(control.closest('[data-row-actions]')).not.toBeNull();
    });
  });
});
