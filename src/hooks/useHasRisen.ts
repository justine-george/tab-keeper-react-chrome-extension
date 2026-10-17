import { useEffect, useState, type RefObject } from 'react';

import { prefersReducedMotion } from '../components/modals/getStartedMotion';

/**
 * Whether `ref`'s own rise is over, ended or cancelled (KAN-653, KAN-654). Until it has, the
 * element takes no pointer input: a press already on its way to what was
 * under it lands there. Reduced motion has no rise.
 *
 * `isShown` is whether the element is drawn now, for a component that renders
 * nothing while closed: it is listened to once it appears, and rises again
 * when shown again.
 *
 * Native, not onAnimationEnd: React's did not fire for a dispatched
 * animationend in jsdom (measured). The element's own rise only, not a child's.
 */
export function useHasRisen(
  ref: RefObject<HTMLElement | null>,
  isShown = true
): boolean {
  const [hasRisen, setHasRisen] = useState(prefersReducedMotion);
  // A re-show rises again: reset as the show changes, during render, not after it.
  const [wasShown, setWasShown] = useState(isShown);
  if (isShown !== wasShown) {
    setWasShown(isShown);
    if (isShown) setHasRisen(prefersReducedMotion());
  }
  useEffect(() => {
    if (!isShown) return;
    const element = ref.current;
    if (element === null) return;
    const onEnd = (event: Event) => {
      if (event.target === element) setHasRisen(true);
    };
    // Cancelled counts as over: reduced motion switched on mid-rise sets `animation: none`.
    element.addEventListener('animationend', onEnd);
    element.addEventListener('animationcancel', onEnd);
    return () => {
      element.removeEventListener('animationend', onEnd);
      element.removeEventListener('animationcancel', onEnd);
    };
  }, [ref, isShown]);
  return hasRisen;
}
