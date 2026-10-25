import { useRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMenuList } from '../../hooks/useMenuList';
import type { MenuDismissReason } from '../../hooks/useMenuList';

function Harness({
  isOpen = true,
  onDismiss,
  onWalk,
  onParentKeyDown,
}: {
  isOpen?: boolean;
  onDismiss: (reason: MenuDismissReason) => void;
  onWalk?: () => void;
  onParentKeyDown?: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { registerItem, handleKeyDown } = useMenuList({
    count: 3,
    axis: 'vertical',
    isOpen,
    wrapperRef,
    onDismiss,
    onWalk,
  });
  return (
    <div onKeyDown={onParentKeyDown}>
      <button>outside</button>
      <button aria-haspopup="menu">other menu</button>
      <div data-coach-mark>
        <button>coach</button>
      </div>
      <div ref={wrapperRef} onKeyDown={handleKeyDown}>
        {['one', 'two', 'three'].map((name, i) => (
          <button key={name} ref={registerItem(i)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

describe('useMenuList', () => {
  it('focuses item 0 when opened', () => {
    render(<Harness onDismiss={vi.fn()} />);
    expect(screen.getByText('one')).toHaveFocus();
  });

  it('does not focus anything while closed', () => {
    render(<Harness isOpen={false} onDismiss={vi.fn()} />);
    expect(screen.getByText('one')).not.toHaveFocus();
  });

  it('ArrowDown from the last item wraps to the first and calls onWalk', () => {
    const onWalk = vi.fn();
    render(<Harness onDismiss={vi.fn()} onWalk={onWalk} />);
    screen.getByText('three').focus();
    fireEvent.keyDown(screen.getByText('three'), { key: 'ArrowDown' });
    expect(screen.getByText('one')).toHaveFocus();
    expect(onWalk).toHaveBeenCalledTimes(1);
  });

  it('ArrowUp from the first item wraps to the last', () => {
    render(<Harness onDismiss={vi.fn()} />);
    fireEvent.keyDown(screen.getByText('one'), { key: 'ArrowUp' });
    expect(screen.getByText('three')).toHaveFocus();
  });

  it("Esc calls onDismiss('escape') with defaultPrevented true and does not reach a parent keydown listener", () => {
    const onDismiss = vi.fn();
    const onParentKeyDown = vi.fn();
    render(<Harness onDismiss={onDismiss} onParentKeyDown={onParentKeyDown} />);
    const notPrevented = fireEvent.keyDown(screen.getByText('one'), {
      key: 'Escape',
    });
    expect(notPrevented).toBe(false);
    expect(onDismiss).toHaveBeenCalledWith('escape');
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it("a press outside calls onDismiss('outside'); a press on [data-coach-mark] does not", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByText('coach'));
    fireEvent.pointerDown(screen.getByText('two'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('outside');
  });

  it('ignores a press outside while closed', () => {
    const onDismiss = vi.fn();
    render(<Harness isOpen={false} onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('useMenuList: a press outside only closes (KAN-778)', () => {
  const PRESS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

  // What reaches the page under the window's capture listeners.
  function listen() {
    const heard: string[] = [];
    const record = (e: Event) => heard.push(e.type);
    for (const type of PRESS) document.addEventListener(type, record, true);
    return heard;
  }

  function press(el: Element, init: MouseEventInit = {}) {
    fireEvent.pointerDown(el, init);
    fireEvent.mouseDown(el, init);
    fireEvent.pointerUp(el, init);
    fireEvent.mouseUp(el, init);
    fireEvent.click(el, { detail: 1, ...init });
  }

  // A key ends any hold, so none outlives its test.
  afterEach(() => {
    fireEvent.keyDown(window, { key: 'Shift' });
  });

  it('a left press outside closes the menu and nothing under it hears any of the press', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const heard = listen();
    press(screen.getByText('outside'));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('outside');
    expect(heard).toEqual([]);
  });

  it('the next press is heard whole', () => {
    const { rerender } = render(<Harness onDismiss={vi.fn()} />);
    press(screen.getByText('outside'));
    rerender(<Harness isOpen={false} onDismiss={vi.fn()} />);
    const heard = listen();
    press(screen.getByText('outside'));
    expect(heard).toEqual(PRESS);
  });

  it('a click with no press behind it gets through while the press is held', () => {
    render(<Harness onDismiss={vi.fn()} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    const heard = listen();
    fireEvent.click(screen.getByText('outside'), { detail: 0 });
    expect(heard).toEqual(['click']);
  });

  it('a key ends the hold: the press’s late click is heard', () => {
    render(<Harness onDismiss={vi.fn()} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    fireEvent.keyDown(window, { key: 'Enter' });
    const heard = listen();
    fireEvent.click(screen.getByText('outside'), { detail: 1 });
    expect(heard).toEqual(['click']);
  });

  it.each([
    ['a right press', { button: 2 }],
    ['a Ctrl+press', { button: 0, ctrlKey: true }],
  ])('%s outside closes the menu and goes on', (_, init) => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const heard = listen();
    press(screen.getByText('outside'), init);
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('outside');
    expect(heard).toEqual(PRESS);
  });

  it('a press on another menu’s trigger closes this menu and goes on', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const heard = listen();
    press(screen.getByText('other menu'));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('outside');
    expect(heard).toEqual(PRESS);
  });

  it.each(['two', 'coach'])('a press on %s (inside) goes on', (name) => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    const heard = listen();
    press(screen.getByText(name));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(heard).toEqual(PRESS);
  });
});
