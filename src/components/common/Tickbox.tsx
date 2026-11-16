import React from 'react';

import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { RADIUS, CORNER_SHAPE } from '../../styles/scale';
import { focusRingOutsideCss } from './focusRing';
import Icon from './Icon';

// `included` is a folder inside a ticked one: shown ticked, faint, and locked.
export type TickState = 'off' | 'on' | 'included';

interface TickboxProps {
  state: TickState;
  // An empty folder: nothing to tick, so it reads and draws unchecked whatever its state.
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}

/**
 * KAN-862. A checkbox for the import dialog's folder tree. A span, not an
 * <input>: the drawing is ours, and the ARIA checkbox pattern takes Space
 * only, which a <button> would widen to Enter. A box that cannot change
 * (`included`, `disabled`) says aria-disabled and stays in the tab order,
 * like the app's other unavailable controls.
 */
const Tickbox: React.FC<TickboxProps> = ({
  state,
  disabled = false,
  label,
  onToggle,
}) => {
  const COLORS = useThemeColors();
  const locked = disabled || state === 'included';
  const ticked = state !== 'off' && !disabled;

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
    opacity: ${state === 'included' && !disabled ? 0.4 : 1};
    cursor: ${locked ? 'default' : 'pointer'};
    ${focusRingOutsideCss(COLORS)}
  `;

  return (
    <span
      role="checkbox"
      tabIndex={0}
      aria-checked={ticked}
      aria-disabled={locked ? true : undefined}
      aria-label={label}
      css={boxStyle}
      onClick={locked ? undefined : onToggle}
      onKeyDown={(e) => {
        if (e.key !== ' ') return;
        // Space would scroll the dialog's list.
        e.preventDefault();
        if (!locked) onToggle();
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
