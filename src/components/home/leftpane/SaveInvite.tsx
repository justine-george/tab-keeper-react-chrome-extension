import { useEffect, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css, keyframes } from '@emotion/react';

import { useIsSavedListEmpty } from '../../../hooks/useIsSavedListEmpty';
import { selectRunHere } from '../../../redux/firstRun';
import { markHadSavedSession } from '../../../redux/slices/settingsDataStateSlice';
import type { RootState } from '../../../redux/store';
import { isSampleSession } from '../../../utils/functions/sampleSession';
import { flushIn } from '../../../styles/corners';
import { DURATION, EASE, RADIUS } from '../../../styles/scale';

// The save group's wide segment: the save button and the ring over it share it.
export const SAVE_SEGMENT_WIDTH = '58px';

// KAN-913. The save half's corners, for the button and the ring over it: rounded where the group rounds, square where ⋮ joins.
export const SAVE_SEGMENT_CORNERS = flushIn(
  ['top-left', 'bottom-left'],
  RADIUS.SQUARE
);

// The mark's tile (TabKeeperMark), at full strength.
const MINT = '#99bf9d';
const RING = `0 0 0 2px ${MINT}`;

// Transform and opacity only, so the compositor runs it with no repaint (KAN-828).
// KAN-875. One pulse, then still for the rest of the cycle.
const PULSE_END = `${(100 * parseFloat(DURATION.INVITE)) / parseFloat(DURATION.INVITE_CYCLE)}%`;
const PULSE = keyframes`
  0% { transform: scale(1); opacity: 0.9; }
  ${PULSE_END}, 100% { transform: scale(1.45); opacity: 0; }
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
  ${SAVE_SEGMENT_CORNERS}

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    box-shadow: ${RING};
    ${SAVE_SEGMENT_CORNERS}
    opacity: 0;
    animation: ${PULSE} ${DURATION.INVITE_CYCLE} ${EASE.OUT} infinite;
  }

  /* The hover and focus rules stop it in the same frame; data-still keeps it stopped after. */
  button:hover + &::before,
  button:focus + &::before,
  &[data-still]::before {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    &::before {
      animation: none;
    }
  }
`;

// Shown while the empty line is, unless the tour is on this page with its own save step,
// or this device's list has ever held a session of the user's (his call, 2026-10-27 02:26).
export function useSaveInvite(): boolean {
  const dispatch = useDispatch();
  const isEmpty = useIsSavedListEmpty();
  const isRunHere = useSelector(selectRunHere) !== null;
  const holdsUsersSession = useSelector((state: RootState) =>
    state.tabContainerDataState.tabGroups.some(
      (g) => !isSampleSession(g.tabGroupId)
    )
  );
  const hasHadSavedSession = useSelector(
    (state: RootState) => state.settingsDataState.hasHadSavedSession
  );
  useEffect(() => {
    if (holdsUsersSession && !hasHadSavedSession) {
      dispatch(markHadSavedSession());
    }
  }, [dispatch, holdsUsersSession, hasHadSavedSession]);
  return isEmpty && !isRunHere && !hasHadSavedSession;
}

// One empty state's ring: a hover or focus on the button stills it until it unmounts.
function Ring() {
  const ref = useRef<HTMLSpanElement>(null);
  const [isStill, setStill] = useState(false);
  useEffect(() => {
    const button = ref.current?.previousElementSibling;
    if (!button) return;
    const still = () => setStill(true);
    button.addEventListener('pointerenter', still);
    button.addEventListener('focus', still);
    return () => {
      button.removeEventListener('pointerenter', still);
      button.removeEventListener('focus', still);
    };
  }, []);
  return (
    <span
      ref={ref}
      data-save-invite=""
      data-still={isStill ? '' : undefined}
      aria-hidden="true"
      css={inviteStyle}
    />
  );
}

// KAN-828. A mint ring on the save button while nothing is saved: it pulses every 4 s until the first save (KAN-875).
export default function SaveInvite() {
  return useSaveInvite() ? <Ring /> : null;
}
