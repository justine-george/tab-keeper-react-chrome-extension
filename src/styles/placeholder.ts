import { css } from '@emotion/react';

// Chromium's default grey is under 4.5:1 on every theme.
export const placeholderStyle = (color: string) => css`
  &::placeholder {
    color: ${color};
    opacity: 1;
  }
`;
