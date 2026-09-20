import { css } from '@emotion/react';

import { ThemeColors, useThemeColors } from '../../../hooks/useThemeColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import { DURATION, TYPE } from '../../../styles/scale';

/**
 * One theme in the picker: a miniature of the popup drawn from that theme's
 * own tokens, with its name underneath (KAN-237).
 *
 * It was a flat 60x50 swatch of the theme's page colour -- five hand-styled
 * Buttons, the height an accident of Button's padding around no text. A flat
 * swatch says one thing about a theme, and for Darkenheimer (#2A2A2A) and
 * Blue (#2A2A3A) that one thing is the same. The tile says four: the header
 * band, the page, a selected row, and the text on each, at thumbnail scale.
 *
 * The button holds the tile AND the name, so the name is the control's
 * accessible name -- KAN-64's rule, which these swatches never met; they had a
 * title and nothing else -- and the whole thing is the hit target. The tile is
 * aria-hidden: it is a picture of the name.
 *
 * SELECTION MARKER, unchanged from KAN-88/KAN-95: the tile's own 1px frame,
 * thickened to 2px in the PAGE's LABEL_L3. Growing a border is safe because
 * App.css sets `* { box-sizing: border-box }` globally, so the tile keeps its
 * size and the row never reflows; e2e/theme-swatch-marker.spec pins that.
 * LABEL_L3 rather than BORDER_COLOR because BORDER measures 1.38-1.73:1
 * against the page on four of the five themes and would be invisible;
 * LABEL_L3 is the one existing token in a sane band (2.56-4.03:1). TEXT_COLOR
 * was tried and rejected as focus-ring weight on a passive marker.
 *
 * HOVER AND PRESS move the frame's colour a rung, not the tile's fill: the
 * tile's colours are the information, and a hover fill would repaint them.
 * The old swatches pinned `&:hover { background: <own colour> }` for exactly
 * this reason and so had no hover at all.
 */
const TILE_WIDTH_PX = 72;
const TILE_HEIGHT_PX = 52;

interface ThemeSwatchProps {
  /** The theme this tile depicts. Its tokens paint the tile. */
  palette: ThemeColors;
  /** Translated. Shown under the tile, and the button's accessible name. */
  name: string;
  isActive: boolean;
  onSelect: () => void;
}

export default function ThemeSwatch({
  palette,
  name,
  isActive,
  onSelect,
}: ThemeSwatchProps) {
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
  `;

  // A stroke: a line of "text" at thumbnail scale. 3px, so it survives the
  // popup's size without becoming a hairline.
  const stroke = (width: number, color: string) => css`
    display: block;
    width: ${width}px;
    height: 3px;
    background-color: ${color};
    flex-shrink: 0;
  `;

  const tileStyle = css`
    display: flex;
    flex-direction: column;
    width: ${TILE_WIDTH_PX}px;
    height: ${TILE_HEIGHT_PX}px;
    overflow: hidden;
    background-color: ${palette.PRIMARY_COLOR};
    border: 1px solid ${PAGE.BORDER_COLOR};
    transition: border-color ${DURATION.COLOR};
    ${isActive
      ? `border-color: ${PAGE.LABEL_L3_COLOR}; border-width: 2px;`
      : ''}
    /* The frame answers the pointer. Named properties, never the all
       keyword; and only the colour moves, so the box never does. */
    button:hover > & {
      border-color: ${PAGE.LABEL_L2_COLOR};
    }
    button:active > & {
      border-color: ${PAGE.LABEL_L1_COLOR};
    }
  `;

  const headerStyle = css`
    display: flex;
    align-items: center;
    height: 12px;
    padding: 0 6px;
    background-color: ${palette.SECONDARY_COLOR};
  `;

  const bodyStyle = css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    padding: 4px 6px;
  `;

  // A selected row, full width: negative margin against the body's padding,
  // then the same padding back inside, so its stroke lines up with the rest.
  const selectionStyle = css`
    display: flex;
    align-items: center;
    height: 9px;
    margin: 0 -6px;
    padding: 0 6px;
    background-color: ${palette.SELECTION_COLOR};
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
      onClick={onSelect}
      css={buttonStyle}
    >
      <span aria-hidden="true" data-theme-tile css={tileStyle}>
        <span data-theme-band="header" css={headerStyle}>
          <i css={stroke(22, palette.TEXT_COLOR)} />
        </span>
        <span data-theme-band="body" css={bodyStyle}>
          <span data-theme-band="selection" css={selectionStyle}>
            <i css={stroke(30, palette.TEXT_COLOR)} />
          </span>
          <i css={stroke(24, palette.LABEL_L2_COLOR)} />
          <i css={stroke(34, palette.LABEL_L2_COLOR)} />
        </span>
      </span>
      <span css={nameStyle}>{name}</span>
    </button>
  );
}
