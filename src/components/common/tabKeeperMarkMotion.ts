import {
  canAnimate,
  prefersReducedMotion,
  type Motion,
} from '../modals/getStartedMotion';

// The header mark's click animates only transform: the get-started beat in miniature.

// Web Animations durations, so not DURATION's (CSS transitions).
export const MARK_CLICK = {
  PRESS_MS: 150,
  SHUTTER_MS: 300,
  SHUTTER_DELAY_MS: 60,
} as const;

// Plays nothing, and returns null, when motion is off or unavailable.
export function playMarkClick(
  mark: Element,
  shutter: Element | null
): Motion | null {
  if (prefersReducedMotion() || !canAnimate(mark)) return null;
  const press = mark.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.92)' },
      { transform: 'scale(1)' },
    ],
    { duration: MARK_CLICK.PRESS_MS, easing: 'ease-out' }
  );
  const slide =
    shutter === null
      ? null
      : shutter.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-36px)', offset: 0.45 },
            { transform: 'translateX(-36px)', offset: 0.55 },
            { transform: 'translateX(0)' },
          ],
          {
            duration: MARK_CLICK.SHUTTER_MS,
            delay: MARK_CLICK.SHUTTER_DELAY_MS,
            easing: 'ease-in-out',
          }
        );
  const finished = Promise.all([press.finished, slide?.finished]).then(
    () => true,
    () => false
  );
  return {
    finished,
    cancel: () => {
      press.cancel();
      slide?.cancel();
    },
  };
}
