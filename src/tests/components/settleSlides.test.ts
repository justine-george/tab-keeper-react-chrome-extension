import { describe, expect, it, vi } from 'vitest';

import { settleSlides } from '../../components/home/rightpane/rowDrag/settleSlides';

// KAN-280 Part F (Justine, 02:25). A drag measures its list at rest: a transform slide still running from the last
// drag (rows easing home after a hand-back) is finished first, or the rows are measured mid-slide.
describe('settleSlides', () => {
  it('finishes every running transform transition, and nothing else', () => {
    const slide = {
      transitionProperty: 'transform',
      playState: 'running',
      finish: vi.fn(),
    };
    const fade = {
      transitionProperty: 'opacity',
      playState: 'running',
      finish: vi.fn(),
    };
    const done = {
      transitionProperty: 'transform',
      playState: 'finished',
      finish: vi.fn(),
    };
    const keyframes = { playState: 'running', finish: vi.fn() };
    settleSlides({ getAnimations: () => [slide, fade, done, keyframes] });
    expect(slide.finish).toHaveBeenCalledTimes(1);
    expect(fade.finish).not.toHaveBeenCalled();
    expect(done.finish).not.toHaveBeenCalled();
    expect(keyframes.finish).not.toHaveBeenCalled();
  });

  it('asks for the whole subtree', () => {
    const getAnimations = vi.fn(() => []);
    settleSlides({ getAnimations });
    expect(getAnimations).toHaveBeenCalledWith({ subtree: true });
  });

  it('does nothing where animations are not available (no root, or jsdom)', () => {
    expect(() => settleSlides(null)).not.toThrow();
    expect(() => settleSlides({})).not.toThrow();
  });
});
