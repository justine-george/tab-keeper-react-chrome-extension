import { useEffect, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';

import { css } from '@emotion/react';

import { setFirstSavePopping } from '../../../redux/slices/globalStateSlice';
import type { RootState } from '../../../redux/store';
import { DURATION, EASE } from '../../../styles/scale';
import {
  popPieces,
  type PopPiece,
} from '../../../utils/functions/firstSavePop';
import {
  canAnimate,
  prefersReducedMotion,
} from '../../modals/getStartedMotion';
import { SAVE_SEGMENT_WIDTH } from './SaveInvite';

// A 0×0 point at the save button's centre: the pieces fly out from it, over the panes.
const anchorStyle = css`
  position: absolute;
  left: calc(${SAVE_SEGMENT_WIDTH} / 2);
  top: 50%;
  width: 0;
  height: 0;
  overflow: visible;
  z-index: 2;
  pointer-events: none;
`;

const pieceStyle = (p: PopPiece) => css`
  position: absolute;
  left: ${-p.width / 2}px;
  top: ${-p.height / 2}px;
  width: ${p.width}px;
  height: ${p.height}px;
`;

// TabKeeperMark's floppy without its tile, in the mark's colours.
function Disk() {
  const body = 'M15.2 12.6h12.4v3l5 1.3V13h66.6l14.5 14.5v84.3H15.2z';
  return (
    <svg viewBox="0 0 128 128" width="100%" height="100%" focusable="false">
      <path d={body} transform="translate(1.7 3.6)" fill="#253038" />
      <path d={body} fill="#445562" />
      <rect
        x="32.8"
        y="12.9"
        width="58.4"
        height="34.7"
        rx="1.5"
        fill="#f4eae2"
      />
      <rect
        x="71.3"
        y="18.4"
        width="15.3"
        height="26.6"
        rx="1"
        fill="#20292e"
      />
      <rect x="32.9" y="64.8" width="62.5" height="47" rx="2" fill="#f4eae2" />
      <path fill="#d09263" d="M42.9 87.1h42.8v7.5H42.9zm0 12h42.8v7.3H42.9z" />
    </svg>
  );
}

const ms = (duration: string) => parseFloat(duration);

// Transform and opacity only, on the compositor (KAN-828): the travel eases to a stop, the fade ends it.
function play(el: Element, p: PopPiece): Animation[] {
  const total = ms(DURATION.FIRST_SAVE_POP);
  const fade = ms(DURATION.FIRST_SAVE_POP_FADE);
  return [
    el.animate(
      [
        { transform: 'translate(0, 0) rotate(0turn)' },
        { transform: `translate(${p.dx}px, ${p.dy}px) rotate(${p.turn}turn)` },
      ],
      { duration: total, easing: EASE.OUT, fill: 'forwards' }
    ),
    el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: fade,
      delay: total - fade,
      fill: 'forwards',
    }),
  ];
}

// KAN-875. The first session saved on this device pops floppy disks from the save button.
export default function FirstSavePop() {
  const dispatch = useDispatch();
  const pops = useSelector(
    (state: RootState) => state.globalState.firstSavePops
  );
  // A page that opens after the first save has nothing to celebrate.
  const [played, setPlayed] = useState(pops);
  const [pieces, setPieces] = useState<PopPiece[] | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  if (pops !== played) {
    setPlayed(pops);
    // No Web Animations (jsdom, or an old engine): no pop, and nothing held.
    if (pops > played && !prefersReducedMotion() && canAnimate(document.body)) {
      setPieces(popPieces(Math.random));
    }
  }

  useEffect(() => {
    const els = [...(ref.current?.querySelectorAll('[data-pop-piece]') ?? [])];
    if (!pieces || els.length === 0) return;
    dispatch(setFirstSavePopping(true));
    let isPlaying = true;
    const running = els.flatMap((el, i) => play(el, pieces[i]));
    Promise.all(running.map((a) => a.finished)).then(
      () => {
        if (isPlaying) setPieces(null);
      },
      // Cancelled: the cleanup below already let the card go.
      () => {}
    );
    return () => {
      isPlaying = false;
      running.forEach((a) => a.cancel());
      dispatch(setFirstSavePopping(false));
    };
  }, [dispatch, pieces]);

  if (!pieces) return null;
  return (
    <span ref={ref} data-first-save-pop="" aria-hidden="true" css={anchorStyle}>
      {pieces.map((p, i) => (
        <span key={i} data-pop-piece={p.kind} css={pieceStyle(p)}>
          {p.kind === 'disk' ? (
            <Disk />
          ) : (
            <span
              css={css`
                display: block;
                width: 100%;
                height: 100%;
                background: ${p.colour};
              `}
            />
          )}
        </span>
      ))}
    </span>
  );
}
