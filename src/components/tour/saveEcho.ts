import { EASE } from '../../styles/scale';

// Web Animations timings, so not DURATION's (CSS transitions).
export const SAVE_ECHO = {
  DOT_MS: 160,
  STAGGER_MS: 40,
  MAX_DOTS: 7,
  SETTLE_PX: 3,
} as const;

// §10: each tab's dot settles 3px, 40ms apart; the row itself lands at once.
export function playSaveEcho(dots: readonly Element[]): Animation[] {
  return dots.slice(0, SAVE_ECHO.MAX_DOTS).map((dot, i) =>
    dot.animate(
      [
        { transform: `translateY(-${SAVE_ECHO.SETTLE_PX}px)` },
        { transform: 'translateY(0px)' },
      ],
      {
        duration: SAVE_ECHO.DOT_MS,
        delay: i * SAVE_ECHO.STAGGER_MS,
        easing: EASE.OUT,
      }
    )
  );
}
