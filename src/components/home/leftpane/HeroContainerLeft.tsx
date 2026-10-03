import { useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/react';

import MenuContainer from './MenuContainer';
import TabKeeperMark from '../../common/TabKeeperMark';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from 'react-i18next';
import { ICON, TYPE } from '../../../styles/scale';

// Out of sight, still read by assistive tech (KAN-343 B).
const visuallyHiddenStyle = css`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`;

// The words' width, never hidden; its text is CSS content so it is not a second copy of the name.
const rulerStyle = css`
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
  &::before {
    content: attr(data-words);
  }
`;

export default function HeroContainer() {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const name = t('Tab Keeper');

  const room = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLSpanElement>(null);
  const [wordsFit, setWordsFit] = useState(true);

  // Neither measure moves when the words hide: the ruler never hides, and the room's width comes from flex, not its content.
  useLayoutEffect(() => {
    const roomEl = room.current;
    const rulerEl = ruler.current;
    if (!roomEl || !rulerEl) return;
    const measure = () =>
      setWordsFit(
        rulerEl.getBoundingClientRect().width <=
          roomEl.getBoundingClientRect().width
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(roomEl);
    observer.observe(rulerEl);
    return () => observer.disconnect();
  }, []);

  const containerStyle = css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.TITLE};
    /* No fixed height: a pane header is not a control, it is content
       plus padding, and giving it a control height is what put 32px of
       icons inside a 64px box with half of it empty.

       12px against the pane's 8px sides. 8px was tried and read as
       tight; 16px is what it was, and that is the floating look. */
    padding: 12px 0px;
    user-select: none;
  `;

  const wordsStyle = css`
    flex: none;
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.SECTION};
    color: ${COLORS.TEXT_COLOR};
    white-space: nowrap;
  `;

  return (
    <div css={containerStyle}>
      <div
        css={css`
          flex: 1 1 0;
          min-width: 0;
          display: flex;
          align-items: center;
        `}
      >
        <div
          css={css`
            width: calc(${ICON.DEFAULT} + 8px);
            height: calc(${ICON.DEFAULT} + 8px);
            display: flex;
            align-items: center;
            justify-content: center;
            flex: none;
          `}
        >
          <TabKeeperMark />
        </div>
        <div
          ref={room}
          css={css`
            flex: 1 1 0;
            min-width: 0;
            align-self: stretch;
            position: relative;
            /* An overlong ruler must not scroll the page. */
            overflow: hidden;
            display: flex;
            align-items: center;
          `}
        >
          <span css={[wordsStyle, !wordsFit && visuallyHiddenStyle]}>
            {name}
          </span>
          <span
            ref={ruler}
            aria-hidden="true"
            data-words={name}
            css={[wordsStyle, rulerStyle]}
          />
        </div>
      </div>
      <div
        css={css`
          flex-shrink: 0;
        `}
      >
        <MenuContainer />
      </div>
    </div>
  );
}
