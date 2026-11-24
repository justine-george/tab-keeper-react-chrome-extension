import { RefObject, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';

import { DURATION, EASE } from '../../styles/scale';
import { COACH_CARD_SHOWN } from './paneMotion';
import { SAVED_CARD_COLUMN_PX } from './opennow/railQuery';
import { hadUserInputWithin } from '../../utils/functions/recentUserInput';

type Phase = 'still' | 'arriving' | 'leaving';

// The grid's tracks as computed (all px), with the card's column `width` and
// the saved session's column taking up the difference.
function tracksWithCard(computed: string, width: number): string {
  const tracks = computed.split(' ');
  const card = parseFloat(tracks[1]);
  tracks[2] = `${parseFloat(tracks[2]) + card - width}px`;
  tracks[1] = `${width}px`;
  return tracks.join(' ');
}

const ms = (duration: string) => parseFloat(duration);

// What follows a press or key here: a save or delete, its undo, which may
// wait on Chrome. Sessions read in at load, or written by another page, come
// with no input here and change at once.
const AFTER_INPUT_MS = 2000;

// A fold's change is the fold's view transition; the rest as runPaneMotion has it.
const changesAtOnce = () =>
  typeof Element.prototype.animate !== 'function' ||
  !hadUserInputWithin(AFTER_INPUT_MS) ||
  document.documentElement.dataset.paneMove !== undefined ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.querySelector(COACH_CARD_SHOWN) !== null;

/**
 * KAN-999. Whether the folded saved session's card and its column are drawn:
 * `shows`, except that leaving, it stays drawn until it has moved. The first
 * save and the last delete (and their undos) bring and take the card with no
 * fold to move it, so it moves here: its column grows or shrinks over FOLD as
 * Currently open glides beside it, and the card fades in at the end or out at
 * the start, as in a fold. At once during a fold, under reduced motion, or
 * while a tour card is on screen.
 */
export function useSavedCardPresence(
  shows: boolean,
  grid: RefObject<HTMLElement | null>
): boolean {
  const [drawn, setDrawn] = useState(shows);
  const [phase, setPhase] = useState<Phase>('still');
  const [seen, setSeen] = useState(shows);
  // Before paint, so no frame draws the old answer. Not the render-phase
  // update React suggests: in MainContainer it left the store's later
  // changes unrendered (openNowFoldButton's peek test).
  useLayoutEffect(() => {
    if (shows === seen) return;
    const atOnce = changesAtOnce();
    /* eslint-disable react-hooks/set-state-in-effect -- see above */
    setSeen(shows);
    if (shows && drawn) {
      // Back while leaving (a delete undone at once): it stays, at once.
      setPhase('still');
    } else if (shows) {
      setDrawn(true);
      setPhase(atOnce ? 'still' : 'arriving');
    } else if (atOnce || !drawn) {
      setDrawn(false);
      setPhase('still');
    } else {
      setPhase('leaving');
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [shows, seen, drawn]);

  useLayoutEffect(() => {
    const el = grid.current;
    if (phase === 'still' || el === null) return;
    const card = el.querySelector('[data-saved-session-card]');
    const now = getComputedStyle(el).gridTemplateColumns;
    const arriving = phase === 'arriving';
    const column = el.animate(
      {
        gridTemplateColumns: arriving
          ? [tracksWithCard(now, 0), tracksWithCard(now, SAVED_CARD_COLUMN_PX)]
          : [now, tracksWithCard(now, 0)],
      },
      {
        duration: ms(DURATION.FOLD),
        easing: EASE.IN_OUT,
        fill: arriving ? 'none' : 'forwards',
      }
    );
    const fade = card?.animate(
      { opacity: arriving ? [0, 1] : [1, 0] },
      {
        duration: ms(DURATION.HANDOFF),
        delay: arriving ? ms(DURATION.FOLD) - ms(DURATION.HANDOFF) : 0,
        easing: 'ease-out',
        fill: arriving ? 'backwards' : 'forwards',
      }
    );
    column.onfinish = () => {
      // Gone before the column's hold is dropped, so nothing shows between.
      flushSync(() => {
        if (!arriving) setDrawn(false);
        setPhase('still');
      });
    };
    return () => {
      column.cancel();
      fade?.cancel();
    };
  }, [phase, grid]);

  return drawn;
}
