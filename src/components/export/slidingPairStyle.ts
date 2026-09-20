import type { SlidingPairMetrics } from '../common/SlidingPair';

/**
 * The knob's motion, shared with ExportPage's KAN-201 exemption.
 *
 * Overshoots to 106.6% at 162ms and is within 1% of rest by 249ms. The
 * overshoot pushes the clip past the track's inner wall, where it has nothing
 * to paint, so the knob squashes against the wall rather than crossing the
 * frame (Justine's rule).
 */
export const KNOB_TRANSITION = '280ms cubic-bezier(0.3, 1.45, 0.6, 1)';

/**
 * The export toolbar's pair, as KAN-218 drew it: 34px, 3px corners, the knob
 * 2px inside, the overshoot above, and a 160ms dip on press. Off the popup's
 * scale on purpose, like the rest of this page, which is why these numbers
 * live here rather than in the component (KAN-248).
 */
export const EXPORT_PAIR_METRICS: SlidingPairMetrics = {
  height: '34px',
  radius: '3px',
  knobRadius: '2px',
  slide: KNOB_TRANSITION,
  press: '160ms cubic-bezier(0.23, 1, 0.32, 1)',
};
