import { describe, expect, test, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

import {
  RowDragArea,
  DraggableRow,
} from '../../components/home/rightpane/rowDrag/RowDragArea';
import { setupChromeFake } from '../setup/chrome.fake';

// KAN-708. A right-button press is the context menu, not the start of a drag.
// On a Mac, Ctrl+press is the right-click, so it is no drag either. Chrome
// reports a Ctrl+press as button 0 with ctrlKey set, which is why the Mac half
// needs the platform: elsewhere Ctrl+press is an ordinary left press.

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

const Harness = ({ onMove }: { onMove: (id: string, i: number) => void }) => (
  <RowDragArea rowIds={['a', 'b', 'c']} onMove={onMove}>
    <DraggableRow rowId="a">
      <div>
        <span>Row a</span>
      </div>
    </DraggableRow>
    <DraggableRow rowId="b">
      <div>
        <span>Row b</span>
      </div>
    </DraggableRow>
    <DraggableRow rowId="c">
      <div>
        <span>Row c</span>
      </div>
    </DraggableRow>
  </RowDragArea>
);

// useMacKeys reads the platform from chrome.runtime, so every test installs
// the fake first. Absent a seed it is 'linux': not a Mac.
let handle: ReturnType<typeof setupChromeFake> | undefined;
const installPlatform = (os: 'mac' | 'linux') => {
  handle = setupChromeFake({ platformOs: os });
};

const setup = async () => {
  const onMove = vi.fn();
  const { container } = render(<Harness onMove={onMove} />);
  container
    .querySelectorAll<HTMLElement>('[data-drag-row-id]')
    .forEach((row, i) => (row.getBoundingClientRect = () => box(i * 30)));
  // Lets useMacKeys' getPlatformInfo answer land before any press.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return onMove;
};

const pressFrom = (
  target: Element,
  init: { button: number; ctrlKey?: boolean }
) => {
  fireEvent.pointerDown(target, { clientX: 10, clientY: 15, ...init });
  fireEvent.pointerMove(document, { clientX: 60, clientY: 15 });
  fireEvent.pointerMove(document, { clientX: 60, clientY: 55 });
};
const dragging = () => document.documentElement.hasAttribute('data-dragging');

afterEach(() => {
  fireEvent.pointerUp(document, { clientX: 60, clientY: 55 });
  document.documentElement.removeAttribute('data-dragging');
  handle?.restore();
  handle = undefined;
});

describe('a press that is a context menu starts no drag', () => {
  test('a right-button press and move does not drag', async () => {
    installPlatform('linux');
    const onMove = await setup();
    pressFrom(screen.getByText('Row a'), { button: 2 });
    expect(dragging()).toBe(false);
    fireEvent.pointerUp(document, { clientX: 60, clientY: 55 });
    expect(onMove).not.toHaveBeenCalled();
  });

  test('a Ctrl press on a Mac does not drag', async () => {
    installPlatform('mac');
    const onMove = await setup();
    pressFrom(screen.getByText('Row a'), { button: 0, ctrlKey: true });
    expect(dragging()).toBe(false);
    fireEvent.pointerUp(document, { clientX: 60, clientY: 55 });
    expect(onMove).not.toHaveBeenCalled();
  });

  // CONTROL: a left press with the same move drags, so the test above fails
  // for the right button, not for a harness that never drags.
  test('CONTROL: a left press and the same move drags', async () => {
    installPlatform('linux');
    await setup();
    pressFrom(screen.getByText('Row a'), { button: 0 });
    expect(dragging()).toBe(true);
  });

  // CONTROL: off a Mac, Ctrl is not a right-click, so the press drags.
  test('CONTROL: a Ctrl press off a Mac drags', async () => {
    installPlatform('linux');
    await setup();
    pressFrom(screen.getByText('Row a'), { button: 0, ctrlKey: true });
    expect(dragging()).toBe(true);
  });
});
