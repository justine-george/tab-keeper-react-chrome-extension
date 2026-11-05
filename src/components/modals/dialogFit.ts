import { trackClearOfCorners } from '../../styles/corners';
import { RADIUS } from '../../styles/scale';

// KAN-803. A dialog taller than the window scrolls inside it; `reservedPx` is the window height it leaves free.
export const dialogFitsWindow = (reservedPx = 32): string => `
  max-height: calc(100% - ${reservedPx}px);
  overflow: auto;
  ${trackClearOfCorners(RADIUS.DIALOG, ['top', 'bottom'])}
`;
