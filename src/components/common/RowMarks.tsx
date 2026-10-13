import type { ReactNode } from 'react';
import { css } from '@emotion/react';

import Icon from './Icon';
import type { IconName } from './iconNames';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ICON } from '../../styles/scale';
import { NON_INTERACTIVE_ICON_STYLE } from '../../utils/constants/common';

// Icon's box: its glyph plus 4px padding a side. rem-based, so it follows
// Chrome's font size (KAN-312).
const ACTION_SLOT = `calc(${ICON.DEFAULT} + 8px)`;

// KAN-566. A tab row's marks (pin, split, sound), the same in Open now and a
// saved session: side by side at the row's end, one action's width in from
// its edge, so the action the row reveals on hover keeps its column on every
// row (KAN-280 O10a 1B).
const slotStyle = css`
  display: flex;
  align-items: center;
  flex: none;
  gap: 6px;
  margin-left: 10px;
  margin-right: ${ACTION_SLOT};
`;

export function RowMarkSlot({ children }: { children: ReactNode }) {
  return <span css={slotStyle}>{children}</span>;
}

// One mark: a glyph, not a control, at the saved row's size and colour
// (KAN-458, picked for both panes in KAN-566). aria-hidden, as every
// presentational Icon is: the row's description says what it means.
export function RowMarkIcon({
  type,
  tooltipText,
}: {
  type: IconName;
  tooltipText?: string;
}) {
  const COLORS = useThemeColors();
  return (
    <Icon
      type={type}
      size={ICON.MARK}
      color={COLORS.LABEL_L2_COLOR}
      tooltipText={tooltipText}
      style={`${NON_INTERACTIVE_ICON_STYLE} padding: 0;`}
    />
  );
}
