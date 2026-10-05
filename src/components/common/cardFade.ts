import { css, keyframes } from '@emotion/react';

import { DURATION, EASE } from '../../styles/scale';

const FADE_IN = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

// The callout and the rate prompt fade in as they appear; reduced motion shows them at once.
export const cardFadeIn = css`
  animation: ${FADE_IN} ${DURATION.COLOR} ${EASE.OUT};
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
