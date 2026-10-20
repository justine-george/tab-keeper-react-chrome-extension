import { useRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

  it("mousedown outside calls onDismiss('outside'); mousedown on [data-coach-mark] does not", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByText('coach'));
    fireEvent.mouseDown(screen.getByText('two'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('outside');
  });

  it('ignores a press outside while closed', () => {
    const onDismiss = vi.fn();
    render(<Harness isOpen={false} onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
