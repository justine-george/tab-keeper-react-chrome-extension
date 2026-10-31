import React from 'react';

import { css } from '@emotion/react';
import { useThemeColors } from '../../hooks/useThemeColors';
import { focusRingCss } from './focusRing';
import { tooltipDescription } from './tooltipRules';

interface ClickableRowProps {
  /**
   * Required, not optional. The children of a row are an Icon plus a label,
   * and the Icon renders its Material Symbols glyph as ligature text, so
   * name-from-content computes something like "arrow_back Back". There is no
   * useful default; every row has to say what it is.
   */
  ariaLabel: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  // KAN-884. A middle-click; its press is kept from starting autoscroll.
  onAuxClick?: React.MouseEventHandler<HTMLButtonElement>;
  tooltipText?: string;
  // False when the tooltip is for the eye only, so assistive tech does not hear it as the description (KAN-824).
  announceTooltip?: boolean;
  // KAN-825. Text the row shows (a tab's title) that leads the tooltip when it is cut off; never announced.
  tooltipLead?: string;
  /**
   * Marks the row as the current one of its set -- the tab Chrome is showing,
   * in the Open now pane (KAN-280). A cue that is not colour alone.
   */
  ariaCurrent?: boolean;
  /**
   * The id of an element whose text describes the row beyond its name -- a
   * live tab's sound, in the Open now pane (KAN-280 O10b).
   */
  ariaDescribedBy?: string;
  // KAN-413. Names this row for the sample tour's coach mark.
  tourAnchor?: string;
  // KAN-413. Announced as unavailable and a click does nothing; it stays in the tab order and draggable.
  disable?: boolean;
  style?: string;
  // KAN-389. For a caller that hands focus back to the row.
  buttonRef?: React.Ref<HTMLButtonElement>;
  // KAN-592. A key the row takes beyond Enter and Space, and its aria-keyshortcuts.
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  ariaKeyShortcuts?: string;
  children: React.ReactNode;
}

/**
 * A button whose visible content is composed of other components.
 *
 * This exists because three header affordances -- the settings Back, the
 * search Back and the search opener -- each hand-rolled "a div that behaves
 * like a button", and each arrived at a different level of correctness: none
 * carried role="button", two handled Enter but not Space, and one handled no
 * key at all, leaving it focusable but impossible to activate (KAN-62).
 *
 * Rendering a real <button> rather than <div role="button"> is the point: the
 * role, the tab order, Enter, Space and the focus ring all come from the
 * platform instead of from four props that a fourth call site could forget.
 * The ring's colour is the app's, not Chrome's blue (KAN-671).
 */
const ClickableRow: React.FC<ClickableRowProps> = ({
  ariaLabel,
  onClick,
  onAuxClick,
  tooltipText,
  announceTooltip = true,
  tooltipLead,
  ariaCurrent,
  ariaDescribedBy,
  tourAnchor,
  disable,
  style,
  buttonRef,
  onKeyDown,
  ariaKeyShortcuts,
  children,
}) => {
  const COLORS = useThemeColors();
  // The UA stylesheet for <button> is what makes this swap risky, so the
  // reset is explicit rather than `all: unset` -- `all` would also drop the
  // inherited font and colour these rows rely on, and would reset the
  // focus-visible outline that makes the control usable by keyboard.
  //
  // text-align and align-items are the two that actually bite: Chrome centres
  // button content, and these rows are left-aligned flex rows.
  const rowStyle = css`
    appearance: none;
    background: none;
    border: none;
    margin: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: inherit;
    align-items: stretch;
    cursor: pointer;
    ${focusRingCss(COLORS)}
    ${style && style}
    ${disable ? 'cursor: default;' : ''}
  `;

  return (
    <button
      ref={buttonRef}
      type="button"
      data-tooltip={tooltipText}
      data-tooltip-lead={tooltipLead}
      aria-label={ariaLabel}
      aria-description={
        announceTooltip ? tooltipDescription(tooltipText, ariaLabel) : undefined
      }
      aria-current={ariaCurrent ? 'true' : undefined}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disable ? true : undefined}
      aria-keyshortcuts={ariaKeyShortcuts}
      data-tour-anchor={tourAnchor}
      css={rowStyle}
      onClick={disable ? undefined : onClick}
      onAuxClick={disable ? undefined : onAuxClick}
      onMouseDown={
        onAuxClick && !disable
          ? (e) => {
              if (e.button === 1) e.preventDefault();
            }
          : undefined
      }
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
};

export default ClickableRow;
