import { css, type SerializedStyles } from '@emotion/react';
import type { ReactNode } from 'react';

import { useThemeColors } from '../../../hooks/useThemeColors';
import { focusRingOutsideCss } from '../../common/focusRing';
import Icon from '../../common/Icon';
import { slidingPairColors } from '../../common/slidingPairColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { DURATION, RADIUS, TYPE } from '../../../styles/scale';
import { corners } from '../../../styles/corners';

/**
 * A picture tile with its name underneath, for a choice shown by example: a
 * theme (KAN-237), a toolbar icon (KAN-932).
 *
 * The button holds the tile AND the name, so the name is the control's
 * accessible name -- KAN-64's rule -- and the whole thing is the hit target.
 * The tile is aria-hidden: it is a picture of the name.
 *
 * SELECTION MARKER (KAN-398): the tile's own 1px frame, thickened to 2px in the
 * PAGE's LABEL_L1 (6.58-8.03:1), plus the language list's check on a knob
 * square at the tile's corner. The frame alone reads like the hover frame
 * (LABEL_L2); the check separates them. border-box keeps the tile's size and
 * the check is absolutely placed, so the row never reflows.
 *
 * HOVER AND PRESS move an unselected frame's colour a rung, not the tile's
 * fill: the tile's colours are the information. The current tile's frame
 * stays put under the pointer.
 */
const TILE_WIDTH_PX = 72;
const TILE_HEIGHT_PX = 52;

interface SwatchButtonProps {
  /** Translated. Shown under the tile, and the button's accessible name. */
  name: string;
  isActive: boolean;
  onSelect: () => void;
  background: string;
  /** How the tile lays out its picture. */
  tileCss: SerializedStyles;
  describedBy?: string;
  children: ReactNode;
}

export default function SwatchButton({
  name,
  isActive,
  onSelect,
  background,
  tileCss,
  describedBy,
  children,
}: SwatchButtonProps) {
  // The PAGE's colours, for the frame, the marker and the name: those are
  // read against the page the picker sits on, not against the tile.
  const PAGE = useThemeColors();
  const FONT_FAMILY = useFontFamily();

  const buttonStyle = css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    font-family: ${FONT_FAMILY};
    color: ${PAGE.LABEL_L1_COLOR};
    ${focusRingOutsideCss(PAGE)}
  `;

  const tileStyle = css`
    display: flex;
    width: ${TILE_WIDTH_PX}px;
    height: ${TILE_HEIGHT_PX}px;
    overflow: hidden;
    background-color: ${background};
    border: 1px solid ${PAGE.PANEL_BORDER_COLOR};
    /* KAN-904. A little popup: a panel's corner. */
    ${corners(RADIUS.PANEL)}
    transition: border-color ${DURATION.COLOR};
    ${
      isActive
        ? `border-color: ${PAGE.LABEL_L1_COLOR}; border-width: 2px;`
        : /* Named properties, never the all keyword; only the colour moves. */
          `button:hover & { border-color: ${PAGE.LABEL_L2_COLOR}; }
           button:active & { border-color: ${PAGE.LABEL_L1_COLOR}; }`
    }
  `;

  // The tile's box, so the check can hang off its corner: the tile clips.
  const holderStyle = css`
    position: relative;
    display: block;
  `;

  const { knob, labelOnKnob } = slidingPairColors(PAGE);
  // A page-coloured ring keeps the knob readable over any tile.
  const checkStyle = css`
    position: absolute;
    top: -6px;
    right: -6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background-color: ${knob};
    box-shadow: 0 0 0 2px ${PAGE.PRIMARY_COLOR};
    /* A small mark: round (KAN-721). */
    border-radius: ${RADIUS.MARK};
  `;

  const nameStyle = css`
    font-size: ${TYPE.SECONDARY};
    line-height: 1.2;
    font-weight: ${isActive ? 600 : 400};
    white-space: nowrap;
  `;

  return (
    <button
      type="button"
      aria-pressed={isActive}
      aria-describedby={describedBy}
      onClick={onSelect}
      css={buttonStyle}
    >
      <span aria-hidden="true" css={holderStyle}>
        <span aria-hidden="true" data-swatch-tile css={[tileStyle, tileCss]}>
          {children}
        </span>
        {isActive && (
          <span data-swatch-check css={checkStyle}>
            <Icon
              type="check"
              size="12px"
              color={labelOnKnob}
              style="padding: 0;"
            />
          </span>
        )}
      </span>
      <span css={nameStyle}>{name}</span>
    </button>
  );
}
