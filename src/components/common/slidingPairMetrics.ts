import type { SlidingPairMetrics } from './SlidingPair';
import { CONTROL, DURATION, RADIUS } from '../../styles/scale';

// KAN-248. The pair on the popup's own scale, for Settings and setup alike.
export const SETTINGS_PAIR_METRICS: SlidingPairMetrics = {
  height: CONTROL.ROW,
  radius: RADIUS.SQUARE,
  knobRadius: RADIUS.SQUARE,
  slide: `${DURATION.MOVE} ease-out`,
  press: `${DURATION.COLOR} ease-out`,
};
