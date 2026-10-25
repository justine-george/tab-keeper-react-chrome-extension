import { DURATION, EASE } from '../../styles/scale';

/**
 * What a button's glyph does while a fine pointer is over the button
 * (KAN-344): it turns and/or grows to a pose, goes a little past it and
 * settles, then eases back when the pointer leaves. Each one was picked by
 * Justine from a side-by-side mock; buttons without one are deliberately
 * still, and only their hover fill answers.
 */
export interface HoverMotion {
  /** The angle to turn to. Choose one at which the glyph looks like itself. */
  rotate?: `${number}deg`;
  /** The factor to grow to. */
  scale?: number;
  /** How far to slide sideways; negative is left (KAN-773). */
  translate?: `${number}px`;
  /** How long the way in takes. The way back is always DURATION.MOVE. */
  duration: (typeof DURATION)['MOVE' | 'FLOURISH'];
}

/**
 * The CSS for a hover motion, for the emotion block of the element that
 * owns the hover: it moves that element's glyph. Icon and Settings' Back
 * (KAN-773), whose glyph sits inside a wider control, both use it, so the
 * gates stay in one place. (Search's magnifier had one, and
 * Justine removed it as tacky.)
 *
 * Transitions, not keyframes, so leaving early reverses from wherever the
 * glyph got to instead of snapping back. Gated three ways: a pointer that
 * hovers (a tap on a touch screen would leave it stuck), no reduced-motion
 * preference, and :hover alone, so a keyboard focus never moves anything.
 */
export function hoverMotionCss(motion: HoverMotion): string {
  const rotate = motion.rotate ?? '0deg';
  const scale = motion.scale ?? 1;
  const translate = motion.translate ?? '0px';
  const ease = (curve: string, duration: string) =>
    ['rotate', 'scale', 'translate']
      .map((p) => `${p} ${duration} ${curve}`)
      .join(', ');
  return `@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    & .material-symbols-outlined, & svg {
      transition: ${ease(EASE.OUT, DURATION.MOVE)};
    }
    &:hover .material-symbols-outlined, &:hover svg {
      rotate: ${rotate};
      scale: ${scale};
      translate: ${translate};
      transition: ${ease(EASE.OUT_BACK, motion.duration)};
    }
  }`;
}
