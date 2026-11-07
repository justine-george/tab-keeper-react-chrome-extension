import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import ClickableTabKeeperMark from '../../components/common/ClickableTabKeeperMark';
import { FakeMediaQueryList } from '../setup/mediaQueryFake';

// KAN-388, his pick B: a save slides the header mark's shutter the way a click does, without the press, silently.

interface Played {
  target: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
}
let played: Played[] = [];

beforeEach(() => {
  played = [];
  // jsdom has no Web Animations: a stand-in that records each call and never finishes.
  Element.prototype.animate = function (
    this: Element,
    frames: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ) {
    const cancel = vi.fn();
    played.push({
      target: this,
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
      cancel,
    });
    return {
      finished: new Promise(() => undefined),
      cancel,
    } as unknown as Animation;
  };
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'animate');
  vi.restoreAllMocks();
});

const shutter = () => document.querySelector('[data-mark-part="shutter"]');
const svg = () => document.querySelector('svg');
const on = (target: Element | null) =>
  played.filter((p) => p.target === target);

describe('a save plays the shutter', () => {
  test('mounting with saves already counted plays nothing', () => {
    render(<ClickableTabKeeperMark saveCount={3} />);
    expect(played).toHaveLength(0);
  });

  test('a rise slides the shutter only: no press, the click slide', () => {
    const { rerender } = render(<ClickableTabKeeperMark saveCount={0} />);
    rerender(<ClickableTabKeeperMark saveCount={1} />);

    expect(on(svg())).toHaveLength(0);
    const [slide] = on(shutter());
    expect(on(shutter())).toHaveLength(1);
    expect(slide.frames.map((f) => f.transform)).toEqual([
      'translateX(0)',
      'translateX(-16px)',
      'translateX(-16px)',
      'translateX(0)',
    ]);
    expect(slide.options).toMatchObject({ duration: 300, delay: 60 });
  });

  test('the same slide as a click', () => {
    const { rerender } = render(<ClickableTabKeeperMark saveCount={0} />);
    rerender(<ClickableTabKeeperMark saveCount={1} />);
    const saved = on(shutter())[0];
    cleanup();
    played = [];

    render(<ClickableTabKeeperMark />);
    fireEvent.click(svg()!.parentElement!);
    const clicked = on(shutter())[0];

    expect(saved.frames).toEqual(clicked.frames);
    expect(saved.options).toEqual(clicked.options);
    // CONTROL: the click presses the mark, the save does not.
    expect(on(svg())).toHaveLength(1);
  });

  test('a re-render with the same count plays nothing more', () => {
    const { rerender } = render(<ClickableTabKeeperMark saveCount={0} />);
    rerender(<ClickableTabKeeperMark saveCount={1} />);
    rerender(<ClickableTabKeeperMark saveCount={1} />);
    expect(played).toHaveLength(1);
  });

  test('a save while it plays restarts it from rest', () => {
    const { rerender } = render(<ClickableTabKeeperMark saveCount={0} />);
    rerender(<ClickableTabKeeperMark saveCount={1} />);
    rerender(<ClickableTabKeeperMark saveCount={2} />);

    expect(on(shutter())).toHaveLength(2);
    expect(on(shutter())[0].cancel).toHaveBeenCalledTimes(1);
    expect(on(shutter())[1].cancel).not.toHaveBeenCalled();
  });

  test('reduced motion: the shutter dims and comes back, nothing moves', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new FakeMediaQueryList(query, query.includes('reduce'))
    );
    const { rerender } = render(<ClickableTabKeeperMark saveCount={0} />);
    rerender(<ClickableTabKeeperMark saveCount={1} />);

    expect(played).toHaveLength(1);
    const [dim] = on(shutter());
    expect(dim.frames.map((f) => f.opacity)).toEqual([1, 0.45, 1]);
    expect(dim.frames.some((f) => f.transform !== undefined)).toBe(false);
    // COLOR (120ms) out, and the same back.
    expect(dim.options).toMatchObject({ duration: 240 });
  });

  test('CONTROL: without saveCount, nothing ever plays on its own', () => {
    const { rerender } = render(<ClickableTabKeeperMark />);
    rerender(<ClickableTabKeeperMark />);
    expect(played).toHaveLength(0);
  });
});
