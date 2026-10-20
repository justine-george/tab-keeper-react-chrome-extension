import { setupChromeFake } from '../setup/chrome.fake';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DraggableRow,
  RowDragArea,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { endCarry, startCarry } from '../../redux/carry';
import { savedItem } from '../../redux/carriedItem';
import { endDragHold } from '../../redux/dragHold';
import type { ResolveDrop } from '../../components/home/rightpane/rowDrag/dropRules';

// KAN-704. A press left of a row's box (its drag dots, KAN-703) asks which
// band the pointer is in as if pressed at the row's left edge. KAN-706: an
// adopted carry asks as its press did, in the list it was pressed in.
const ROW_H = 30;
// Rows from x 40 to 200; the pane from 0. A press at x 10 is 30px left of a row.
const ROW_LEFT = 40;
const BESIDE = 10;

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
});
afterEach(() => {
  endCarry('cancelled');
  endDragHold();
  document.documentElement.removeAttribute('data-dragging');
  vi.restoreAllMocks();
});

const Harness = ({
  resolveDrop,
  adoptRowId,
}: {
  resolveDrop: ResolveDrop;
  adoptRowId?: string;
}) => (
  <div data-testid="pane" style={{ overflowY: 'auto' }}>
    <RowDragArea
      rowIds={['a', 'b', 'c']}
      onMove={() => {}}
      dragKind="tab"
      resolveDrop={resolveDrop}
      onDropTargetChange={() => {}}
      adoptRowId={adoptRowId}
    >
      {['a', 'b', 'c'].map((id) => (
        <DraggableRow key={id} rowId={id}>
          <div>Row {id.toUpperCase()}</div>
        </DraggableRow>
      ))}
    </RowDragArea>
  </div>
);

const nodeFor = (label: string) => {
  const el = screen.getByText(label).parentElement;
  if (el === null) throw new Error(`no row for ${label}`);
  return el;
};

const layout = () => {
  const pane = screen.getByTestId('pane');
  Object.defineProperty(pane, 'clientHeight', {
    value: 300,
    configurable: true,
  });
  Object.defineProperty(pane, 'scrollHeight', {
    value: 90,
    configurable: true,
  });
  pane.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 300 });
  ['A', 'B', 'C'].forEach((letter, i) => {
    nodeFor(`Row ${letter}`).getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: ROW_LEFT,
        y: i * ROW_H,
        width: 200 - ROW_LEFT,
        height: ROW_H,
      });
  });
};

// KAN-708. DraggableRow reads the platform (useMacKeys), so a drag test needs a chrome to read.
let chromeHandle: ReturnType<typeof setupChromeFake> | undefined;
beforeEach(() => {
  chromeHandle = setupChromeFake();
});
afterEach(() => {
  chromeHandle?.restore();
  chromeHandle = undefined;
});

describe('which x the band question gets (KAN-704)', () => {
  test('a press left of the row asks at the row: the pointer plus the gap', () => {
    const asked: number[] = [];
    render(
      <Harness resolveDrop={(_, x) => (asked.push(x), { bandId: undefined })} />
    );
    layout();
    fireEvent.pointerDown(nodeFor('Row B'), {
      clientX: BESIDE,
      clientY: 45,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: BESIDE + 2, clientY: 55 });
    // PREMISE: the drag started and asked.
    expect(document.documentElement.getAttribute('data-dragging')).toBe('tab');
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[asked.length - 1]).toBe(BESIDE + 2 + (ROW_LEFT - BESIDE));
  });

  test('CONTROL: a press on the row asks at the pointer', () => {
    const asked: number[] = [];
    render(
      <Harness resolveDrop={(_, x) => (asked.push(x), { bandId: undefined })} />
    );
    layout();
    fireEvent.pointerDown(nodeFor('Row B'), {
      clientX: 60,
      clientY: 45,
      button: 0,
    });
    fireEvent.pointerMove(document, { clientX: 62, clientY: 55 });
    expect(asked[asked.length - 1]).toBe(62);
  });

  test('an adopted carry pressed on its row asks at the pointer', () => {
    const asked: number[] = [];
    render(
      <Harness
        resolveDrop={(_, x) => (asked.push(x), { bandId: undefined })}
        adoptRowId="a"
      />
    );
    layout();
    startCarry(
      savedItem({ kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'x' }),
      { kind: 'tab', title: 'Carried', faviconUrl: '' },
      300,
      40
    );
    fireEvent.pointerMove(document, { clientX: BESIDE, clientY: 40 });
    fireEvent.pointerMove(document, { clientX: BESIDE + 2, clientY: 50 });
    // PREMISE: adopted, and asked.
    expect(document.querySelector('[data-drag-held]')).not.toBeNull();
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[asked.length - 1]).toBe(BESIDE + 2);
  });

  test('an adopted carry pressed left of its row asks as that press did: the pointer plus its gap (KAN-706)', () => {
    const asked: number[] = [];
    render(
      <Harness
        resolveDrop={(_, x) => (asked.push(x), { bandId: undefined })}
        adoptRowId="a"
      />
    );
    layout();
    const gap = ROW_LEFT - BESIDE;
    startCarry(
      savedItem({ kind: 'tab', tabGroupId: 'S1', windowId: 'w1', tabId: 'x' }),
      { kind: 'tab', title: 'Carried', faviconUrl: '' },
      300,
      40,
      undefined,
      gap
    );
    fireEvent.pointerMove(document, { clientX: BESIDE, clientY: 40 });
    fireEvent.pointerMove(document, { clientX: BESIDE + 2, clientY: 50 });
    // PREMISE: adopted, and asked.
    expect(document.querySelector('[data-drag-held]')).not.toBeNull();
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[asked.length - 1]).toBe(BESIDE + 2 + gap);
  });
});
