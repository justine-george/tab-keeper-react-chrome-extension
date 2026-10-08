import { css } from '@emotion/react';

// Read by a screen reader, not drawn; the positioned parent keeps it inside.
export const visuallyHiddenStyle = css`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`;
