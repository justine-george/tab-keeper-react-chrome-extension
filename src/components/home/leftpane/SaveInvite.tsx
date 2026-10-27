import { useEffect, useRef, useState } from 'react';

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

  /* The hover and focus rules stop it in the same frame; data-still keeps it stopped after. */
  button:hover + &::before,
  button:focus + &::before,
  &[data-still]::before,
  &[data-unseen]::before {
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

const isInView = () => document.visibilityState === 'visible';

// One empty state's ring: a hover or focus on the button stills it until it unmounts.
function Ring() {
  const ref = useRef<HTMLSpanElement>(null);
  const [isStill, setStill] = useState(false);
  // A hidden tab runs the pulse unseen, so it plays each time the page comes into view.
  const [timesInView, setTimesInView] = useState(() => (isInView() ? 1 : 0));
  useEffect(() => {
    const onVisibility = () => {
      if (isInView()) setTimesInView((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
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
      // A new span is a new CSS animation: three pulses from the start.
      key={timesInView}
      ref={ref}
      data-save-invite=""
      data-still={isStill ? '' : undefined}
      data-unseen={timesInView === 0 ? '' : undefined}
      aria-hidden="true"
      css={inviteStyle}
    />
  );
}

// KAN-828. A mint ring on the save button while nothing is saved: three pulses, then still.
export default function SaveInvite() {
  return useSaveInvite() ? <Ring /> : null;
}
