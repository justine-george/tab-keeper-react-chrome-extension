import { useEffect, useRef, type MouseEvent } from 'react';
import { css } from '@emotion/react';

import TabKeeperMark from './TabKeeperMark';
import { playMarkClick } from './tabKeeperMarkMotion';
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
}: {
  markSize?: string;
  // The clickable square the mark is centred in.
  boxSize?: string;
  // KAN-653. Plays the shutter once, silently, this long after mounting: the
  // review card's mark, as the card finishes rising.
  shutterOnMountAfterMs?: number;
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
        playing.current = null;
      });
    }, shutterOnMountAfterMs);
    return () => clearTimeout(timer);
  }, [shutterOnMountAfterMs]);

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
      playing.current = null;
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
