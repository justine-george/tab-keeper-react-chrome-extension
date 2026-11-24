import { useState } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useSavedCardPresence } from '../../components/home/savedCardPresence';

// KAN-999. When the card and its column are drawn: at once with no input on
// this page (a load), or with no grid to move (Settings); otherwise kept
// drawn while it leaves, until its motion ends.

const input = vi.hoisted(() => ({ recent: true }));
vi.mock('../../utils/functions/recentUserInput', () => ({
  hadUserInputWithin: () => input.recent,
}));

interface FakeAnimation {
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  onfinish: (() => void) | null;
  cancelled: boolean;
  cancel: () => void;
}
let animations: FakeAnimation[] = [];
const realAnimate = Element.prototype.animate;

beforeEach(() => {
  input.recent = true;
  animations = [];
  Element.prototype.animate = function (keyframes) {
    const a: FakeAnimation = {
      keyframes,
      onfinish: null,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    animations.push(a);
    return a as unknown as Animation;
  };
});
afterEach(() => {
  Element.prototype.animate = realAnimate;
});

function Harness({ shows, hasGrid }: { shows: boolean; hasGrid: boolean }) {
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const drawn = useSavedCardPresence(shows, grid);
  return (
    <>
      <output data-drawn={String(drawn)} />
      {hasGrid && (
        <div
          ref={setGrid}
          style={{ gridTemplateColumns: '300px 52px 500px 400px' }}
        >
          {drawn && <div data-saved-session-card />}
        </div>
      )}
    </>
  );
}

const drawnOf = (c: HTMLElement) =>
  c.querySelector('output')?.getAttribute('data-drawn');
const columnMove = () =>
  animations.find(
    (a) => a.keyframes !== null && 'gridTemplateColumns' in a.keyframes
  );
const finish = (a: FakeAnimation | undefined) =>
  act(() => {
    a?.onfinish?.();
  });

describe('useSavedCardPresence', () => {
  test('no input on this page (a load): the card goes at once, nothing moves', () => {
    input.recent = false;
    const { container, rerender } = render(<Harness shows hasGrid />);
    rerender(<Harness shows={false} hasGrid />);
    expect(drawnOf(container)).toBe('false');
    expect(animations).toHaveLength(0);
  });

  test('after a press: the card stays drawn while its column closes, then goes', () => {
    const { container, rerender } = render(<Harness shows hasGrid />);
    rerender(<Harness shows={false} hasGrid />);
    expect(drawnOf(container)).toBe('true');
    expect(columnMove()?.keyframes).toEqual({
      gridTemplateColumns: ['300px 52px 500px 400px', '300px 0px 552px 400px'],
    });
    finish(columnMove());
    expect(drawnOf(container)).toBe('false');
  });

  test('after a press: arriving, the card is drawn at once and its column opens', () => {
    const { container, rerender } = render(<Harness shows={false} hasGrid />);
    rerender(<Harness shows hasGrid />);
    expect(drawnOf(container)).toBe('true');
    expect(columnMove()).toBeDefined();
    finish(columnMove());
    expect(drawnOf(container)).toBe('true');
  });

  test('back while leaving: it stays, and the leave is cancelled', () => {
    const { container, rerender } = render(<Harness shows hasGrid />);
    rerender(<Harness shows={false} hasGrid />);
    const leave = columnMove();
    rerender(<Harness shows hasGrid />);
    expect(leave?.cancelled).toBe(true);
    expect(drawnOf(container)).toBe('true');
  });

  // The review's case: Settings reuses the grid's element and detaches it.
  test('no grid (Settings): a change after a press lands at once', () => {
    const { container, rerender } = render(<Harness shows hasGrid />);
    rerender(<Harness shows hasGrid={false} />);
    rerender(<Harness shows={false} hasGrid={false} />);
    expect(drawnOf(container)).toBe('false');
    rerender(<Harness shows={false} hasGrid />);
    expect(drawnOf(container)).toBe('false');
  });

  test('the grid detached mid-leave: the move is cancelled and the card goes', () => {
    const { container, rerender } = render(<Harness shows hasGrid />);
    rerender(<Harness shows={false} hasGrid />);
    const leave = columnMove();
    rerender(<Harness shows={false} hasGrid={false} />);
    expect(leave?.cancelled).toBe(true);
    expect(drawnOf(container)).toBe('false');
  });
});
