// The dashed box a carried or dragged item can be let go in, and its name,
// shared so every drop target of this kind looks the same.
import { css, type SerializedStyles } from '@emotion/react';

import Icon from './Icon';
import { useThemeColors, type ThemeColors } from '../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';
import { RADIUS, TYPE } from '../../styles/scale';

// Dashed, then the hover fill and a solid border once [data-landing] is on.
// Where the box sits and how tall it is are the caller's.
export function dropBoxStyle(COLORS: ThemeColors): SerializedStyles {
  return css`
    border-width: 1.5px;
    border-style: dashed;
    border-color: ${COLORS.LABEL_L2_COLOR};
    border-radius: ${RADIUS.SQUARE};
    &[data-landing] {
      background-color: ${COLORS.HOVER_COLOR};
      border-style: solid;
    }
  `;
}

// Fills the box, which must be its nearest positioned ancestor; takes no
// pointer, so a pointer meets what the box holds.
export function DropBoxLabel({
  text,
  hiddenUnlessLit = false,
}: {
  text: string;
  hiddenUnlessLit?: boolean;
}) {
  const COLORS = useThemeColors();
  return (
    <div
      // What the trailing block hides while unlit.
      data-new-window-label={hiddenUnlessLit ? '' : undefined}
      css={css`
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px;
        color: ${COLORS.LABEL_L1_COLOR};
        font-size: ${TYPE.BODY};
        pointer-events: none;
      `}
    >
      <Icon type="add_box" style={NON_INTERACTIVE_ICON_STYLE} />
      <span>{text}</span>
    </div>
  );
}
