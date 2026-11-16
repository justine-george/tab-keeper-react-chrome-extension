import React from 'react';

import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { RADIUS, CORNER_SHAPE } from '../../styles/scale';
import { focusRingOutsideCss } from './focusRing';
import Icon from './Icon';

export type TickState = 'off' | 'on';

interface TickboxProps {
  state: TickState;
  // A folder with nothing to import (empty, or imported before): it reads and draws unchecked whatever its state.
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}

/**
 * KAN-862. A checkbox for the import dialog's folder tree. A span, not an
 * <input>: the drawing is ours, and the ARIA checkbox pattern takes Space
 * only, which a <button> would widen to Enter. A disabled box says
 * aria-disabled and stays in the tab order, like the app's other
 * unavailable controls.
 */
const Tickbox: React.FC<TickboxProps> = ({
  state,
  disabled = false,
  label,
  onToggle,
}) => {
  const COLORS = useThemeColors();
  const ticked = state === 'on' && !disabled;

  const boxStyle = css`
    box-sizing: border-box;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid
      ${disabled ? COLORS.PANEL_BORDER_COLOR : COLORS.TEXT_COLOR};
    border-radius: ${RADIUS.MARK};
    corner-shape: ${CORNER_SHAPE};
    background: ${ticked ? COLORS.TEXT_COLOR : 'transparent'};
    cursor: ${disabled ? 'default' : 'pointer'};
    ${focusRingOutsideCss(COLORS)}
  `;

  return (
    <span
      role="checkbox"
      tabIndex={0}
      aria-checked={ticked}
      aria-disabled={disabled ? true : undefined}
      aria-label={label}
      css={boxStyle}
      onClick={disabled ? undefined : onToggle}
      onKeyDown={(e) => {
        if (e.key !== ' ') return;
        // Space would scroll the dialog's list.
        e.preventDefault();
        if (!disabled) onToggle();
      }}
    >
      {ticked && (
        <Icon
          type="check"
          size="14px"
          color={COLORS.PRIMARY_COLOR}
          style="padding: 0;"
        />
      )}
    </span>
  );
};

export default Tickbox;
