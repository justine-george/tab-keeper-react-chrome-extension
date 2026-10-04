import { css, keyframes } from '@emotion/react';

// How long a drag rests on a target before it opens: a session row's timer
// (KAN-350 S1 A), and a window title's sweep, which opens it as it ends.
export const SPRING_OPEN_MS = 600;

// The dwell fill grows across the row from the left (KAN-380); its `.name`
// is how the engine finds a window title's sweep (KAN-379).
export const SPRING_SWEEP = keyframes`
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
