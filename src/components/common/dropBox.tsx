// A drop box's name, drawn over its dropBoxStyle box.
import { css } from '@emotion/react';

import Icon from './Icon';
import { useThemeColors } from '../../hooks/useThemeColors';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';
import { TYPE } from '../../styles/scale';

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
      data-drop-label=""
      // What the trailing block hides while unlit.
      data-drop-label-unlit-hidden={hiddenUnlessLit ? '' : undefined}
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
