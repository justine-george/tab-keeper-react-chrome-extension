import { css } from '@emotion/react';
import { useTranslation } from 'react-i18next';

import Icon from '../common/Icon';
import { focusRingCss } from '../common/focusRing';
import { useThemeColors } from '../../hooks/useThemeColors';
import { DURATION, ICON, RADIUS } from '../../styles/scale';
import { WELCOME_LOOP, heroPx } from './welcomeMotion';

// Geometry from the approved mock, in px, at heroPx's scale: the hero is a drawing, not text.
const HERO = {
  HEIGHT: heroPx(210),
  WIN_W: heroPx(170),
  WIN_H: heroPx(140),
  WIN_TOP: heroPx(34),
  WIN_INSET: heroPx(28),
  BAR: heroPx(22),
  CHIP_W: heroPx(44),
  CHIP_H: heroPx(16),
  CHIP_STEP: WELCOME_LOOP.CHIP_STEP_PX,
  FLOPPY: heroPx(72),
} as const;
const LINE_WIDTHS = [120, 96, 130, 80].map(heroPx);

// §5's wordless loop: tabs saved into the floppy and back out. Still, it shows its end frame.
// An animated hero offers Play again once its loop rests (KAN-464).
export default function WelcomeHero({
  frame,
  isResting = false,
  onReplay,
}: {
  frame: 'start' | 'end';
  isResting?: boolean;
  onReplay?: () => void;
}) {
  const { t } = useTranslation();
  const COLORS = useThemeColors();
  const isEnd = frame === 'end';
  const drawingStyle = css`
    position: absolute;
    inset: 0;
  `;
  const replayStyle = css`
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background-color: transparent;
    cursor: pointer;
    transition:
      opacity 150ms ease-out,
      visibility 0s,
      background-color ${DURATION.COLOR};
    &:hover {
      background-color: ${COLORS.ICON_HOVER_COLOR};
    }
    &:active {
      background-color: ${COLORS.ICON_ACTIVE_COLOR};
    }
    &:not([data-resting]) {
      opacity: 0;
      visibility: hidden;
      transition:
        opacity 150ms ease-out,
        visibility 0s linear 150ms;
    }
    ${focusRingCss(COLORS)}
  `;
  const heroStyle = css`
    position: relative;
    height: ${HERO.HEIGHT}px;
    margin: 0 0 14px 0;
    overflow: hidden;
    border: 1px solid ${COLORS.DIVIDER_COLOR};
    background-color: ${COLORS.SECONDARY_COLOR};
  `;
  const windowStyle = (side: 'left' | 'right') => css`
    position: absolute;
    top: ${HERO.WIN_TOP}px;
    ${side}: ${HERO.WIN_INSET}px;
    width: ${HERO.WIN_W}px;
    height: ${HERO.WIN_H}px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    box-sizing: border-box;
  `;
  const barStyle = css`
    height: ${HERO.BAR}px;
    background-color: ${COLORS.SELECTION_COLOR};
  `;
  const chipStyle = css`
    position: absolute;
    top: ${HERO.WIN_TOP + heroPx(5)}px;
    width: ${HERO.CHIP_W}px;
    height: ${HERO.CHIP_H}px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: ${heroPx(3)}px;
    padding: 0 ${heroPx(4)}px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
  `;
  const chipDotStyle = css`
    flex: none;
    width: ${heroPx(7)}px;
    height: ${heroPx(7)}px;
    border-radius: ${RADIUS.CIRCLE};
    background-color: ${COLORS.LABEL_L3_COLOR};
  `;
  const chipLineStyle = css`
    flex: 1;
    height: ${heroPx(2)}px;
    background-color: ${COLORS.LABEL_L2_COLOR};
  `;
  const lineStyle = css`
    position: absolute;
    height: ${heroPx(4)}px;
    background-color: ${COLORS.LABEL_L2_COLOR};
    transform-origin: left center;
  `;
  const floppyStyle = css`
    position: absolute;
    left: 50%;
    top: 50%;
    width: ${HERO.FLOPPY}px;
    height: ${HERO.FLOPPY}px;
    margin: -${HERO.FLOPPY / 2}px 0 0 -${HERO.FLOPPY / 2}px;
    background-color: ${COLORS.FLOPPY_BODY_COLOR};
  `;
  const floppyPart = (rules: string, color: string) => css`
    position: absolute;
    ${rules}
    background-color: ${color};
  `;
  const checkStyle = css`
    position: absolute;
    left: 50%;
    top: calc(50% + ${heroPx(44)}px);
    transform: translateX(-50%);
    opacity: 0;
  `;
  // Chips sit in the left window at the start and in the right one at the end.
  const chipPlace = (i: number) =>
    isEnd
      ? {
          right:
            HERO.WIN_INSET +
            HERO.WIN_W -
            heroPx(6) -
            i * HERO.CHIP_STEP -
            HERO.CHIP_W,
        }
      : { left: HERO.WIN_INSET + heroPx(6) + i * HERO.CHIP_STEP };
  const lineTop = (i: number) => HERO.WIN_TOP + heroPx(40) + i * heroPx(20);

  return (
    <div data-hero-frame={frame} css={heroStyle}>
      <div aria-hidden="true" css={drawingStyle}>
        <div data-hero-part="window-left" css={windowStyle('left')}>
          <div css={barStyle} />
        </div>
        <div data-hero-part="window-right" css={windowStyle('right')}>
          <div css={barStyle} />
        </div>
        {LINE_WIDTHS.map((width, i) => (
          <span
            key={`left-${width}`}
            data-hero-part="line-left"
            css={lineStyle}
            style={{
              left: HERO.WIN_INSET + heroPx(14),
              top: lineTop(i),
              width,
              opacity: isEnd ? 0.15 : 1,
            }}
          />
        ))}
        {LINE_WIDTHS.map((width, i) => (
          <span
            key={`right-${width}`}
            data-hero-part="line-right"
            css={lineStyle}
            style={{
              right: HERO.WIN_INSET + HERO.WIN_W - heroPx(14) - width,
              top: lineTop(i),
              width,
              opacity: isEnd ? 1 : 0,
            }}
          />
        ))}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            data-hero-part="chip"
            css={chipStyle}
            style={chipPlace(i)}
          >
            <i css={chipDotStyle} />
            <b css={chipLineStyle} />
          </span>
        ))}
        <div data-hero-part="floppy" css={floppyStyle}>
          {/* KAN-627. The slot is cut into the shutter, so the two slide as one. */}
          <span
            data-hero-part="shutter"
            css={floppyPart(
              `left: ${heroPx(16)}px; top: ${heroPx(4)}px; width: ${heroPx(40)}px; height: ${heroPx(22)}px;`,
              COLORS.FLOPPY_PART_COLOR
            )}
          >
            <span
              data-hero-part="slot"
              css={floppyPart(
                `left: ${heroPx(22)}px; top: ${heroPx(2)}px; width: ${heroPx(12)}px; height: ${heroPx(18)}px;`,
                COLORS.LABEL_L3_COLOR
              )}
            />
          </span>
          <span
            css={floppyPart(
              `left: ${heroPx(12)}px; right: ${heroPx(12)}px; bottom: ${heroPx(6)}px; height: ${heroPx(26)}px;`,
              COLORS.FLOPPY_PART_COLOR
            )}
          />
        </div>
        <span data-hero-part="check" css={checkStyle}>
          <Icon type="check" size={ICON.SMALL} color={COLORS.TEXT_COLOR} />
        </span>
      </div>
      {onReplay && frame === 'start' && (
        <button
          type="button"
          css={replayStyle}
          data-resting={isResting ? '' : undefined}
          aria-label={t('Play again')}
          onClick={onReplay}
        >
          <Icon
            type="replay"
            size={ICON.XSMALL}
            color={COLORS.LABEL_L2_COLOR}
          />
        </button>
      )}
    </div>
  );
}
