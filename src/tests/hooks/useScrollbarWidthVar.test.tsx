import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  SCROLLBAR_WIDTH_VAR,
  useScrollbarWidthVar,
} from '../../hooks/useScrollbarWidthVar';

// KAN-336. jsdom lays nothing out: the boxes are set by hand, and the
// observer is a fake whose callback the test fires. jsdom computes a
// border-less div's border width as 16px (Chrome: 0), so the scroller's
// border is set explicitly.
let observed: Element[] = [];
let fire: () => void = () => {};
let disconnected = 0;
class FakeResizeObserver {
  constructor(callback: () => void) {
    fire = callback;
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    disconnected += 1;
  }
}

function setBox(el: HTMLElement, offsetWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'offsetWidth', {
    value: offsetWidth,
    configurable: true,
  });
  Object.defineProperty(el, 'clientWidth', {
    value: clientWidth,
    configurable: true,
  });
}

function List() {
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollbarWidthVar(scroller, box);
  return (
    <div ref={box} data-testid="box">
      <div
        ref={scroller}
        data-testid="scroller"
        style={{ border: '0px solid' }}
      />
    </div>
  );
}
const written = () =>
  screen.getByTestId('box').style.getPropertyValue(SCROLLBAR_WIDTH_VAR);

describe('useScrollbarWidthVar', () => {
  beforeEach(() => {
    observed = [];
    disconnected = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  test('writes 0px while the scroller has no bar, and observes the scroller', () => {
    render(<List />);
    expect(written()).toBe('0px');
    expect(observed).toEqual([screen.getByTestId('scroller')]);
  });

  test('a bar appearing writes its width, and going away writes 0px again', () => {
    render(<List />);
    const scroller = screen.getByTestId('scroller');
    setBox(scroller, 400, 390);
    act(() => fire());
    expect(written()).toBe('10px');
    setBox(scroller, 400, 400);
    act(() => fire());
    expect(written()).toBe('0px');
  });

  test("the scroller's own borders are not counted as bar", () => {
    render(<List />);
    const scroller = screen.getByTestId('scroller');
    scroller.style.borderLeft = '1px solid black';
    scroller.style.borderRight = '2px solid black';
    setBox(scroller, 413, 400);
    act(() => fire());
    expect(written()).toBe('10px');
  });

  test('stops observing when the list unmounts', () => {
    const { unmount } = render(<List />);
    unmount();
    expect(disconnected).toBe(1);
  });
});
