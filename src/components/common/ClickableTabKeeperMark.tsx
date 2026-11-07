import { useEffect, useRef, type MouseEvent } from 'react';
import { css } from '@emotion/react';

import TabKeeperMark from './TabKeeperMark';
import { playMarkClick, playMarkSave } from './tabKeeperMarkMotion';
import type { Motion } from '../modals/getStartedMotion';
import { ICON } from '../../styles/scale';
import {
  playShutterClick,
  prepareShutterClick,
} from '../../utils/functions/uiSound';

// The mark, which a click presses, slides its shutter, and clicks as the shutter shuts (KAN-431, KAN-521).
// Pointer only: it stays decorative, so there is no role, tab stop or key handler.
export default function ClickableTabKeeperMark({
  markSize = ICON.SMALL,
  boxSize = markSize,
  shutterOnMountAfterMs,
  saveCount,
}: {
  markSize?: string;
  // The clickable square the mark is centred in.
  boxSize?: string;
  // KAN-653. Plays the shutter once, silently, this long after mounting: the
  // review card's mark, as the card finishes rising.
  shutterOnMountAfterMs?: number;
  // KAN-388. Sessions saved so far: each rise after mounting slides the shutter.
  saveCount?: number;
}) {
  const playing = useRef<Motion | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => () => playing.current?.cancel(), []);

  useEffect(() => {
    if (shutterOnMountAfterMs === undefined) return;
    const timer = setTimeout(() => {
      const mark = box.current?.querySelector('svg');
      if (!mark || playing.current !== null) return;
      // No beat: a sound nobody pressed for would startle.
      const motion = playMarkClick(
        mark,
        mark.querySelector('[data-mark-part="shutter"]')
      );
      if (motion === null) return;
      playing.current = motion;
      void motion.finished.then(() => {
        if (playing.current === motion) playing.current = null;
      });
    }, shutterOnMountAfterMs);
    return () => clearTimeout(timer);
  }, [shutterOnMountAfterMs]);

  const savesSeen = useRef(saveCount);
  useEffect(() => {
    if (saveCount === undefined || saveCount === savesSeen.current) return;
    savesSeen.current = saveCount;
    const shutter = box.current?.querySelector('[data-mark-part="shutter"]');
    if (!shutter) return;
    // A save while anything plays starts over from rest.
    playing.current?.cancel();
    const motion = playMarkSave(shutter);
    playing.current = motion;
    if (motion === null) return;
    void motion.finished.then(() => {
      if (playing.current === motion) playing.current = null;
    });
  }, [saveCount]);

  const play = (event: MouseEvent<HTMLDivElement>) => {
    if (playing.current !== null) return;
    const mark = event.currentTarget.querySelector('svg');
    if (mark === null) return;
    const motion = playMarkClick(
      mark,
      mark.querySelector('[data-mark-part="shutter"]'),
      { onShutterStart: prepareShutterClick, onShutterShut: playShutterClick }
    );
    // Nothing is drawn, so the click sounds at the press.
    if (motion === null) {
      playShutterClick();
      return;
    }
    playing.current = motion;
    void motion.finished.then(() => {
      if (playing.current === motion) playing.current = null;
    });
  };

  return (
    <div
      ref={box}
      onClick={play}
      css={css`
        width: ${boxSize};
        height: ${boxSize};
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        /* KAN-524. A click plays it, so it shows a pointer like every clickable thing. */
        cursor: pointer;
      `}
    >
      <TabKeeperMark size={markSize} />
    </div>
  );
}
