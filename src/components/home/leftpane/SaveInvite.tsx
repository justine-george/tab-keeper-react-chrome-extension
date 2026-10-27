import { useSelector } from 'react-redux';

import { css, keyframes } from '@emotion/react';

import { useIsSavedListEmpty } from '../../../hooks/useIsSavedListEmpty';
import { selectRunHere } from '../../../redux/firstRun';
import { DURATION, EASE } from '../../../styles/scale';

// The save group's wide segment: the save button and the ring over it share it.
export const SAVE_SEGMENT_WIDTH = '58px';

// The mark's tile (TabKeeperMark), at full strength.
const MINT = '#99bf9d';
const RING = `0 0 0 2px ${MINT}`;

// Transform and opacity only, so the compositor runs it with no repaint (KAN-828).
const PULSE = keyframes`
  from { transform: scale(1); opacity: 0.9; }
  to { transform: scale(1.45); opacity: 0; }
`;

const inviteStyle = css`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: ${SAVE_SEGMENT_WIDTH};
  z-index: 1;
  pointer-events: none;
  box-shadow: ${RING};

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    box-shadow: ${RING};
    opacity: 0;
    animation: ${PULSE} ${DURATION.INVITE} ${EASE.OUT} 3;
  }

  button:hover + &::before,
  button:focus + &::before {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    &::before {
      animation: none;
    }
  }
`;

// Shown while the empty line is, unless the tour is on this page with its own save step.
export function useSaveInvite(): boolean {
  const isEmpty = useIsSavedListEmpty();
  const isRunHere = useSelector(selectRunHere) !== null;
  return isEmpty && !isRunHere;
}

// KAN-828. A mint ring on the save button while nothing is saved: three pulses, then still.
export default function SaveInvite() {
  if (!useSaveInvite()) return null;
  return <span data-save-invite="" aria-hidden="true" css={inviteStyle} />;
}
