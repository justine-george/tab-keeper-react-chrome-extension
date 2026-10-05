import { EASE } from '../../styles/scale';
import type { CoachPlacement } from './coachMarkPlacement';

// Web Animations durations, so not DURATION's (CSS transitions).
export const CARD_MOTION = { GLIDE_MS: 200, APPEAR_MS: 200 } as const;

// From where it was, mid-glide included, to where it is now; nothing when it did not move.
export function playGlide(
  element: HTMLElement,
  from: DOMRect
): Animation | null {
  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (dx === 0 && dy === 0) return null;
  return element.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0px, 0px)' },
    ],
    { duration: CARD_MOTION.GLIDE_MS, easing: 'ease-in-out' }
  );
}

export function playAppear(element: HTMLElement, origin: string): Animation {
  return element.animate(
    [
      { opacity: 0, transform: 'scale(0.97)', transformOrigin: origin },
      { opacity: 1, transform: 'scale(1)', transformOrigin: origin },
    ],
    { duration: CARD_MOTION.APPEAR_MS, easing: EASE.OUT }
  );
}

// The card grows from the edge that faces its anchor.
export function originFacing(side: CoachPlacement['side']): string {
  switch (side) {
    case 'right':
      return 'left center';
    case 'left':
      return 'right center';
    case 'below':
      return 'center top';
    case 'free':
      return 'left top';
  }
}
