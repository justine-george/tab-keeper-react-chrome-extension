import { css, keyframes } from '@emotion/react';

import { DURATION, EASE } from '../../styles/scale';

// From 16px low into place. `translate`, not `transform`: it adds to however
// a dialog is placed, centred by a transform or pinned to a corner (KAN-982).
const RISE = keyframes`
  from { opacity: 0; translate: 0 16px; }
  to { opacity: 1; translate: 0 0; }
`;

// KAN-982. The dim, and a dialog that must not move: PinGuide's arrow is
// fixed to Chrome's toolbar, and any translate on the dialog would carry it.
const FADE_IN = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

// KAN-654. A dialog rises into place as the review card does, and takes no pointer input until it lands.
export const dialogRiseCss = (hasRisen: boolean, travels = true) => css`
  animation: ${travels ? RISE : FADE_IN} ${DURATION.MOVE} ${EASE.OUT};
  pointer-events: ${hasRisen ? 'auto' : 'none'};
  &::backdrop {
    animation: ${FADE_IN} ${DURATION.MOVE} ${EASE.OUT};
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    &::backdrop {
      animation: none;
    }
  }
`;
