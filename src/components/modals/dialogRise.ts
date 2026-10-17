import { css, keyframes } from '@emotion/react';

import { DURATION, EASE } from '../../styles/scale';

// From 16px low to centre: the dialogs are centred by this same translate.
const RISE = keyframes`
  from { opacity: 0; transform: translate(-50%, calc(-50% + 16px)); }
  to { opacity: 1; transform: translate(-50%, -50%); }
`;

// KAN-654. A centred dialog rises into place as the review card does, and takes no pointer input until it lands.
export const dialogRiseCss = (hasRisen: boolean) => css`
  animation: ${RISE} ${DURATION.MOVE} ${EASE.OUT};
  pointer-events: ${hasRisen ? 'auto' : 'none'};
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
