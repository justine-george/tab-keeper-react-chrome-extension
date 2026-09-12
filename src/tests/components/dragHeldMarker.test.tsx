import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';

// KAN-160. A group drag compresses ONLY the held group, so the stylesheet has
// to know which row is held. The marker obeys the same ordering rules as the
// kind (drag-engine invariants 4, 5 and 7): published before measuring,
// cleared after judging, and it must survive a re-render.

const box = (top: number) =>
  ({
    top,
    bottom: top + 30,
    left: 0,
    right: 200,
    height: 30,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const Rows = ({ ids = ['a1', 'a2', 'a3'] }: { ids?: string[] }) => (
  <RowDragArea rowIds={ids} onMove={() => {}} dragKind="group">
    {ids.map((id) => (
      <DraggableRow key={id} rowId={id}>
        <div>Row {id}</div>
      </DraggableRow>
    ))}
  </RowDragArea>
);

const node = (label: string) => screen.getByText(label).parentElement!;
const held = (label: string) => node(label).hasAttribute('data-drag-held');
const press = () =>
  fireEvent.pointerDown(node('Row a2'), {
    clientX: 10,
    clientY: 45,
    button: 0,
  });
const moveTo = (y: number) =>
  fireEvent.pointerMove(document, { clientX: 10, clientY: y });

afterEach(() => {
  fireEvent.pointerUp(document, { clientX: 10, clientY: 0 });
  document.documentElement.removeAttribute('data-dragging');
});

describe('the held-row marker', () => {
  test('is on the held row, already, when the rows are measured', () => {
    render(<Rows />);
    const seen: boolean[] = [];
    ['Row a1', 'Row a2', 'Row a3'].forEach((label, i) => {
      node(label).getBoundingClientRect = () => {
        seen.push(held('Row a2'));
        return box(i * 30);
      };
    });
    press();
    moveTo(70);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });

  // CONTROL: one element, the held one.
  test('CONTROL: is on no other row', () => {
    render(<Rows />);
    press();
    moveTo(70);
    expect(held('Row a1')).toBe(false);
    expect(held('Row a3')).toBe(false);
    expect(document.querySelectorAll('[data-drag-held]')).toHaveLength(1);
  });

  test('is cleared on release and on Escape', () => {
    render(<Rows />);
    press();
    moveTo(70);
    fireEvent.pointerUp(document, { clientX: 10, clientY: 70 });
    expect(held('Row a2')).toBe(false);

    press();
    moveTo(70);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(held('Row a2')).toBe(false);
  });

  test('is never set by a press below the threshold', () => {
    render(<Rows />);
    press();
    moveTo(47);
    expect(held('Row a2')).toBe(false);
  });

  // KAN-159's shape: a sync re-renders every list mid-drag with new identities.
  test('survives a re-render mid-drag', () => {
    const { rerender } = render(<Rows />);
    press();
    moveTo(70);
    rerender(<Rows ids={['a1', 'a2', 'a3']} />);
    expect(held('Row a2')).toBe(true);
  });
});
