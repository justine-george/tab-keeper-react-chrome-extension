import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { useHasRisen } from '../../hooks/useHasRisen';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-654. The rise gate the review card, setup and the cloud question share.
function Riser({ isShown }: { isShown: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const hasRisen = useHasRisen(ref, isShown);
  if (!isShown) return null;
  return (
    <div ref={ref} data-testid="riser" data-risen={String(hasRisen)}>
      <span data-testid="child" />
    </div>
  );
}
const risen = () => screen.getByTestId('riser').dataset.risen;

describe('useHasRisen', () => {
  afterEach(() => vi.restoreAllMocks());

  test('not risen until its own rise ends', () => {
    render(<Riser isShown={true} />);
    expect(risen()).toBe('false');
    act(() => void fireEvent.animationEnd(screen.getByTestId('riser')));
    expect(risen()).toBe('true');
  });

  test('a rise cancelled midway still lets pointer input back on', () => {
    render(<Riser isShown={true} />);
    act(
      () =>
        void fireEvent(
          screen.getByTestId('riser'),
          new Event('animationcancel')
        )
    );
    expect(risen()).toBe('true');
  });

  test('shown again under reduced motion: risen at once', () => {
    const { rerender } = render(<Riser isShown={true} />);
    act(() => void fireEvent.animationEnd(screen.getByTestId('riser')));
    rerender(<Riser isShown={false} />);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, query.includes('reduce'))
    );
    rerender(<Riser isShown={true} />);
    expect(risen()).toBe('true');
  });

  test('a child’s animation ending is not its rise', () => {
    render(<Riser isShown={true} />);
    act(() => void fireEvent.animationEnd(screen.getByTestId('child')));
    expect(risen()).toBe('false');
  });

  test('reduced motion has no rise: risen at once', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, query.includes('reduce'))
    );
    render(<Riser isShown={true} />);
    expect(risen()).toBe('true');
  });

  test('drawn only after a closed first render: its rise is still heard', () => {
    const { rerender } = render(<Riser isShown={false} />);
    rerender(<Riser isShown={true} />);
    act(() => void fireEvent.animationEnd(screen.getByTestId('riser')));
    expect(risen()).toBe('true');
  });

  test('shown again: it rises again', () => {
    const { rerender } = render(<Riser isShown={true} />);
    act(() => void fireEvent.animationEnd(screen.getByTestId('riser')));
    rerender(<Riser isShown={false} />);
    rerender(<Riser isShown={true} />);
    expect(risen()).toBe('false');
  });
});
