import { useLayoutEffect, useRef, type RefObject } from 'react';

import type { CoachFrame } from '../components/tour/coachMarkPlacement';
import {
  originFacing,
  playAppear,
  playGlide,
} from '../components/tour/cardMotion';
import {
  canAnimate,
  prefersReducedMotion,
} from '../components/modals/getStartedMotion';

// §10: a card's first appearance, and the card and ring gliding together to each new step.
export function useCardMotion(
  markRef: RefObject<HTMLElement | null>,
  ringRef: RefObject<HTMLElement | null>,
  step: number,
  frame: CoachFrame | null
): void {
  const running = useRef<Animation[]>([]);
  const glideFrom = useRef<{ mark: DOMRect; ring: DOMRect | null } | null>(
    null
  );
  const shownStep = useRef(step);
  const wasPlaced = useRef(false);

  const cancelRunning = () => {
    running.current.forEach((animation) => animation.cancel());
    running.current = [];
  };

  // A new step: where the card and ring are now, before the next frame moves them.
  useLayoutEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    const mark = markRef.current;
    if (mark === null || !wasPlaced.current) return;
    glideFrom.current = {
      mark: mark.getBoundingClientRect(),
      ring: ringRef.current?.getBoundingClientRect() ?? null,
    };
  }, [step, markRef, ringRef]);

  useLayoutEffect(() => {
    const mark = markRef.current;
    const appears = frame !== null && !wasPlaced.current;
    wasPlaced.current = frame !== null;
    if (mark === null || frame === null) return;
    const from = glideFrom.current;
    glideFrom.current = null;
    if (prefersReducedMotion() || !canAnimate(mark)) return;
    // A re-placement with nothing new to play leaves what is running alone.
    if (appears) {
      cancelRunning();
      running.current = [playAppear(mark, originFacing(frame.placement.side))];
      return;
    }
    if (from === null) return;
    cancelRunning();
    const ring = ringRef.current;
    running.current = [
      playGlide(mark, from.mark),
      ring !== null && from.ring !== null ? playGlide(ring, from.ring) : null,
    ].filter((animation): animation is Animation => animation !== null);
  }, [frame, markRef, ringRef]);
}
