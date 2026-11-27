import { EASE } from '../../styles/scale';
import { lastInputWasKey } from '../../utils/functions/lastInput';
import { leaveCopy, type LeaveOptions } from '../common/popoverMotion';
import { canAnimate, prefersReducedMotion } from '../modals/getStartedMotion';
import { originFacing } from './cardMotion';
import type { CoachPlacement } from './coachMarkPlacement';

// KAN-1033 (pick 2-B). The tour's dim and rings fade in as its first card
// grows in, and out as its last card leaves, the card playing its appear
// backwards. Between two cards (a step's and the note after Skip) the dim
// stays on. Esc leaves with the fade too. Reduced motion: the start shows at
// once, as the card does; the end only fades.

export const TOUR_MOTION = {
  DIM_MS: 200,
  CARD_OUT_MS: 150,
  // The next card (the note after Skip) is placed ~10 ms after the last left:
  // the dim holds still this long first, so it hands over with no dip.
  DIM_HOLD_MS: 50,
} as const;

const LEAVE: LeaveOptions = { afterKey: true, fadeWhenReduced: true };

// A leaving dim the next card may take over while it still holds still.
let handedDim: (() => void) | null = null;

function leaveDim(dim: HTMLElement): void {
  const end = leaveCopy(
    dim,
    { ms: TOUR_MOTION.DIM_MS, to: { opacity: 0 }, withDim: false },
    { ...LEAVE, as: 'dim', delay: TOUR_MOTION.DIM_HOLD_MS }
  );
  if (end === null) return;
  handedDim = end;
  window.setTimeout(() => {
    if (handedDim === end) handedDim = null;
  }, TOUR_MOTION.DIM_HOLD_MS);
}

/** True, and the leaving dim gone at once, when a card just left with its dim still fading. */
function takeHandedDim(): boolean {
  const end = handedDim;
  handedDim = null;
  if (end === null) return false;
  end();
  return true;
}

/** The dim and rings fade in, as a card first shows; a dim just handed on stays as it is. */
export function fadeTourIn(
  dim: HTMLElement | null,
  rings: HTMLElement[]
): void {
  const keepsDim = takeHandedDim();
  // Reduced motion: the card shows at once (useCardMotion), and so do these.
  if (lastInputWasKey() || prefersReducedMotion()) return;
  const parts = [...(keepsDim ? [] : [dim]), ...rings].filter(
    (part): part is HTMLElement => part !== null && canAnimate(part)
  );
  for (const part of parts) {
    part.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: TOUR_MOTION.DIM_MS,
      easing: EASE.OUT,
    });
  }
}

const SIDES: readonly CoachPlacement['side'][] = [
  'right',
  'left',
  'below',
  'free',
];

// The side a card was placed on, from its data-coach-side.
function sideOf(card: HTMLElement): CoachPlacement['side'] | null {
  return SIDES.find((side) => side === card.dataset.coachSide) ?? null;
}

/**
 * A callback ref for one of a card's parts that fades a copy out as the part
 * leaves the page: the card shrinking toward what it points at, a dim or a
 * ring fading. A part let go of and kept (a remount in place) does not fade.
 */
export function tourLeaveRef(
  part: 'card' | 'dim' | 'ring'
): (el: HTMLElement | null) => void {
  let current: HTMLElement | null = null;
  return (el) => {
    const prev = current;
    current = el;
    if (el !== null || prev === null) return;
    if (part === 'dim') {
      leaveDim(prev);
      return;
    }
    const facing = sideOf(prev);
    const end =
      part === 'card'
        ? leaveCopy(
            prev,
            {
              ms: TOUR_MOTION.CARD_OUT_MS,
              to: { opacity: 0, scale: '0.97' },
              withDim: false,
            },
            {
              ...LEAVE,
              as: 'card',
              origin: facing === null ? undefined : originFacing(facing),
            }
          )
        : leaveCopy(
            prev,
            { ms: TOUR_MOTION.DIM_MS, to: { opacity: 0 }, withDim: false },
            { ...LEAVE, as: 'ring' }
          );
    if (end) queueMicrotask(() => prev.isConnected && end());
  };
}
