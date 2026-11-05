import { css } from '@emotion/react';

import { ThemeColors } from '../../../hooks/useThemeColors';
import { corners } from '../../../styles/corners';
import SwatchButton from './SwatchButton';

/**
 * One theme in the picker: a miniature of the popup drawn from that theme's
 * own tokens, with its name underneath (KAN-237).
 *
 * It was a flat 60x50 swatch of the theme's page colour -- five hand-styled
 * Buttons, the height an accident of Button's padding around no text. A flat
 * swatch says one thing about a theme, and for Darkenheimer (#2A2A2A) and
 * Blue (#2A2A3A) that one thing is the same. The tile says four: the header
 * band, the page, a selected row, and the text on each, at thumbnail scale.
 */
// A line of "text" at thumbnail scale: 3px, round-ended (KAN-904).
const STROKE_PX = 3;
// KAN-904. The selected row as the app draws it, at the tile's scale: set in
// from the sides (half the body's 6px padding), with its own corners.
const TILE_ROW_INSET_PX = 3;
const TILE_ROW_RADIUS = '3px';

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
  // A stroke: a line of "text" at thumbnail scale. 3px, so it survives the
  // popup's size without becoming a hairline.
  const stroke = (width: number, color: string) => css`
    display: block;
    width: ${width}px;
    height: ${STROKE_PX}px;
    border-radius: ${STROKE_PX / 2}px;
    background-color: ${color};
    flex-shrink: 0;
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

  // A selected row, set in from the tile's sides (KAN-904): a negative margin
  // into the body's padding, then the same padding back inside, so its stroke
  // lines up with the rest.
  const selectionStyle = css`
    display: flex;
    align-items: center;
    height: 9px;
    margin: 0 -${TILE_ROW_INSET_PX}px;
    padding: 0 ${TILE_ROW_INSET_PX}px;
    background-color: ${palette.SELECTION_COLOR};
    ${corners(TILE_ROW_RADIUS)}
  `;

  return (
    <SwatchButton
      name={name}
      isActive={isActive}
      onSelect={onSelect}
      background={palette.PRIMARY_COLOR}
      tileCss={css`
        flex-direction: column;
      `}
    >
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
    </SwatchButton>
  );
}
