import { css, keyframes } from '@emotion/react';

import { DURATION, EASE } from '../../styles/scale';

const FADE_IN = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

// The rate prompt fades in as it appears; reduced motion shows it at once.
export const cardFadeIn = css`
  animation: ${FADE_IN} ${DURATION.COLOR} ${EASE.OUT};
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
