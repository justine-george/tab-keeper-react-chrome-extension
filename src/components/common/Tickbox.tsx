import React from 'react';

import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { RADIUS, CORNER_SHAPE } from '../../styles/scale';
import { focusRingOutsideCss } from './focusRing';
import Icon from './Icon';

export type TickState = 'off' | 'on';

interface TickboxProps {
  state: TickState;
  label: string;
  onToggle: () => void;
}

/**
 * KAN-862. A checkbox for the import dialog's folder tree. A span, not an
 * <input>: the drawing is ours, and the ARIA checkbox pattern takes Space
 * only, which a <button> would widen to Enter. Every listed folder has
 * something to import (R19), so there is no disabled box.
 */
const Tickbox: React.FC<TickboxProps> = ({ state, label, onToggle }) => {
  const COLORS = useThemeColors();
  const ticked = state === 'on';

  const boxStyle = css`
    box-sizing: border-box;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid ${COLORS.TEXT_COLOR};
    border-radius: ${RADIUS.MARK};
    corner-shape: ${CORNER_SHAPE};
    background: ${ticked ? COLORS.TEXT_COLOR : 'transparent'};
    cursor: pointer;
    ${focusRingOutsideCss(COLORS)}
  `;

  return (
    <span
      role="checkbox"
      tabIndex={0}
      aria-checked={ticked}
      aria-label={label}
      css={boxStyle}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key !== ' ') return;
        // Space would scroll the dialog's list.
        e.preventDefault();
        onToggle();
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
