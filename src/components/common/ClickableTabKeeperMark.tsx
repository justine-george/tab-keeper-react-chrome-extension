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
}: {
  markSize?: string;
  // The clickable square the mark is centred in.
  boxSize?: string;
}) {
  const playing = useRef<Motion | null>(null);

  useEffect(() => () => playing.current?.cancel(), []);

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
      onClick={play}
      css={css`
        width: ${boxSize};
        height: ${boxSize};
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
      `}
    >
      <TabKeeperMark size={markSize} />
    </div>
  );
}
