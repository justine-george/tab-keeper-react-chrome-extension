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

  const glideId = useRef(0);

  const cancelRunning = () => {
    running.current.forEach((animation) => animation.cancel());
    running.current = [];
  };

  // The card is under step 7's lit rows mid-glide, so it takes no pointer until the glide ends or is cancelled.
  const passClicksThrough = (glides: Animation[], elements: HTMLElement[]) => {
    const id = ++glideId.current;
    const setPointer = (value: string) =>
      elements.forEach((element) => {
        element.style.pointerEvents = value;
      });
    setPointer('none');
    let pending = glides.length;
    const settle = () => {
      pending -= 1;
      if (pending === 0 && glideId.current === id) setPointer('');
    };
    glides.forEach((glide) => {
      glide.addEventListener('finish', settle, { once: true });
      glide.addEventListener('cancel', settle, { once: true });
    });
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
    const markGlide = playGlide(mark, from.mark);
    const ringGlide =
      ring !== null && from.ring !== null ? playGlide(ring, from.ring) : null;
    running.current = [markGlide, ringGlide].filter(
      (animation): animation is Animation => animation !== null
    );
    if (running.current.length === 0) return;
    passClicksThrough(
      running.current,
      [
        markGlide === null ? null : mark,
        ringGlide === null ? null : ring,
      ].filter((element): element is HTMLElement => element !== null)
    );
  }, [frame, markRef, ringRef]);

  // A card that unmounts mid-glide leaves no stale batch to settle.
  useLayoutEffect(
    () => () => {
      glideId.current += 1;
    },
    []
  );
}
