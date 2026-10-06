import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ICON, RADIUS } from '../../styles/scale';

// Geometry from the approved mock, in px: the hero is a drawing, not text.
const HERO = {
  HEIGHT: 210,
  WIN_W: 170,
  WIN_H: 140,
  WIN_TOP: 34,
  WIN_INSET: 28,
  BAR: 22,
  CHIP_W: 44,
  CHIP_H: 16,
  CHIP_STEP: 50,
  FLOPPY: 72,
} as const;
const LINE_WIDTHS = [120, 96, 130, 80] as const;

// §5's wordless loop: tabs saved into the floppy and back out. Still, it shows its end frame.
export default function WelcomeHero({ frame }: { frame: 'start' | 'end' }) {
  const COLORS = useThemeColors();
  const isEnd = frame === 'end';
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
    border: 1px solid ${COLORS.BORDER_COLOR};
    box-sizing: border-box;
  `;
  const barStyle = css`
    height: ${HERO.BAR}px;
    background-color: ${COLORS.SELECTION_COLOR};
  `;
  const chipStyle = css`
    position: absolute;
    top: ${HERO.WIN_TOP + 5}px;
    width: ${HERO.CHIP_W}px;
    height: ${HERO.CHIP_H}px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
  `;
  const chipDotStyle = css`
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: ${RADIUS.CIRCLE};
    background-color: ${COLORS.LABEL_L3_COLOR};
  `;
  const chipLineStyle = css`
    flex: 1;
    height: 2px;
    background-color: ${COLORS.LABEL_L2_COLOR};
  `;
  const lineStyle = css`
    position: absolute;
    height: 4px;
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
    background-color: ${COLORS.TEXT_COLOR};
  `;
  const floppyPart = (rules: string, color: string) => css`
    position: absolute;
    ${rules}
    background-color: ${color};
  `;
  const checkStyle = css`
    position: absolute;
    left: 50%;
    top: calc(50% + 44px);
    transform: translateX(-50%);
    opacity: 0;
  `;
  // Chips sit in the left window at the start and in the right one at the end.
  const chipPlace = (i: number) =>
    isEnd
      ? {
          right:
            HERO.WIN_INSET + HERO.WIN_W - 6 - i * HERO.CHIP_STEP - HERO.CHIP_W,
        }
      : { left: HERO.WIN_INSET + 6 + i * HERO.CHIP_STEP };
  const lineTop = (i: number) => HERO.WIN_TOP + 40 + i * 20;

  return (
    <div aria-hidden="true" data-hero-frame={frame} css={heroStyle}>
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
            left: HERO.WIN_INSET + 14,
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
            right: HERO.WIN_INSET + HERO.WIN_W - 14 - width,
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
        <span
          css={floppyPart(
            'left: 16px; right: 16px; top: 4px; height: 22px;',
            COLORS.PRIMARY_COLOR
          )}
        />
        <span
          data-hero-part="shutter"
          css={floppyPart(
            'left: 38px; top: 6px; width: 12px; height: 18px;',
            COLORS.LABEL_L3_COLOR
          )}
        />
        <span
          css={floppyPart(
            'left: 12px; right: 12px; bottom: 6px; height: 26px;',
            COLORS.PRIMARY_COLOR
          )}
        />
      </div>
      <span data-hero-part="check" css={checkStyle}>
        <Icon type="check" size={ICON.SMALL} color={COLORS.TEXT_COLOR} />
      </span>
    </div>
  );
}
