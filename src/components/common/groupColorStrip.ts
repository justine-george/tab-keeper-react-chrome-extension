import { css } from '@emotion/react';

import { DURATION } from '../../styles/scale';

// How a group's colour strip eases when it widens (hover, an open picker,
// a drop target, KAN-164) and when it travels with its group's tabs
// (KAN-165). One fragment for the saved strip (GroupColorPicker) and Open
// now's (OpenNowWindow), so the two cannot drift apart (KAN-328: Open now's
// copy widened with no transition, so it jumped). Named properties, never
// the all keyword. Its own module rather than an export of
// GroupColorPicker.tsx, which only exports its component (react-refresh).
export const GROUP_STRIP_TRANSITION = css`
  transition-property: width, flex-basis, margin-right, transform;
  transition-duration: ${DURATION.COLOR};
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
`;
