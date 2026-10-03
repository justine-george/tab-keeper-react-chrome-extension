import { css, keyframes } from '@emotion/react';

// How long a carry rests on a target before it opens (KAN-350 S1 A); the sweep
// below runs for exactly this long, so the fill is full when the open fires.
export const SPRING_OPEN_MS = 600;

// The dwell fill grows across the row from the left (KAN-380).
const SPRING_SWEEP = keyframes`
  from {
    background-size: 0 100%;
  }
  to {
    background-size: 100% 100%;
  }
`;

// The dwell fill: `color` swept across the row over SPRING_OPEN_MS.
export const springSweepStyle = (color: string) => css`
  background-image: linear-gradient(${color}, ${color});
  background-repeat: no-repeat;
  background-size: 0 100%;
  animation: ${SPRING_SWEEP} ${SPRING_OPEN_MS}ms linear forwards;
`;
